"""Conexão e inicialização do MongoDB para o serviço Animais.

Abre clientes assíncronos e gerencia índices sem regras de negócio.
"""

from pymongo import ASCENDING, GEOSPHERE, AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase


def criar_cliente_mongo(url: str) -> AsyncMongoClient:
    return AsyncMongoClient(url)


async def criar_indices(
    banco_escrita: AsyncDatabase,
    banco_leitura: AsyncDatabase,
) -> None:
    # 1. Banco de escrita (animais):
    # - coleção animais: índices em status e responsavel_id
    await banco_escrita.animais.create_index([("status", ASCENDING)])
    await banco_escrita.animais.create_index([("responsavel_id", ASCENDING)])

    # - coleção outbox (publicação de eventos sem dual write)
    await banco_escrita.outbox.create_index([("publicado", ASCENDING), ("created_at", ASCENDING)])

    # - coleção inbox (garantia de idempotência dos comandos da SAGA, TTL de 7 dias)
    await banco_escrita.inbox.create_index(
        [("created_at", ASCENDING)],
        expireAfterSeconds=7 * 24 * 3600,
    )

    # 2. Banco de leitura (animais_leitura - projeção CQRS):
    # - coleção animais_busca: índice geoespacial 2dsphere no campo localizacao
    await banco_leitura.animais_busca.create_index([("localizacao", GEOSPHERE)])
    await banco_leitura.animais_busca.create_index([("status", ASCENDING)])


async def verificar_mongo(cliente: AsyncMongoClient) -> bool:
    """Verifica se o cluster MongoDB responde ao comando ping."""
    try:
        resultado = await cliente.admin.command("ping")
        return bool(resultado and resultado.get("ok") == 1.0)
    except Exception:
        return False
