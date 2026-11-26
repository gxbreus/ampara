"""RAG (#66, #67) e resiliência do LLM (#69), sem rede: LLM, índice e Redis são fakes."""

import asyncio

import pytest
from langchain_core.messages import AIMessage
from langchain_core.runnables import Runnable

from app import conhecimento
from app.config import KB_PADRAO
from app.indice import Resultado
from app.rag import FORA_DO_DOMINIO, Rag
from app.resiliencia import Cache, Circuito, CircuitoAberto, Resiliencia, transitorio


class Ajustes:
    modelo = "modelo-teste"
    trechos_por_resposta = 3
    limiar_relevancia = 0.30


class IndiceFake:
    versao = "v1"

    def __init__(self, scores):
        trechos = conhecimento.carregar(KB_PADRAO)
        self.resultados = [Resultado(t, s) for t, s in zip(trechos, scores, strict=False)]

    async def vetor(self, pergunta):
        return [1.0, 0.0, 0.0]

    async def buscar(self, pergunta, k, vetor=None):
        return self.resultados[:k]


class RedisFake:
    def __init__(self, quebrado=False):
        self.dados, self.quebrado = {}, quebrado

    async def get(self, chave):
        if self.quebrado:
            raise ConnectionError("redis fora")
        return self.dados.get(chave)

    async def set(self, chave, valor, ex=None):
        if self.quebrado:
            raise ConnectionError("redis fora")
        self.dados[chave] = valor


class LlmFake(Runnable):
    """Chat model mínimo: responde, demora ou falha, conforme o roteiro."""

    def __init__(self, roteiro):
        self.roteiro, self.chamadas = list(roteiro), 0

    def invoke(self, entrada, config=None, **_):
        raise NotImplementedError("o serviço só usa a versão assíncrona")

    async def ainvoke(self, entrada, config=None, **_):
        self.chamadas += 1
        passo = self.roteiro.pop(0) if self.roteiro else "ok"
        if passo == "lento":
            await asyncio.sleep(5)
        if isinstance(passo, Exception):
            raise passo
        return AIMessage(content=f"Resposta com fonte [1] ({passo}).")


def rag(scores=(0.6, 0.5, 0.4), llms=(), redis=None, timeout=1.0):
    resiliencias = [Resiliencia(timeout, base_backoff_s=0) for _ in llms] or [Resiliencia(timeout)]
    return Rag(
        IndiceFake(scores), list(llms), resiliencias, Cache(redis or RedisFake(), 60), Ajustes()
    )


def test_base_tem_15_trechos_citaveis_com_origem():
    trechos = conhecimento.carregar(KB_PADRAO)
    assert len(trechos) == 15
    assert all(t.titulo and t.texto and t.origem.startswith("kb/") for t in trechos)
    assert len({t.id for t in trechos}) == len(trechos)
    assert len(conhecimento.versao(KB_PADRAO)) == 12


async def test_fora_do_dominio_nao_chama_o_llm_nem_inventa_fontes():
    llm = LlmFake([])
    r = await rag(scores=(0.10, 0.08), llms=[llm]).responder("Qual é a capital da França?")
    assert r["resposta"] == FORA_DO_DOMINIO and r["fontes"] == [] and not r["degradado"]
    assert llm.chamadas == 0


async def test_responde_com_o_llm_citando_as_fontes_e_grava_no_cache():
    redis = RedisFake()
    r = await rag(llms=[LlmFake(["ok"])], redis=redis).responder("Como apresentar o gato?")
    assert not r["degradado"] and not r["cache"]
    assert "[1]" in r["resposta"]
    assert [f["origem"] for f in r["fontes"]][0].startswith("kb/")
    assert len(redis.dados) == 1


async def test_segunda_vez_vem_do_cache_sem_chamar_o_llm():
    redis, llm = RedisFake(), LlmFake(["ok"])
    servico = rag(llms=[llm], redis=redis)
    await servico.responder("Como apresentar o gato?")
    r = await servico.responder("  como APRESENTAR o gato? ")
    assert r["cache"] is True and llm.chamadas == 1


async def test_cache_exato_ignora_pontuacao():
    redis, llm = RedisFake(), LlmFake(["ok"])
    servico = rag(llms=[llm], redis=redis)
    await servico.responder("Quais vacinas o filhote precisa?")
    r = await servico.responder("quais vacinas, o filhote precisa")
    assert r["cache"] is True and llm.chamadas == 1


async def test_sem_chave_responde_pelo_fallback_com_fontes_reais():
    r = await rag(llms=[]).responder("Como apresentar o gato?")
    assert r["degradado"] is True and r["fontes"]
    assert "fontes da Ampara" in r["resposta"]


async def test_principal_falha_e_o_modelo_de_reserva_responde():
    principal = LlmFake([ValueError("400 do provedor")])
    reserva = LlmFake(["reserva"])
    r = await rag(llms=[principal, reserva]).responder("Como apresentar o gato?")
    assert not r["degradado"] and "reserva" in r["resposta"]


async def test_timeout_e_retry_esgotados_viram_fallback():
    llm = LlmFake(["lento", "lento", "lento"])
    r = await rag(llms=[llm], timeout=0.05).responder("Como apresentar o gato?")
    assert r["degradado"] is True and llm.chamadas == 3


async def test_cache_fora_do_ar_nao_derruba_a_resposta():
    r = await rag(llms=[LlmFake(["ok"])], redis=RedisFake(quebrado=True)).responder(
        "Como apresentar o gato?"
    )
    assert not r["degradado"]


async def test_retry_so_em_erro_transitorio():
    resiliencia = Resiliencia(1.0, base_backoff_s=0)
    tentativas = 0

    async def falha_definitiva():
        nonlocal tentativas
        tentativas += 1
        raise ValueError("pedido inválido")

    with pytest.raises(ValueError):
        await resiliencia.chamar(falha_definitiva)
    assert tentativas == 1  # bug ou pedido inválido não melhora tentando de novo


def test_classifica_erros_transitorios():
    class Erro(Exception):
        def __init__(self, status):
            self.status_code = status

    assert transitorio(TimeoutError()) and transitorio(Erro(429)) and transitorio(Erro(503))
    assert not transitorio(Erro(400)) and not transitorio(Erro(401))


async def test_circuito_abre_depois_de_tres_falhas_e_fecha_depois_de_um_sucesso():
    agora = [0.0]
    circuito = Circuito(limite_falhas=3, tempo_aberto_s=30, _agora=lambda: agora[0])
    resiliencia = Resiliencia(1.0, tentativas=1, circuito=circuito)

    async def falha():
        raise TimeoutError()

    async def ok():
        return "ok"

    for _ in range(3):
        with pytest.raises(TimeoutError):
            await resiliencia.chamar(falha)
    assert circuito.estado == "aberto" and resiliencia.estado()["tentarNovamenteEm"]
    with pytest.raises(CircuitoAberto):
        await resiliencia.chamar(ok)
    agora[0] = 31
    assert circuito.estado == "meio-aberto"
    assert await resiliencia.chamar(ok) == "ok"
    assert circuito.estado == "fechado"


async def test_meio_aberto_que_falha_reabre_na_hora():
    agora = [0.0]
    circuito = Circuito(limite_falhas=3, tempo_aberto_s=30, _agora=lambda: agora[0])
    resiliencia = Resiliencia(1.0, tentativas=1, circuito=circuito)

    async def falha():
        raise TimeoutError()

    for _ in range(3):
        with pytest.raises(TimeoutError):
            await resiliencia.chamar(falha)
    agora[0] = 31
    with pytest.raises(TimeoutError):
        await resiliencia.chamar(falha)
    assert circuito.estado == "aberto"


# ---------- checagem de citação ----------


class LlmTexto(Runnable):
    """Devolve os textos dados, um por chamada (o último se repete)."""

    def __init__(self, *textos):
        self.textos, self.chamadas = list(textos), 0

    def invoke(self, entrada, config=None, **_):
        raise NotImplementedError

    async def ainvoke(self, entrada, config=None, **_):
        self.chamadas += 1
        return AIMessage(content=self.textos.pop(0) if len(self.textos) > 1 else self.textos[0])


async def test_citacoes_validas_viram_so_as_fontes_citadas_renumeradas():
    servico = rag(
        llms=[LlmTexto("Faça a adaptação aos poucos [3]. Consulte o veterinário [1, 3].")]
    )
    r = await servico.responder("Como apresentar o gato?")
    assert not r["degradado"]
    # [3] aparece primeiro, então vira [1]; o antigo [1] vira [2]
    assert r["resposta"] == "Faça a adaptação aos poucos [1]. Consulte o veterinário [2, 1]."
    trechos = servico.indice.resultados
    assert [f["origem"] for f in r["fontes"]] == [
        trechos[2].trecho.origem,
        trechos[0].trecho.origem,
    ]


async def test_resposta_sem_citacao_e_recusada_e_cai_na_contingencia():
    llm = LlmTexto("Leve ao veterinário e tenha paciência.")
    servico = rag(llms=[llm])
    r = await servico.responder("Como apresentar o gato?")
    assert r["degradado"] is True and "fontes da Ampara" in r["resposta"]
    assert servico.resiliencia.estado()["citacoesInvalidas"] == 1
    # o provedor respondeu: checagem de citação não abre o circuito
    assert servico.resiliencia.estado()["circuito"] == "fechado"


async def test_citacao_de_fonte_inexistente_e_recusada():
    r = await rag(llms=[LlmTexto("Segundo a lei [7], é obrigatório.")]).responder("E a lei?")
    assert r["degradado"] is True


async def test_reserva_salva_quando_o_principal_nao_cita():
    principal, reserva = LlmTexto("Sem citar nada."), LlmTexto("Vacine com orientação [2].")
    r = await rag(llms=[principal, reserva]).responder("Quando vacinar?")
    assert not r["degradado"] and r["resposta"] == "Vacine com orientação [1]."
    assert principal.chamadas == 1 and reserva.chamadas == 1


async def test_sem_cobertura_responde_sem_fontes_e_sem_inventar():
    llm = LlmTexto("SEM_COBERTURA: As fontes da Ampara não informam horários de clínicas [1].")
    r = await rag(llms=[llm]).responder("Qual o horário das clínicas de Lavras hoje?")
    assert not r["degradado"] and r["fontes"] == []
    assert r["resposta"] == "As fontes da Ampara não informam horários de clínicas."
    assert "SEM_COBERTURA" not in r["resposta"]


async def test_sem_cobertura_sem_o_marcador_tambem_nao_mostra_fontes():
    r = await rag(
        llms=[LlmTexto("As fontes da Ampara não cobrem esse ponto; procure a ONG.")]
    ).responder("x")
    assert not r["degradado"] and r["fontes"] == []


async def test_resposta_recusada_nao_vai_para_o_cache():
    redis = RedisFake()
    await rag(llms=[LlmTexto("Sem citação.")], redis=redis).responder("Como apresentar o gato?")
    assert redis.dados == {}


async def test_contingencia_usa_os_tres_trechos_principais_com_as_fontes():
    servico = rag(scores=(0.6, 0.5, 0.4, 0.35), llms=[])
    servico.settings.trechos_por_resposta = 4
    r = await servico.responder("Como cuidar de um filhote?")
    trechos = servico.indice.resultados
    assert r["degradado"] is True and len(r["fontes"]) == 3
    for t in trechos[:3]:
        assert f"“{t.trecho.titulo}”" in r["resposta"]


async def test_cota_diaria_esgotada_nao_tenta_de_novo_e_passa_para_a_reserva():
    class CotaDiaria(Exception):
        status_code = 429

        def __str__(self):
            return "Error code: 429 - Generate content requests per day limit exceeded on Free Tier"

    principal = LlmFake([CotaDiaria(), "ok"])
    reserva = LlmTexto("Vacine com orientação [1].")
    servico = rag(llms=[principal, reserva])
    r = await servico.responder("Quando vacinar?")
    assert not r["degradado"] and r["resposta"] == "Vacine com orientação [1]."
    assert principal.chamadas == 1  # sem novas tentativas no modelo sem cota
    assert servico.resiliencias[0].circuito.estado == "aberto"
