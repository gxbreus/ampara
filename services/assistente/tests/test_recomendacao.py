"""Recomendação com a tool buscar_animais_disponiveis (#68), sem rede."""

import json

import httpx
from langchain_core.messages import AIMessage

from app.recomendacao import MAX_ITERACOES, recomendar, regras
from app.resiliencia import Resiliencia

ANIMAIS = [
    {
        "id": "a" * 24,
        "nome": "Nina",
        "especie": "CAO",
        "porte": "PEQUENO",
        "sexo": "FEMEA",
        "idadeMeses": 120,
        "bairro": "Centro",
        "cidade": "Lavras",
        "fotoThumb": "https://f/nina.jpg",
        "distanciaKm": 0.4,
        "localizacao": {"type": "Point", "coordinates": [-45.0, -21.24]},
    },
    {
        "id": "b" * 24,
        "nome": "Thor",
        "especie": "CAO",
        "porte": "GRANDE",
        "sexo": "MACHO",
        "idadeMeses": 48,
        "bairro": "Centro",
        "cidade": "Lavras",
        "distanciaKm": 0.7,
    },
    {
        "id": "c" * 24,
        "nome": "Luna",
        "especie": "GATO",
        "porte": "PEQUENO",
        "sexo": "FEMEA",
        "idadeMeses": 36,
        "bairro": "Centro",
        "cidade": "Lavras",
        "distanciaKm": 1.2,
    },
]


def animais_falsos(registro=None, quebrado=False):
    def responder(pedido: httpx.Request):
        if registro is not None:
            registro.append(dict(pedido.url.params))
        if quebrado:
            return httpx.Response(503)
        especie = pedido.url.params.get("especie")
        porte = pedido.url.params.get("porte")
        itens = [
            a
            for a in ANIMAIS
            if (not especie or a["especie"] == especie) and (not porte or a["porte"] == porte)
        ]
        return httpx.Response(200, json={"itens": itens, "proximoCursor": None})

    return httpx.AsyncClient(transport=httpx.MockTransport(responder), base_url="http://animais")


class AgenteFake:
    """Simula o LLM com tool calling: 1º pede a tool, depois responde com o JSON roteirizado."""

    def __init__(self, filtros, final):
        self.filtros, self.final, self.mensagens_vistas = filtros, final, []

    def bind_tools(self, ferramentas):
        return self

    async def ainvoke(self, mensagens, **_):
        self.mensagens_vistas.append(list(mensagens))
        if not any(getattr(m, "type", "") == "tool" for m in mensagens):
            return AIMessage(
                content="",
                tool_calls=[
                    {"name": "buscar_animais_disponiveis", "args": self.filtros, "id": "t1"}
                ],
            )
        return AIMessage(content=json.dumps(self.final))


def resiliencias(n=1):
    return [Resiliencia(2.0, base_backoff_s=0) for _ in range(n)]


async def test_agente_usa_a_tool_com_localizacao_do_servidor_e_so_devolve_ids_reais():
    registro = []
    final = {
        "sugestoes": [
            {"animalId": "a" * 24, "motivo": "Pequena e calma, combina com apartamento."},
            {"animalId": "f" * 24, "motivo": "id inventado pelo modelo"},
        ],
        "explicacao": "Priorizei porte pequeno.",
    }
    llm = AgenteFake({"porte": "PEQUENO"}, final)
    r = await recomendar(
        [llm], resiliencias(), animais_falsos(registro), "Moro em apartamento", -21.2, -45.0, 5
    )

    assert [s["animalId"] for s in r["sugestoes"]] == ["a" * 24]  # o id inventado caiu
    assert (
        r["sugestoes"][0]["nome"] == "Nina"
        and r["sugestoes"][0]["fotoThumb"] == "https://f/nina.jpg"
    )
    assert not r["degradado"] and r["explicacao"] == "Priorizei porte pequeno."
    # a localização foi aplicada pelo servidor, não pelo modelo
    assert (
        registro[0]["lat"] == "-21.2"
        and registro[0]["raioKm"] == "5"
        and registro[0]["porte"] == "PEQUENO"
    )
    assert r["filtrosUsados"] == {"lat": -21.2, "lng": -45.0, "raioKm": 5, "porte": "PEQUENO"}


async def test_a_tool_nao_entrega_coordenadas_nem_distancia_ao_modelo():
    llm = AgenteFake({}, {"sugestoes": [], "explicacao": "ok"})
    await recomendar([llm], resiliencias(), animais_falsos(), "rotina qualquer", -21.2, -45.0, 10)
    resultado_da_tool = next(
        m for m in llm.mensagens_vistas[-1] if getattr(m, "type", "") == "tool"
    ).content
    assert "coordinates" not in resultado_da_tool and "distanciaKm" not in resultado_da_tool
    assert "fotoThumb" not in resultado_da_tool and "Nina" in resultado_da_tool


async def test_agente_para_depois_de_tres_iteracoes():
    class Teimoso(AgenteFake):
        async def ainvoke(self, mensagens, **_):
            self.mensagens_vistas.append(list(mensagens))
            if len(self.mensagens_vistas) <= MAX_ITERACOES:
                return AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "buscar_animais_disponiveis",
                            "args": {},
                            "id": f"t{len(self.mensagens_vistas)}",
                        }
                    ],
                )
            return AIMessage(
                content=json.dumps(
                    {"sugestoes": [{"animalId": "c" * 24, "motivo": "ok"}], "explicacao": "fim"}
                )
            )

    llm = Teimoso({}, {})
    r = await recomendar([llm], resiliencias(), animais_falsos(), "rotina", -21.2, -45.0, 10)
    assert len(llm.mensagens_vistas) == MAX_ITERACOES + 1 and r["sugestoes"][0]["nome"] == "Luna"


async def test_sem_llm_recomenda_por_regras_sem_porte_grande_para_apartamento():
    r = await recomendar(
        [],
        resiliencias(),
        animais_falsos(),
        "Moro em apartamento e trabalho 8 h fora",
        -21.2,
        -45.0,
        10,
    )
    nomes = [s["nome"] for s in r["sugestoes"]]
    assert r["degradado"] is True and "Thor" not in nomes and nomes
    assert "indisponível" in r["explicacao"]


async def test_animais_fora_do_ar_nao_inventa_animais():
    llm = AgenteFake({}, {"sugestoes": [{"animalId": "a" * 24, "motivo": "x"}], "explicacao": "x"})
    r = await recomendar(
        [llm], resiliencias(), animais_falsos(quebrado=True), "rotina", -21.2, -45.0, 10
    )
    assert r["sugestoes"] == [] and r["degradado"] is True
    # Animais fora não é falha do LLM: o circuito continua fechado
    assert r["filtrosUsados"]["lat"] == -21.2


def test_regras_do_fallback():
    filtros, criterio = regras("Moro em apartamento, gosto de gatos e trabalho 9 horas")
    assert filtros == {"porte_max": "MEDIO", "especie": "GATO", "idade_min": 12}
    assert "apartamento" in criterio


class EmbeddingsFake:
    """Vetor [1, 0] para texto com cara de rotina (moradia, trabalho), [0, 1] para o resto."""

    PISTAS = ("moro", "trabalho", "casa", "quintal", "apto", "apartamento", "tempo")

    def _vetor(self, texto):
        return [1.0, 0.0] if any(p in texto.lower() for p in self.PISTAS) else [0.0, 1.0]

    def embed_documents(self, textos):
        # os documentos são os exemplos de rotina: todos contam como rotina
        return [[1.0, 0.0] for _ in textos]

    def embed_query(self, texto):
        return self._vetor(texto)


async def test_texto_que_nao_e_rotina_orienta_sem_buscar_animais_nem_chamar_o_llm():
    registro = []
    llm = AgenteFake({}, {"sugestoes": [{"animalId": "a" * 24, "motivo": "x"}], "explicacao": "x"})
    r = await recomendar(
        [llm],
        resiliencias(),
        animais_falsos(registro),
        "Quem é o Neymar Jr?",
        -21.2,
        -45.0,
        10,
        embeddings=EmbeddingsFake(),
        limiar_rotina=0.45,
    )
    assert r["sugestoes"] == [] and not r["degradado"]
    assert "rotina" in r["explicacao"]
    assert registro == [] and llm.mensagens_vistas == []  # nem a busca nem o LLM foram chamados


async def test_rotina_curta_passa_pelo_filtro():
    r = await recomendar(
        [],
        resiliencias(),
        animais_falsos(),
        "moro sozinho em apto",
        -21.2,
        -45.0,
        10,
        embeddings=EmbeddingsFake(),
        limiar_rotina=0.45,
    )
    assert r["sugestoes"]  # seguiu para a busca (fallback por regras, sem LLM)


async def test_restricoes_de_bem_estar_sao_aplicadas_pelo_servidor_mesmo_se_o_llm_errar():
    animais = [
        {"id": "d" * 24, "nome": "Pipoca", "especie": "GATO", "porte": "PEQUENO", "idadeMeses": 3},
        {"id": "e" * 24, "nome": "Duquesa", "especie": "GATO", "porte": "MEDIO", "idadeMeses": 156},
        {"id": "f" * 24, "nome": "Sol", "especie": "CAO", "porte": "GRANDE", "idadeMeses": 36},
    ]

    def responder(pedido):
        return httpx.Response(200, json={"itens": animais})

    cliente = httpx.AsyncClient(transport=httpx.MockTransport(responder), base_url="http://a")
    # o "LLM" tenta sugerir a filhote e o cão grande
    final = {
        "sugestoes": [
            {"animalId": "d" * 24, "motivo": "filhote"},
            {"animalId": "f" * 24, "motivo": "grande"},
            {"animalId": "e" * 24, "motivo": "adulta e calma"},
        ],
        "explicacao": "x",
    }
    llm = AgenteFake({}, final)
    r = await recomendar(
        [llm],
        resiliencias(),
        cliente,
        "Moro em apartamento e trabalho 8 horas fora",
        -21.2,
        -45.0,
        10,
    )
    assert [s["nome"] for s in r["sugestoes"]] == ["Duquesa"]
    # e o modelo nem viu a filhote nem o cão grande no resultado da tool
    visto = next(m for m in llm.mensagens_vistas[-1] if getattr(m, "type", "") == "tool").content
    assert "Pipoca" not in visto and "Sol" not in visto
