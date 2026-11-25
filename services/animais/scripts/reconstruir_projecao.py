"""Recria o read model. Pare os escritores e o consumidor antes de executar."""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings  # noqa: E402
from app.db import criar_cliente_mongo, criar_indices  # noqa: E402
from app.projetor import aplicar_evento  # noqa: E402
from app.repositorio.animais import montar_evento_outbox  # noqa: E402


async def reconstruir():
    config = get_settings()
    async with criar_cliente_mongo(config.mongo_url.get_secret_value()) as escrita:
        async with criar_cliente_mongo(config.leitura_mongo_url.get_secret_value()) as leitura:
            origem, destino = escrita.get_database(), leitura.get_database()
            await destino.animais_busca.delete_many({})
            await criar_indices(origem, destino)
            async for doc in origem.animais.find({}):
                evento = montar_evento_outbox("animal.atualizado", doc)
                await aplicar_evento(
                    origem,
                    destino,
                    {
                        **evento,
                        "occurredAt": doc["atualizadoEm"].isoformat(),
                        "correlationId": evento["messageId"],
                    },
                )
            print(f"Projetados: {await destino.animais_busca.count_documents({})}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--confirmar", action="store_true", required=True)
    parser.parse_args()
    asyncio.run(reconstruir())
