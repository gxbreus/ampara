"""Perguntas com fontes (RAG, #67), com o LLM protegido pela resiliência (#69).

Fluxo de POST /v1/perguntas:
1. busca os trechos mais parecidos no Qdrant (embeddings locais);
2. nada relevante (similaridade abaixo do limiar): é pergunta fora do domínio, responde
   com orientação, sem fontes e sem chamar o LLM;
3. cache: mesma pergunta, mesma versão da base e mesmo modelo devolve a resposta salva;
4. chain do LangChain (prompt | LLM | texto) com os trechos como contexto, primeiro no
   modelo principal e, se ele falhar, no de reserva;
5. checagem de citação: a resposta só é aceita se citar, pelo número, fontes que existem;
   sem citação ou citando [n] inexistente, tenta o modelo de reserva e depois cai na
   contingência. Se o modelo disser que as fontes não cobrem o assunto (marcador
   SEM_COBERTURA), a resposta sai sem fontes, como pede o contrato;
6. sem LLM (sem chave, circuito aberto ou provedor fora): resposta de contingência com os
   próprios trechos, degradado=true. As fontes continuam reais.
"""

import logging
import re
import time
from dataclasses import dataclass

from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate

from app.indice import Indice, Resultado
from app.resiliencia import Cache, CircuitoAberto, Resiliencia

logger = logging.getLogger(__name__)

FORA_DO_DOMINIO = (
    "Eu só consigo ajudar com adoção responsável e cuidados com cães e gatos, "
    "usando as fontes da Ampara. Tente perguntar, por exemplo, sobre vacinação de "
    "filhotes, adaptação ao novo lar ou o processo de adoção."
)

PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "Você é o assistente da Ampara, uma plataforma de adoção responsável de animais. "
            "Responda em português do Brasil, em até 5 frases, de forma clara e acolhedora. "
            "Use SOMENTE as informações das fontes abaixo e cite cada fonte usada entre "
            "colchetes, pelo número, por exemplo [1] ou [1, 2]; toda resposta deve ter ao "
            "menos uma citação. Se as fontes não responderem à pergunta, comece a resposta "
            "exatamente com SEM_COBERTURA: e diga, sem citar fontes, que as fontes da Ampara "
            "não cobrem esse ponto, sugerindo procurar um médico-veterinário ou a ONG "
            "responsável. Nunca invente nomes de clínicas, horários, valores ou leis.\n\n"
            "Fontes:\n{contexto}",
        ),
        ("human", "{pergunta}"),
    ]
)


SEM_COBERTURA = (
    "As fontes da Ampara não cobrem esse ponto. Procure um médico-veterinário ou a ONG "
    "responsável pelo animal."
)
CITACAO = re.compile(r"\[(\d+(?:\s*[,;]\s*\d+)*)\]")


class CitacaoInvalida(Exception):
    """A resposta do LLM não cita fontes, ou cita uma fonte que não existe."""


@dataclass
class Verificada:
    texto: str
    usados: list  # Resultado citados, na ordem em que aparecem; vazio = sem cobertura


def verificar_citacoes(texto: str, resultados: list[Resultado]) -> Verificada:
    """Aceita a resposta só com citações válidas e renumera pela ordem de aparição.

    A lista de fontes devolvida passa a ser só a das citadas, então [1] no texto é sempre a
    primeira fonte da lista que o app mostra.
    """
    t = texto.strip()
    if t.upper().startswith("SEM_COBERTURA"):
        corpo = CITACAO.sub("", t.split(":", 1)[1] if ":" in t else "")
        corpo = re.sub(r"\s+([.,;:!?])", r"\1", corpo).strip()  # sem o espaço que a citação deixou
        return Verificada(corpo or SEM_COBERTURA, [])
    numeros = [int(n) for g in CITACAO.findall(t) for n in re.split(r"\s*[,;]\s*", g)]
    if not numeros:
        # o modelo disse que não há cobertura, mas esqueceu o marcador: não inventa fontes
        if re.search(r"n[ãa]o cobre|n[ãa]o tratam|n[ãa]o h[áa] informa", t, re.IGNORECASE):
            return Verificada(t, [])
        raise CitacaoInvalida("resposta sem citação")
    inexistentes = sorted({n for n in numeros if not 1 <= n <= len(resultados)})
    if inexistentes:
        raise CitacaoInvalida(f"cita fonte inexistente: {inexistentes}")
    ordem = list(dict.fromkeys(numeros))
    novo = {antigo: i for i, antigo in enumerate(ordem, 1)}

    def renumerar(m: re.Match) -> str:
        return "[" + ", ".join(str(novo[int(n)]) for n in re.split(r"\s*[,;]\s*", m.group(1))) + "]"

    return Verificada(CITACAO.sub(renumerar, t), [resultados[n - 1] for n in ordem])


def contexto(resultados: list[Resultado]) -> str:
    return "\n\n".join(
        f"[{i}] {r.trecho.titulo} — {r.trecho.secao}\n{r.trecho.texto}"
        for i, r in enumerate(resultados, 1)
    )


def fontes(resultados: list[Resultado]) -> list[dict]:
    return [
        {"titulo": r.trecho.titulo, "trecho": r.trecho.texto[:280], "origem": r.trecho.origem}
        for r in resultados
    ]


def resumo(texto: str, frases: int = 2) -> str:
    partes = re.split(r"(?<=[.!?])\s+", texto.strip())
    return " ".join(partes[:frases])


def contingencia(resultados: list[Resultado]) -> str:
    """Sem LLM: junta o começo dos trechos mais relevantes, cada um com a sua fonte.

    O assunto costuma estar espalhado por textos curtos da base, então um trecho só (o
    primeiro) deixava a resposta pobre quando a busca não acertava a ordem.
    """
    usados = resultados[:3]
    partes = [f"“{r.trecho.titulo}”: {resumo(r.trecho.texto)}" for r in usados]
    return (
        "Não consegui gerar uma resposta completa agora. Veja o que as fontes da Ampara "
        "dizem sobre o assunto. " + " ".join(partes)
    )


class Rag:
    def __init__(
        self, indice: Indice, llms: list, resiliencias: list[Resiliencia], cache: Cache, settings
    ):
        # llms e resiliencias andam em pares: [principal, reserva]; lista vazia = sem chave
        self.indice, self.llms, self.resiliencias, self.cache = indice, llms, resiliencias, cache
        self.settings = settings

    @property
    def resiliencia(self) -> Resiliencia:
        return self.resiliencias[0]

    async def recuperar(self, pergunta: str) -> list[Resultado]:
        achados = await self.indice.buscar(pergunta, self.settings.trechos_por_resposta)
        return [r for r in achados if r.score >= self.settings.limiar_relevancia]

    async def gerar(self, pergunta: str, resultados: list[Resultado]) -> Verificada:
        """Tenta cada modelo, cada um com a sua resiliência, e só aceita resposta com citação
        válida. Levanta se nenhum modelo devolver uma resposta aceitável."""
        ultimo: Exception = RuntimeError("sem chave do LLM: modo degradado")
        for llm, resiliencia in zip(self.llms, self.resiliencias, strict=False):
            chain = PROMPT | llm | StrOutputParser()
            try:
                texto = await resiliencia.chamar(
                    lambda c=chain: c.ainvoke(
                        {"pergunta": pergunta, "contexto": contexto(resultados)}
                    )
                )
                return verificar_citacoes(texto, resultados)
            except CitacaoInvalida as erro:
                # o provedor respondeu, então não é falha de disponibilidade: não mexe no
                # circuito, só conta e tenta o próximo modelo
                self.resiliencia.metricas.citacoes_invalidas += 1
                logger.warning(
                    "resposta recusada na checagem de citação", extra={"motivo": str(erro)}
                )
                ultimo = erro
            except CircuitoAberto as erro:
                ultimo = erro
            except Exception as erro:  # noqa: BLE001 - qualquer falha do provedor vira fallback
                ultimo = erro
        raise ultimo

    async def responder(self, pergunta: str) -> dict:
        inicio = time.perf_counter()
        ms = lambda: int((time.perf_counter() - inicio) * 1000)  # noqa: E731

        resultados = await self.recuperar(pergunta)
        if not resultados:
            return {
                "resposta": FORA_DO_DOMINIO,
                "fontes": [],
                "degradado": False,
                "cache": False,
                "latenciaMs": ms(),
            }

        modelo = self.settings.modelo
        chave = Cache.chave("pergunta", self.indice.versao, modelo, pergunta)
        salvo = await self.cache.ler(chave)
        if salvo:
            self.resiliencia.metricas.cache_hits += 1
            return {**salvo, "cache": True, "latenciaMs": ms()}

        try:
            verificada = await self.gerar(pergunta, resultados)
        except Exception as erro:  # noqa: BLE001
            self.resiliencia.metricas.fallbacks += 1
            logger.warning(
                "pergunta respondida pelo fallback", extra={"motivo": type(erro).__name__}
            )
            return {
                "resposta": contingencia(resultados),
                "fontes": fontes(resultados[:3]),
                "degradado": True,
                "cache": False,
                "latenciaMs": ms(),
            }

        resposta = {
            "resposta": verificada.texto,
            "fontes": fontes(verificada.usados),
            "degradado": False,
        }
        await self.cache.gravar(chave, resposta)
        return {**resposta, "cache": False, "latenciaMs": ms()}
