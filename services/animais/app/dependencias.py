"""Tudo o que uma rota precisa chega por Depends.

Nos testes, troque qualquer dependência com app.dependency_overrides.
"""

from typing import Annotated

from fastapi import Depends

from app.config import Settings, get_settings

ConfigDep = Annotated[Settings, Depends(get_settings)]

# Molde para a #39. O banco é aberto no lifespan, guardado em app.state e entregue à rota:
#
#     def get_banco_escrita(request: Request) -> AsyncDatabase:
#         return request.app.state.banco_escrita
#
#     BancoEscrita = Annotated[AsyncDatabase, Depends(get_banco_escrita)]
#
# A busca (#56) recebe só o banco de leitura, e a escrita (#55) só o de escrita: é o CQRS
# visível na assinatura das funções.
