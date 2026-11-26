"""Tudo o que uma rota precisa chega por Depends.

Nos testes, troque qualquer dependência com app.dependency_overrides.
"""

from typing import Annotated
from uuid import UUID

import jwt
from aio_pika.abc import AbstractRobustConnection
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from redis.asyncio import Redis

from app.caixa import Caixa
from app.config import Settings, get_settings

ConfigDep = Annotated[Settings, Depends(get_settings)]
Bearer = Annotated[HTTPAuthorizationCredentials | None, Depends(HTTPBearer(auto_error=False))]


def get_redis(request: Request) -> Redis:
    return request.app.state.redis


def get_rabbit(request: Request) -> AbstractRobustConnection:
    return request.app.state.rabbit


def get_caixa(request: Request) -> Caixa:
    return request.app.state.caixa


def autenticar(settings: ConfigDep, bearer: Bearer) -> UUID:
    if bearer is None:
        raise HTTPException(401, headers={"WWW-Authenticate": "Bearer"})
    try:
        claims = jwt.decode(
            bearer.credentials,
            settings.jwt_public_key.replace("\\n", "\n"),
            algorithms=["RS256"],
            issuer="ampara-identidade",
            options={"require": ["exp", "sub"]},
        )
        return UUID(claims["sub"])
    except (jwt.PyJWTError, ValueError) as erro:
        raise HTTPException(401, headers={"WWW-Authenticate": "Bearer"}) from erro


RedisDep = Annotated[Redis, Depends(get_redis)]
RabbitDep = Annotated[AbstractRobustConnection, Depends(get_rabbit)]
CaixaDep = Annotated[Caixa, Depends(get_caixa)]
UsuarioDep = Annotated[UUID, Depends(autenticar)]
