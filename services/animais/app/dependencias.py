"""Tudo o que uma rota precisa chega por Depends.

Nos testes, troque qualquer dependência com app.dependency_overrides.
"""

from typing import Annotated

from fastapi import Depends, Request
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.config import Settings, get_settings

ConfigDep = Annotated[Settings, Depends(get_settings)]


def get_banco_escrita(request: Request) -> AsyncDatabase:
    return request.app.state.banco_escrita


def get_banco_leitura(request: Request) -> AsyncDatabase:
    return request.app.state.banco_leitura


def get_cliente_mongo_escrita(request: Request) -> AsyncMongoClient:
    return request.app.state.cliente_mongo_escrita


def get_cliente_mongo_leitura(request: Request) -> AsyncMongoClient:
    return request.app.state.cliente_mongo_leitura


BancoEscrita = Annotated[AsyncDatabase, Depends(get_banco_escrita)]
BancoLeitura = Annotated[AsyncDatabase, Depends(get_banco_leitura)]
ClienteMongoEscrita = Annotated[AsyncMongoClient, Depends(get_cliente_mongo_escrita)]
ClienteMongoLeitura = Annotated[AsyncMongoClient, Depends(get_cliente_mongo_leitura)]
