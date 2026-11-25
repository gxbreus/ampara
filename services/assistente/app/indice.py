"""Embeddings locais e índice vetorial no Qdrant (#66).

- Embeddings: fastembed (ONNX em CPU), modelo multilíngue de 384 dimensões. O modelo é
  baixado no build da imagem (FASTEMBED_CACHE_PATH) e carregado com local_files_only: o
  pod roda com o sistema de arquivos somente leitura e a demo pode estar sem internet.
- Índice: uma coleção por versão da base (ampara_kb_<versão>). Os ids dos pontos são
  derivados do id do trecho (uuid5), então indexar de novo, ou duas réplicas indexando ao
  mesmo tempo na subida, só sobrescreve os mesmos pontos.
"""

import asyncio
import logging
import os
import uuid
from dataclasses import dataclass

from qdrant_client import AsyncQdrantClient
from qdrant_client.http import models

from app.conhecimento import Trecho

logger = logging.getLogger(__name__)
NAMESPACE = uuid.UUID("6f1c2b0e-6a3c-4c5e-9d2a-7a1d3e5f8b90")


class Embeddings:
    """Implementa a interface de embeddings do LangChain (embed_documents/embed_query)."""

    def __init__(self, modelo: str):
        from fastembed import TextEmbedding

        cache = os.environ.get("FASTEMBED_CACHE_PATH")
        self._modelo = TextEmbedding(modelo, cache_dir=cache, local_files_only=bool(cache))
        self.dimensao = len(next(iter(self._modelo.query_embed("teste"))))

    def embed_documents(self, textos: list[str]) -> list[list[float]]:
        return [v.tolist() for v in self._modelo.embed(textos)]

    def embed_query(self, texto: str) -> list[float]:
        return next(iter(self._modelo.query_embed(texto))).tolist()

    async def aembed_query(self, texto: str) -> list[float]:
        return await asyncio.to_thread(self.embed_query, texto)


@dataclass
class Resultado:
    trecho: Trecho
    score: float


class Indice:
    def __init__(self, qdrant: AsyncQdrantClient, embeddings: Embeddings, versao: str):
        self.qdrant, self.embeddings, self.versao = qdrant, embeddings, versao
        self.colecao = f"ampara_kb_{versao}"

    async def garantir(self, trechos: list[Trecho]) -> int:
        """Cria e popula a coleção desta versão da base, se ainda não existir."""
        if await self.qdrant.collection_exists(self.colecao):
            info = await self.qdrant.get_collection(self.colecao)
            if (info.points_count or 0) >= len(trechos):
                return 0
        else:
            try:
                await self.qdrant.create_collection(
                    self.colecao,
                    vectors_config=models.VectorParams(
                        size=self.embeddings.dimensao, distance=models.Distance.COSINE
                    ),
                )
            except Exception:
                # outra réplica criou no meio do caminho: segue para o upsert idempotente
                if not await self.qdrant.collection_exists(self.colecao):
                    raise
        vetores = await asyncio.to_thread(
            self.embeddings.embed_documents, [f"{t.titulo} — {t.secao}\n{t.texto}" for t in trechos]
        )
        await self.qdrant.upsert(
            self.colecao,
            points=[
                models.PointStruct(
                    id=str(uuid.uuid5(NAMESPACE, t.id)), vector=v, payload=t.__dict__
                )
                for t, v in zip(trechos, vetores, strict=True)
            ],
        )
        logger.info("base indexada", extra={"colecao": self.colecao, "trechos": len(trechos)})
        return len(trechos)

    async def buscar(self, pergunta: str, k: int) -> list[Resultado]:
        vetor = await self.embeddings.aembed_query(pergunta)
        achados = await self.qdrant.search(
            self.colecao, query_vector=vetor, limit=k, with_payload=True
        )
        return [Resultado(Trecho(**p.payload), float(p.score)) for p in achados]
