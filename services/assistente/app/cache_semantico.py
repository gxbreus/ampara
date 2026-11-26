"""Cache semântico de respostas: reaproveita a resposta de uma pergunta equivalente.

O cache exato (Redis) só acerta a mesma pergunta, letra por letra. Este guarda no Qdrant
o embedding da pergunta respondida, que já foi calculado para a busca, e devolve a
resposta salva quando chega uma pergunta equivalente ("Encontrei um cão abandonado, o que
fazer?" e "Achei um cachorro abandonado, o que eu faço?": similaridade 0,971).

Só a similaridade não basta. Com o modelo de embeddings da base, perguntas diferentes
chegam perto ou passam das paráfrases (medição de 26/11 em docs/llm/cache-semantico.md):
"vacinas de filhote de cão" × "vacinas de cão adulto" dá 0,956, e "meu gato pode sair" ×
"meu gato não pode sair" dá 0,934. Por isso o acerto exige três coisas juntas:

1. similaridade de cosseno >= limiar (0,97 por padrão);
2. o mesmo trecho mais relevante, e todas as fontes que a resposta salva cita entre os
   trechos recuperados agora (os trechos do fim da lista, perto do limiar de relevância,
   entram e saem entre paráfrases; a resposta só depende das fontes que ela cita);
3. os mesmos números na pergunta (lei, idade, quantidade).

E sempre com a mesma versão da base e o mesmo modelo. Como o cache exato, falha do Qdrant
aqui nunca derruba a resposta: vira um "não achei".
"""

import asyncio
import logging
import re
import time
import uuid

from qdrant_client.http import models

logger = logging.getLogger(__name__)
NAMESPACE = uuid.UUID("0b7e3c51-2f4d-4a8e-9c61-5d2f7a9e1c33")
NUMEROS = re.compile(r"\d+(?:[.,]\d+)*")


def numeros(texto: str) -> list[str]:
    """Números da pergunta, sem separador de milhar: "14.064" e "14064" são o mesmo."""
    return sorted({re.sub(r"[.,]", "", n) for n in NUMEROS.findall(texto)})


class CacheSemantico:
    def __init__(
        self,
        qdrant,
        dimensao: int,
        limiar: float,
        ttl_s: int,
        colecao: str = "ampara_cache_respostas",
        timeout_s: float = 1.0,
        agora=time.time,
    ):
        self.qdrant, self.dimensao, self.limiar, self.ttl_s = qdrant, dimensao, limiar, ttl_s
        self.colecao, self.timeout_s, self._agora = colecao, timeout_s, agora
        self._colecao_pronta = False

    def _filtro(self, versao: str, modelo: str) -> models.Filter:
        return models.Filter(
            must=[
                models.FieldCondition(key="versao", match=models.MatchValue(value=versao)),
                models.FieldCondition(key="modelo", match=models.MatchValue(value=modelo)),
                models.FieldCondition(key="expiraEm", range=models.Range(gt=self._agora())),
            ]
        )

    async def ler(
        self, vetor: list[float], pergunta: str, versao: str, modelo: str, trechos: list[str]
    ) -> dict | None:
        """`trechos`: ids dos trechos recuperados para a pergunta, do mais relevante ao menos."""
        try:
            achados = await asyncio.wait_for(
                self.qdrant.search(
                    self.colecao,
                    query_vector=vetor,
                    query_filter=self._filtro(versao, modelo),
                    limit=3,
                    score_threshold=self.limiar,
                    with_payload=True,
                ),
                timeout=self.timeout_s,
            )
        except Exception:  # noqa: BLE001 - coleção ainda não criada, Qdrant fora ou lento
            return None
        for achado in achados:
            salvo = achado.payload or {}
            if (
                trechos
                and salvo.get("principal") == trechos[0]
                and set(salvo.get("usados", [None])) <= set(trechos)
                and salvo.get("numeros") == numeros(pergunta)
            ):
                logger.info(
                    "resposta do cache semântico",
                    extra={"similaridade": round(float(achado.score), 3)},
                )
                return salvo["resposta"]
        return None

    async def _garantir_colecao(self) -> None:
        if self._colecao_pronta:
            return
        if not await self.qdrant.collection_exists(self.colecao):
            try:
                await self.qdrant.create_collection(
                    self.colecao,
                    vectors_config=models.VectorParams(
                        size=self.dimensao, distance=models.Distance.COSINE
                    ),
                )
            except Exception:
                # outra réplica criou no meio do caminho
                if not await self.qdrant.collection_exists(self.colecao):
                    raise
        self._colecao_pronta = True

    async def gravar(
        self,
        vetor: list[float],
        pergunta: str,
        versao: str,
        modelo: str,
        trechos: list[str],
        usados: list[str],
        resposta: dict,
    ) -> None:
        """`usados`: ids dos trechos que a resposta cita (vazio quando é "sem cobertura")."""
        normalizada = " ".join(pergunta.lower().split())
        ponto = models.PointStruct(
            # mesma pergunta, base e modelo: sobrescreve o mesmo ponto em vez de duplicar
            id=str(uuid.uuid5(NAMESPACE, f"{versao}:{modelo}:{normalizada}")),
            vector=vetor,
            payload={
                "versao": versao,
                "modelo": modelo,
                "pergunta": pergunta,
                "principal": trechos[0],
                "usados": usados,
                "numeros": numeros(pergunta),
                "resposta": resposta,
                "expiraEm": self._agora() + self.ttl_s,
            },
        )
        try:
            await asyncio.wait_for(self._gravar(ponto), timeout=self.timeout_s * 3)
        except Exception:  # noqa: BLE001
            logger.warning("cache semântico indisponível na escrita")

    async def _gravar(self, ponto: models.PointStruct) -> None:
        await self._garantir_colecao()
        await self.qdrant.upsert(self.colecao, points=[ponto])
        # limpeza das respostas vencidas: o filtro de leitura já as ignora
        await self.qdrant.delete(
            self.colecao,
            points_selector=models.FilterSelector(
                filter=models.Filter(
                    must=[
                        models.FieldCondition(key="expiraEm", range=models.Range(lt=self._agora()))
                    ]
                )
            ),
        )
