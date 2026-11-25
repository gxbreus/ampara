"""Rotas do contrato docs/contratos/assistente.v1.yaml: perguntas, recomendações e estado."""

from typing import Annotated

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.config import Settings
from app.dependencias import ConfigDep
from app.recomendacao import recomendar

router = APIRouter(prefix="/v1", tags=["Assistente"])


def autenticar(settings: ConfigDep, authorization: Annotated[str | None, Header()] = None) -> dict:
    """JWT RS256 da Identidade, como nos outros serviços (o Kong e o BFF já conferiram)."""
    if not settings.jwt_public_key:
        return {}
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "É necessário um JWT válido.")
    chave = settings.jwt_public_key.replace("\\n", "\n")
    try:
        return jwt.decode(
            authorization[7:], chave, algorithms=["RS256"], issuer="ampara-identidade"
        )
    except jwt.PyJWTError as erro:
        raise HTTPException(401, "É necessário um JWT válido.") from erro


Usuario = Annotated[dict, Depends(autenticar)]


def _texto(valor: str) -> str:
    valor = valor.strip()
    if not valor or len(valor) > 1000:
        raise ValueError("O texto deve conter de 1 a 1000 caracteres após aparar espaços.")
    return valor


class PerguntaEntrada(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pergunta: str

    _aparar = field_validator("pergunta")(_texto)


class RecomendacaoEntrada(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rotina: str
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    raioKm: float = Field(default=10, ge=1, le=100)

    _aparar = field_validator("rotina")(_texto)


@router.post("/perguntas")
async def perguntas(entrada: PerguntaEntrada, request: Request, _: Usuario):
    return await request.app.state.rag.responder(entrada.pergunta)


@router.post("/recomendacoes")
async def recomendacoes(
    entrada: RecomendacaoEntrada, request: Request, settings: ConfigDep, _: Usuario
):
    estado = request.app.state
    return await recomendar(
        estado.llms,
        estado.resiliencias,
        estado.animais,
        entrada.rotina,
        entrada.lat,
        entrada.lng,
        entrada.raioKm,
        embeddings=estado.rag.indice.embeddings,
        limiar_rotina=settings.limiar_rotina,
    )


@router.get("/estado", tags=["Operação"])
async def estado(request: Request, settings: ConfigDep):
    s: Settings = settings
    return {
        **request.app.state.resiliencias_estado(),
        "modelo": s.modelo if request.app.state.llms else None,
        "baseVersao": request.app.state.rag.indice.versao,
    }
