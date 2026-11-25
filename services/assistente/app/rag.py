"""Perguntas com fontes (RAG, #67), com o LLM protegido pela resiliência (#69).

Fluxo de POST /v1/perguntas:
1. busca os trechos mais parecidos no Qdrant (embeddings locais);
2. nada relevante (similaridade abaixo do limiar): é pergunta fora do domínio, responde
   com orientação, sem fontes e sem chamar o LLM;
3. cache: mesma pergunta, mesma versão da base e mesmo modelo devolve a resposta salva;
4. chain do LangChain (prompt | LLM | texto) com os trechos como contexto, primeiro no
   modelo principal e, se ele falhar, no de reserva;
5. sem LLM (sem chave, circuito aberto ou provedor fora): resposta de contingência com os
   próprios trechos, degradado=true. As fontes continuam reais.
"""

import logging
import time

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
            "Use SOMENTE as informações das fontes abaixo. Se as fontes não responderem "
            "à pergunta, diga que as fontes da Ampara não cobrem esse ponto e sugira "
            "procurar um médico-veterinário ou a ONG responsável; nunca invente nomes de "
            "clínicas, horários, valores ou leis. "
            "Cite as fontes usadas no texto entre colchetes, pelo número, por exemplo [1].\n\n"
            "Fontes:\n{contexto}",
        ),
        ("human", "{pergunta}"),
    ]
)


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


def contingencia(resultados: list[Resultado]) -> str:
    principal = resultados[0].trecho
    return (
        "Não consegui gerar uma resposta completa agora, mas estas fontes da Ampara "
        "tratam do assunto. "
        f"Segundo “{principal.titulo}”: {principal.texto}"
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

    async def gerar(self, pergunta: str, resultados: list[Resultado]) -> str:
        """Tenta cada modelo, cada um com a sua resiliência. Levanta se nenhum responder."""
        ultimo: Exception = RuntimeError("sem chave do LLM: modo degradado")
        for llm, resiliencia in zip(self.llms, self.resiliencias, strict=False):
            chain = PROMPT | llm | StrOutputParser()
            try:
                return await resiliencia.chamar(
                    lambda c=chain: c.ainvoke(
                        {"pergunta": pergunta, "contexto": contexto(resultados)}
                    )
                )
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
            texto = await self.gerar(pergunta, resultados)
        except Exception as erro:  # noqa: BLE001
            self.resiliencia.metricas.fallbacks += 1
            logger.warning(
                "pergunta respondida pelo fallback", extra={"motivo": type(erro).__name__}
            )
            return {
                "resposta": contingencia(resultados),
                "fontes": fontes(resultados),
                "degradado": True,
                "cache": False,
                "latenciaMs": ms(),
            }

        resposta = {"resposta": texto.strip(), "fontes": fontes(resultados), "degradado": False}
        await self.cache.gravar(chave, resposta)
        return {**resposta, "cache": False, "latenciaMs": ms()}
