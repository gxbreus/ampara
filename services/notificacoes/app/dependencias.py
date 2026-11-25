"""Tudo o que uma rota precisa chega por Depends.

Nos testes, troque qualquer dependência com app.dependency_overrides.
"""

from typing import Annotated

from aio_pika.abc import AbstractRobustConnection
from fastapi import Depends, Request
from redis.asyncio import Redis

from app.config import Settings, get_settings

ConfigDep = Annotated[Settings, Depends(get_settings)]


def get_redis(request: Request) -> Redis:
    return request.app.state.redis


def get_rabbit(request: Request) -> AbstractRobustConnection:
    return request.app.state.rabbit


RedisDep = Annotated[Redis, Depends(get_redis)]
RabbitDep = Annotated[AbstractRobustConnection, Depends(get_rabbit)]
