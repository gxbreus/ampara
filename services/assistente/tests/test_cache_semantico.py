"""Cache semântico (docs/llm/cache-semantico.md) com Qdrant em memória: sem rede."""

import math

import pytest
from qdrant_client import AsyncQdrantClient

from app.cache_semantico import CacheSemantico, numeros
from app.rag import Rag
from app.resiliencia import Cache, Resiliencia
from tests.test_rag import Ajustes, IndiceFake, LlmFake, RedisFake

PERGUNTA = "Quais vacinas um filhote de cão precisa?"
PARAFRASE = "Que vacinas meu filhote de cachorro precisa tomar?"


def vetor_com_similaridade(cos: float) -> list[float]:
    """Vetor cujo cosseno com [1, 0, 0] é `cos`."""
    return [cos, math.sqrt(1 - cos**2), 0.0]


class IndiceComVetores(IndiceFake):
    def __init__(self, vetores, scores=(0.6, 0.5, 0.4)):
        super().__init__(scores)
        self.vetores = vetores

    async def vetor(self, pergunta):
        return self.vetores[pergunta]


class Relogio:
    def __init__(self):
        self.t = 1_000.0

    def __call__(self):
        return self.t


def servico(vetores, llm, relogio=None, qdrant=None, ttl_s=60):
    cache = CacheSemantico(
        qdrant or AsyncQdrantClient(location=":memory:"),
        3,
        0.97,
        ttl_s,
        agora=relogio or Relogio(),
    )
    return Rag(
        IndiceComVetores(vetores),
        [llm],
        [Resiliencia(1.0, base_backoff_s=0)],
        Cache(RedisFake(), 60),
        Ajustes(),
        cache,
    )


async def test_parafrase_vem_do_cache_semantico_sem_chamar_o_llm():
    llm = LlmFake(["ok"])
    s = servico({PERGUNTA: [1.0, 0.0, 0.0], PARAFRASE: vetor_com_similaridade(0.98)}, llm)
    primeira = await s.responder(PERGUNTA)
    r = await s.responder(PARAFRASE)
    assert r["cache"] is True and llm.chamadas == 1
    assert r["resposta"] == primeira["resposta"] and r["fontes"] == primeira["fontes"]
    assert s.resiliencia.metricas.cache_semantico_hits == 1


async def test_pergunta_parecida_abaixo_do_limiar_chama_o_llm():
    # 0,956 é "filhote de cão" × "cão adulto" medido com o modelo real
    adulto = "Quais vacinas um cão adulto precisa?"
    llm = LlmFake(["ok", "ok"])
    s = servico({PERGUNTA: [1.0, 0.0, 0.0], adulto: vetor_com_similaridade(0.956)}, llm)
    await s.responder(PERGUNTA)
    r = await s.responder(adulto)
    assert r["cache"] is False and llm.chamadas == 2


async def test_numeros_diferentes_nao_reaproveitam_a_resposta():
    lei_a, lei_b = "O que diz a Lei 14.064?", "O que diz a Lei 9.605?"
    llm = LlmFake(["ok", "ok"])
    s = servico({lei_a: [1.0, 0.0, 0.0], lei_b: vetor_com_similaridade(0.99)}, llm)
    await s.responder(lei_a)
    r = await s.responder(lei_b)
    assert r["cache"] is False and llm.chamadas == 2


async def test_outro_trecho_principal_nao_reaproveita_a_resposta():
    llm = LlmFake(["ok", "ok"])
    s = servico({PERGUNTA: [1.0, 0.0, 0.0], PARAFRASE: vetor_com_similaridade(0.99)}, llm)
    await s.responder(PERGUNTA)
    s.indice.resultados = list(reversed(s.indice.resultados))  # outro contexto
    r = await s.responder(PARAFRASE)
    assert r["cache"] is False and llm.chamadas == 2


async def test_fonte_citada_que_nao_volta_na_busca_nao_reaproveita_a_resposta():
    # a resposta do fake cita [1]; aqui o 1º trecho continua, mas sem a fonte citada
    llm = LlmFake(["ok", "ok"])
    s = servico({PERGUNTA: [1.0, 0.0, 0.0], PARAFRASE: vetor_com_similaridade(0.99)}, llm)
    await s.responder(PERGUNTA)
    citado = s.indice.resultados[0]
    s.indice.resultados = [citado.__class__(s.indice.resultados[1].trecho, 0.6)] + [
        r for r in s.indice.resultados[2:]
    ]
    r = await s.responder(PARAFRASE)
    assert r["cache"] is False and llm.chamadas == 2


async def test_trecho_do_fim_da_lista_que_some_nao_impede_o_acerto():
    # paráfrases reais: o 3º trecho, perto do limiar, aparece numa e some na outra
    llm = LlmFake(["ok"])
    s = servico({PERGUNTA: [1.0, 0.0, 0.0], PARAFRASE: vetor_com_similaridade(0.98)}, llm)
    await s.responder(PERGUNTA)
    s.indice.resultados = s.indice.resultados[:2]
    r = await s.responder(PARAFRASE)
    assert r["cache"] is True and llm.chamadas == 1


async def test_resposta_vencida_nao_e_reaproveitada():
    relogio, llm = Relogio(), LlmFake(["ok", "ok"])
    s = servico({PERGUNTA: [1.0, 0.0, 0.0], PARAFRASE: vetor_com_similaridade(0.99)}, llm, relogio)
    await s.responder(PERGUNTA)
    relogio.t += 61
    r = await s.responder(PARAFRASE)
    assert r["cache"] is False and llm.chamadas == 2


async def test_outro_modelo_nao_reaproveita_a_resposta():
    llm = LlmFake(["ok", "ok"])
    s = servico({PERGUNTA: [1.0, 0.0, 0.0], PARAFRASE: vetor_com_similaridade(0.99)}, llm)
    await s.responder(PERGUNTA)
    s.settings = type("Outro", (Ajustes,), {"modelo": "outro-modelo"})()
    r = await s.responder(PARAFRASE)
    assert r["cache"] is False and llm.chamadas == 2


class QdrantFora:
    def __getattr__(self, _):
        async def falha(*args, **kwargs):
            raise ConnectionError("qdrant fora")

        return falha


async def test_qdrant_fora_nao_derruba_a_resposta():
    llm = LlmFake(["ok", "ok"])
    s = servico({PERGUNTA: [1.0, 0.0, 0.0]}, llm, qdrant=QdrantFora())
    r = await s.responder(PERGUNTA)
    assert not r["degradado"] and r["cache"] is False


@pytest.mark.parametrize(
    ("texto", "esperado"),
    [
        ("Lei 14.064 de 2020", ["14064", "2020"]),
        ("lei 14064/2020", ["14064", "2020"]),
        ("filhote de 3 meses", ["3"]),
        ("sem números", []),
    ],
)
def test_numeros_da_pergunta(texto, esperado):
    assert numeros(texto) == esperado
