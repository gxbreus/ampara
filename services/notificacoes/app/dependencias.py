"""Tudo o que uma rota precisa chega por Depends.

Nos testes, troque qualquer dependência com app.dependency_overrides.
"""

from typing import Annotated

from fastapi import Depends

from app.config import Settings, get_settings

ConfigDep = Annotated[Settings, Depends(get_settings)]

# Molde para a #41. O Redis é aberto no lifespan, guardado em app.state e entregue à rota:
#
#     def get_redis(request: Request) -> Redis:
#         return request.app.state.redis
#
#     RedisDep = Annotated[Redis, Depends(get_redis)]
#
# Na #60, o usuário logado também chega por aqui (UsuarioDep, lido do `sub` do JWT).
# Nenhuma rota recebe usuarioId por parâmetro: isso evita ler a caixa de outra pessoa.
