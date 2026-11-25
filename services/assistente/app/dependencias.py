"""Tudo o que uma rota precisa chega por Depends.

Nos testes, troque qualquer dependência com app.dependency_overrides.
"""

from typing import Annotated

from fastapi import Depends, Request
from httpx import AsyncClient
from qdrant_client import AsyncQdrantClient
from redis.asyncio import Redis

from app.config import Settings, get_settings

ConfigDep = Annotated[Settings, Depends(get_settings)]


def get_qdrant(request: Request) -> AsyncQdrantClient:
    return request.app.state.qdrant


def get_redis(request: Request) -> Redis:
    return request.app.state.redis


def get_animais(request: Request) -> AsyncClient:
    return request.app.state.animais


QdrantDep = Annotated[AsyncQdrantClient, Depends(get_qdrant)]
RedisDep = Annotated[Redis, Depends(get_redis)]
AnimaisDep = Annotated[AsyncClient, Depends(get_animais)]
