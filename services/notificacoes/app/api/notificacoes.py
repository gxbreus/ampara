"""Rotas internas da caixa do usuário autenticado."""

import logging
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from redis.exceptions import RedisError

from app.caixa import CursorInvalido, PaginaCaixa
from app.dependencias import CaixaDep, UsuarioDep

router = APIRouter(prefix="/v1/notificacoes", tags=["Caixa"])
logger = logging.getLogger(__name__)

PROBLEMAS = {
    400: ("Entrada inválida", "Cursor ou parâmetros inválidos."),
    401: ("Não autenticado", "É necessário um JWT válido."),
    404: ("Notificação não encontrada", "Notificação não encontrada na sua caixa."),
    503: ("Serviço indisponível", "Tente novamente mais tarde."),
}


def problema(status: int, headers: dict[str, str] | None = None) -> JSONResponse:
    titulo, detalhe = PROBLEMAS[status]
    return JSONResponse(
        {"type": "about:blank", "title": titulo, "status": status, "detail": detalhe},
        status_code=status,
        headers=headers,
        media_type="application/problem+json",
    )


async def erro_http(_request: Request, erro: HTTPException) -> JSONResponse:
    return problema(erro.status_code, erro.headers)


async def erro_validacao(_request: Request, _erro: RequestValidationError) -> JSONResponse:
    return problema(400)


async def erro_redis(request: Request, _erro: RedisError) -> JSONResponse:
    logger.warning("caixa indisponível", extra={"correlationId": request.state.correlation_id})
    return problema(503)


@router.get("")
async def listar(
    caixa: CaixaDep,
    usuario: UsuarioDep,
    naoLidas: bool = False,
    cursor: Annotated[str | None, Query(min_length=1, max_length=300)] = None,
    limite: Annotated[int, Query(ge=1, le=50)] = 20,
) -> PaginaCaixa:
    try:
        return await caixa.listar(usuario=usuario, nao_lidas=naoLidas, limite=limite, cursor=cursor)
    except CursorInvalido as erro:
        raise HTTPException(400) from erro


@router.post("/{id}/leitura", status_code=204, response_class=Response)
async def marcar_lida(id: str, caixa: CaixaDep, usuario: UsuarioDep) -> None:
    if not await caixa.marcar_lida(usuario, id):
        raise HTTPException(404)


@router.post("/leitura-todas", status_code=204, response_class=Response)
async def marcar_todas(caixa: CaixaDep, usuario: UsuarioDep) -> None:
    await caixa.marcar_todas(usuario)
