"""Tudo o que uma rota precisa chega por Depends.

Nos testes, troque qualquer dependência com app.dependency_overrides.
"""

from typing import Annotated

from fastapi import Depends

from app.config import Settings, get_settings

ConfigDep = Annotated[Settings, Depends(get_settings)]

# Molde para a #42. O Qdrant é aberto no lifespan, guardado em app.state e entregue à rota:
#
#     def get_qdrant(request: Request) -> AsyncQdrantClient:
#         return request.app.state.qdrant
#
#     QdrantDep = Annotated[AsyncQdrantClient, Depends(get_qdrant)]
#
# Nas #67 e #68, o LLM, a chain RAG e o cliente do Animais também chegam por aqui. Assim o
# teste troca o LLM por um falso e nunca gasta uma chamada de verdade.
