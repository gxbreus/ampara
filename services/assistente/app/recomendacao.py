"""Recomendação por rotina com a tool buscar_animais_disponiveis (#68).

O agente do LangChain (LLM com tool calling) lê a rotina da pessoa, decide os filtros
(espécie, porte, idade máxima) e chama a tool, que consulta a busca real de Animais
(GET /v1/animais/busca, a projeção de leitura do CQRS). Regras do contrato:

- a localização (lat, lng, raioKm) é aplicada pelo servidor dentro da tool: o LLM nunca
  vê nem escolhe coordenadas;
- a tool só devolve dados públicos de animais DISPONIVEL, sem coordenadas nem distância
  exata (vai só o bairro);
- no máximo três iterações do agente;
- só podem ser sugeridos animais que a tool devolveu: ids inventados são descartados;
- sem LLM, a recomendação usa regras simples sobre os mesmos animais (degradado=true);
  com Animais fora do ar, não há como recomendar: sugestoes=[] e degradado=true.
"""

import asyncio
import json
import logging
import re
import time
from typing import Literal

import httpx
from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import tool

from app.resiliencia import CircuitoAberto, Resiliencia

logger = logging.getLogger(__name__)
MAX_ITERACOES = 3
PORTES = {"PEQUENO": "pequeno", "MEDIO": "médio", "GRANDE": "grande"}
CAMPOS_PUBLICOS = ("id", "nome", "especie", "porte", "sexo", "idadeMeses", "bairro", "fotoThumb")

SISTEMA = (
    "Você é o assistente de recomendação da Ampara (adoção responsável). Leia a rotina "
    "da pessoa, decida filtros razoáveis e chame a ferramenta buscar_animais_disponiveis "
    "(pode chamar de novo com filtros mais amplos se vier vazio). A localização já é "
    "aplicada pelo sistema. Depois, responda SÓ com um JSON: "
    '{"sugestoes": [{"animalId": "...", "motivo": "..."}], "explicacao": "..."} '
    "com no máximo 3 sugestões, usando apenas ids devolvidos pela ferramenta. O motivo "
    "(1 frase) liga o animal à rotina e lembra de confirmar com a ONG. A explicação "
    "(até 2 frases) resume o critério. Português do Brasil. Regras: quem passa 6 horas "
    "ou mais fora de casa não deve receber filhotes (menos de 12 meses), que precisam de "
    "presença; respeite o sexo do animal ao escrever (gata/cadela para fêmeas)."
)


# Rotinas de exemplo para reconhecer, pelo sentido, se o texto descreve uma rotina de vida.
EXEMPLOS_ROTINA = [
    "Moro em apartamento pequeno e trabalho fora o dia todo",
    "Moro numa casa com quintal grande e tenho crianças",
    "Passo o dia em casa, trabalho em home office",
    "Fico muitas horas fora de casa por causa do trabalho",
    "Gosto de caminhar e correr no parque nos fins de semana",
    "Moro sozinho e quero companhia de um animal tranquilo",
    "Já tenho um cachorro e um gato em casa",
    "Tenho pouco espaço e pouco tempo livre",
    "Sou idoso e procuro um animal calmo",
    "Viajo bastante e moro em kitnet",
]
NAO_E_ROTINA = (
    "Para recomendar um animal, preciso saber um pouco da sua rotina: onde você mora "
    "(casa, apartamento, sítio), quanto tempo passa fora, se tem quintal, crianças ou "
    "outros animais. Por exemplo: “Moro em apartamento e trabalho 6 horas fora”."
)
_exemplos_cache: dict[int, object] = {}


def parece_rotina(embeddings, texto: str, limiar: float) -> bool:
    """Compara o texto com rotinas de exemplo usando o mesmo modelo de embeddings do RAG."""
    import numpy as np

    chave = id(embeddings)
    if chave not in _exemplos_cache:
        _exemplos_cache[chave] = np.array(embeddings.embed_documents(EXEMPLOS_ROTINA))
    exemplos = _exemplos_cache[chave]
    v = np.array(embeddings.embed_query(texto))
    similaridade = exemplos @ v / (np.linalg.norm(exemplos, axis=1) * np.linalg.norm(v))
    return float(similaridade.max()) >= limiar


class AnimaisIndisponivel(Exception):
    pass


class Busca:
    """A busca de Animais com a localização fixada pelo servidor."""

    def __init__(
        self,
        cliente: httpx.AsyncClient,
        lat: float,
        lng: float,
        raio_km: float,
        restricoes: dict | None = None,
    ):
        self.cliente, self.lat, self.lng, self.raio_km = cliente, lat, lng, raio_km
        # regras de bem-estar tiradas da rotina (ver regras()), aplicadas pelo servidor: o LLM
        # nem chega a ver um filhote para quem passa muitas horas fora, por mais que erre
        self.restricoes = restricoes or {}
        self.filtros_usados: dict = {"lat": lat, "lng": lng, "raioKm": raio_km}
        self.vistos: dict[str, dict] = {}

    async def __call__(
        self,
        especie: str | None = None,
        porte: str | None = None,
        idade_max_meses: int | None = None,
    ) -> list[dict]:
        params = {"lat": self.lat, "lng": self.lng, "raioKm": self.raio_km, "limite": 12}
        filtros = {"especie": especie, "porte": porte, "idadeMaxMeses": idade_max_meses}
        params.update({k: v for k, v in filtros.items() if v is not None})
        try:
            resposta = await self.cliente.get("/v1/animais/busca", params=params, timeout=3)
            resposta.raise_for_status()
        except httpx.HTTPError as erro:
            raise AnimaisIndisponivel(str(erro)) from erro
        self.filtros_usados = {k: v for k, v in params.items() if k != "limite"}
        publicos = [
            {k: a[k] for k in CAMPOS_PUBLICOS if k in a} for a in resposta.json().get("itens", [])
        ]
        if self.restricoes.get("porte_max") == "MEDIO":
            publicos = [a for a in publicos if a.get("porte") != "GRANDE"]
        if self.restricoes.get("idade_min"):
            minimo = self.restricoes["idade_min"]
            publicos = [a for a in publicos if a.get("idadeMeses", minimo) >= minimo]
        self.vistos.update({a["id"]: a for a in publicos})
        return publicos


def criar_tool(busca: Busca):
    @tool
    async def buscar_animais_disponiveis(
        especie: Literal["CAO", "GATO", "OUTRO"] | None = None,
        porte: Literal["PEQUENO", "MEDIO", "GRANDE"] | None = None,
        idade_max_meses: int | None = None,
    ) -> str:
        """Busca animais DISPONÍVEIS para adoção perto da pessoa. Todos os filtros são opcionais."""
        animais = await busca(especie, porte, idade_max_meses)
        sem_foto = [{k: v for k, v in a.items() if k != "fotoThumb"} for a in animais]
        return json.dumps(sem_foto, ensure_ascii=False)

    return buscar_animais_disponiveis


def ler_json(texto: str) -> dict:
    trecho = re.search(r"\{.*\}", texto, re.DOTALL)
    if not trecho:
        raise ValueError("o modelo não devolveu JSON")
    return json.loads(trecho.group(0))


async def agente(llm, busca: Busca, rotina: str) -> dict:
    ferramenta = criar_tool(busca)
    modelo = llm.bind_tools([ferramenta])
    mensagens = [SystemMessage(SISTEMA), HumanMessage(f"Minha rotina: {rotina}")]
    for _ in range(MAX_ITERACOES):
        resposta = await modelo.ainvoke(mensagens)
        mensagens.append(resposta)
        if not resposta.tool_calls:
            return ler_json(str(resposta.content))
        for chamada in resposta.tool_calls:
            resultado = await ferramenta.ainvoke(chamada["args"])
            mensagens.append(ToolMessage(content=resultado, tool_call_id=chamada["id"]))
    # esgotou as iterações sem resposta final: pede a conclusão sem mais tools
    final = await llm.ainvoke(
        mensagens + [HumanMessage("Conclua agora com o JSON pedido, sem chamar ferramentas.")]
    )
    return ler_json(str(final.content))


def regras(rotina: str) -> tuple[dict, str]:
    """Filtros simples a partir do texto, para o fallback sem LLM."""
    t = rotina.lower()
    filtros: dict = {}
    criterios = []
    if re.search(r"apartamento|kitnet|apto|espaço pequeno", t):
        filtros["porte_max"] = "MEDIO"
        criterios.append("moradia em apartamento (sem porte grande)")
    if re.search(r"\bgat", t) and not re.search(r"\bc[ãa]o|\bcachorr", t):
        filtros["especie"] = "GATO"
        criterios.append("preferência por gatos")
    elif re.search(r"\bc[ãa]es?\b|\bcachorr", t):
        filtros["especie"] = "CAO"
        criterios.append("preferência por cães")
    horas = re.search(r"(\d{1,2})\s*(h|horas)", t)
    if horas and int(horas.group(1)) >= 6:
        filtros["idade_min"] = 12
        criterios.append(f"{horas.group(1)} h fora de casa (filhotes precisam de mais presença)")
    return filtros, "; ".join(criterios) or "os animais disponíveis mais próximos"


async def recomendar_sem_llm(busca: Busca, rotina: str) -> dict:
    filtros, criterio = regras(rotina)
    # porte e idade já são filtrados pela Busca (restrições do servidor)
    animais = await busca(especie=filtros.get("especie"))
    sugestoes = [
        {
            "animalId": a["id"],
            "motivo": (
                f"{a['nome']} (porte {PORTES.get(a.get('porte'), 'não informado')}) "
                f"combina com {criterio}; "
                "confirme a rotina de cuidados com a ONG."
            ),
        }
        for a in animais[:3]
    ]
    explicacao = (
        "Sugestões por regras simples (o assistente de IA está indisponível agora), "
        f"considerando {criterio}."
    )
    return {"sugestoes": sugestoes, "explicacao": explicacao}


async def recomendar(
    llms: list,
    resiliencias: list[Resiliencia],
    cliente: httpx.AsyncClient,
    rotina: str,
    lat: float,
    lng: float,
    raio_km: float,
    embeddings=None,
    limiar_rotina: float = 0.45,
) -> dict:
    inicio = time.perf_counter()
    restricoes, _ = regras(rotina)
    busca = Busca(
        cliente,
        lat,
        lng,
        raio_km,
        {k: v for k, v in restricoes.items() if k in ("porte_max", "idade_min")},
    )
    # texto que não é rotina ("quem é o Neymar?"): orienta, sem buscar animais nem chamar o LLM
    if embeddings is not None and not await asyncio.to_thread(
        parece_rotina, embeddings, rotina, limiar_rotina
    ):
        return {
            "sugestoes": [],
            "explicacao": NAO_E_ROTINA,
            "filtrosUsados": busca.filtros_usados,
            "fontes": [],
            "degradado": False,
            "latenciaMs": int((time.perf_counter() - inicio) * 1000),
        }
    degradado = False
    try:
        bruto = None
        for llm, resiliencia in zip(llms, resiliencias, strict=False):
            try:
                bruto = await resiliencia.chamar(
                    lambda m=llm: agente(m, busca, rotina), repassar=(AnimaisIndisponivel,)
                )
                break
            except AnimaisIndisponivel:
                raise
            except (CircuitoAberto, Exception) as erro:  # noqa: BLE001
                logger.warning("recomendação: modelo falhou", extra={"erro": type(erro).__name__})
        if bruto is None:
            degradado = True
            if resiliencias:
                resiliencias[0].metricas.fallbacks += 1
            bruto = await recomendar_sem_llm(busca, rotina)
    except AnimaisIndisponivel:
        return {
            "sugestoes": [],
            "explicacao": (
                "Não consegui consultar os animais disponíveis agora. Tente de novo em instantes."
            ),
            "filtrosUsados": busca.filtros_usados,
            "fontes": [],
            "degradado": True,
            "latenciaMs": int((time.perf_counter() - inicio) * 1000),
        }

    # só animais que a tool devolveu: id inventado pelo modelo é descartado
    sugestoes = []
    for s in bruto.get("sugestoes", [])[:3]:
        animal = busca.vistos.get(str(s.get("animalId")))
        if not animal:
            logger.warning("sugestão com id que a busca não devolveu foi descartada")
            continue
        item = {
            "animalId": animal["id"],
            "nome": animal["nome"],
            "motivo": str(s.get("motivo", "")).strip(),
        }
        if animal.get("fotoThumb"):
            item["fotoThumb"] = animal["fotoThumb"]
        sugestoes.append(item)
    explicacao = str(bruto.get("explicacao", "")).strip()
    if not sugestoes:
        explicacao = (
            explicacao
            or "Não encontrei animais disponíveis que combinem com essa rotina no raio informado."
        )
    return {
        "sugestoes": sugestoes,
        "explicacao": explicacao,
        "filtrosUsados": busca.filtros_usados,
        "fontes": [],
        "degradado": degradado,
        "latenciaMs": int((time.perf_counter() - inicio) * 1000),
    }
