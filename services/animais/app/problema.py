"""Respostas de erro estruturadas no padrão RFC 9457 / RFC 7807 (Problem Details)."""

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict


class Problema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: str
    title: str
    status: int
    detail: str


class ProblemaHttp(HTTPException):
    def __init__(
        self,
        status_code: int,
        type_uri: str,
        title: str,
        detail: str,
        headers: dict[str, str] | None = None,
    ):
        super().__init__(
            status_code=status_code,
            detail={
                "type": type_uri,
                "title": title,
                "status": status_code,
                "detail": detail,
            },
            headers=headers,
        )


def erro_nao_autenticado(detail: str = "Envie um token Bearer JWT válido.") -> ProblemaHttp:
    return ProblemaHttp(
        status_code=401,
        type_uri="https://ampara.dev/problemas/nao-autenticado",
        title="Não autenticado",
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def erro_sem_permissao(detail: str = "Você não tem permissão para esta operação.") -> ProblemaHttp:
    return ProblemaHttp(
        status_code=403,
        type_uri="https://ampara.dev/problemas/sem-permissao",
        title="Sem permissão",
        detail=detail,
    )


def erro_animal_nao_encontrado(animal_id: str) -> ProblemaHttp:
    return ProblemaHttp(
        status_code=404,
        type_uri="https://ampara.dev/problemas/animal-nao-encontrado",
        title="Animal não encontrado",
        detail=f"Não existe animal cadastrado com o ID {animal_id}.",
    )


def erro_status_exclusivo_saga(
    detail: str = (
        "Os status RESERVADO e ADOTADO só podem ser definidos pela SAGA de adoção via mensageria."
    ),
) -> ProblemaHttp:
    return ProblemaHttp(
        status_code=409,
        type_uri="https://ampara.dev/problemas/status-exclusivo-saga",
        title="Conflito de transição de status",
        detail=detail,
    )


def erro_lote_excedido(
    detail: str = "A consulta em lote aceita no máximo 100 IDs.",
) -> ProblemaHttp:
    return ProblemaHttp(
        status_code=422,
        type_uri="https://ampara.dev/problemas/lote-excedido",
        title="Lote excedido",
        detail=detail,
    )


def erro_identificador_invalido(
    detail: str = "O identificador deve ser um ObjectId de 24 caracteres hexadecimais.",
) -> ProblemaHttp:
    return ProblemaHttp(
        status_code=400,
        type_uri="https://ampara.dev/problemas/identificador-invalido",
        title="Identificador inválido",
        detail=detail,
    )
