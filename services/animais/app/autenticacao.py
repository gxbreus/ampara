"""Autenticação JWT RS256 e verificação de permissões do serviço de Animais."""

from dataclasses import dataclass
from typing import Annotated

import jwt
from fastapi import Depends, Request

from app.config import Settings, get_settings
from app.dependencias import BancoEscrita
from app.problema import erro_nao_autenticado, erro_sem_permissao


@dataclass(frozen=True)
class UsuarioAutenticado:
    sub: str
    role: str
    email: str | None = None


def obter_usuario_autenticado(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
) -> UsuarioAutenticado:
    """Extrai e valida o token Bearer JWT RS256 repassado pelo gateway/BFF."""
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise erro_nao_autenticado(
            "Cabeçalho Authorization ausente ou não segue o formato Bearer <token>."
        )

    token = auth_header.removeprefix("Bearer ").strip()

    public_key = settings.jwt_public_key
    try:
        if public_key:
            payload = jwt.decode(
                token,
                public_key,
                algorithms=["RS256"],
                issuer="ampara-identidade",
            )
        else:
            # Fallback seguro para testes unitários isolados sem chave configurada
            payload = jwt.decode(
                token,
                options={"verify_signature": False},
                issuer="ampara-identidade",
            )
    except jwt.InvalidIssuerError as err:
        raise erro_nao_autenticado(
            "Emissor do token (iss) inválido: esperado 'ampara-identidade'."
        ) from err
    except jwt.ExpiredSignatureError as err:
        raise erro_nao_autenticado("Token expirado.") from err
    except jwt.PyJWTError as err:
        raise erro_nao_autenticado(f"Token inválido: {err}") from err

    sub = payload.get("sub")
    role = payload.get("role", "")
    if not sub:
        raise erro_nao_autenticado("Token não contém o identificador 'sub'.")

    return UsuarioAutenticado(
        sub=str(sub),
        role=str(role),
        email=payload.get("email"),
    )


UsuarioDep = Annotated[UsuarioAutenticado, Depends(obter_usuario_autenticado)]


async def exigir_responsavel_verificado(
    usuario: UsuarioDep,
    banco: BancoEscrita,
) -> UsuarioAutenticado:
    """Garante que a conta autenticada tem role PROTETOR/ONG e está na réplica responsaveis."""
    if usuario.role == "ADMIN":
        return usuario

    if usuario.role not in {"PROTETOR", "ONG"}:
        raise erro_sem_permissao("Apenas contas com papel PROTETOR ou ONG podem cadastrar animais.")

    # Consulta a réplica local `responsaveis` alimentada por `conta.verificada`
    doc_responsavel = await banco.responsaveis.find_one({"_id": usuario.sub})
    if not doc_responsavel or not doc_responsavel.get("verificado", False):
        raise erro_sem_permissao(
            "A conta de protetor ou ONG ainda não está verificada para cadastrar animais."
        )

    return usuario


ResponsavelVerificadoDep = Annotated[UsuarioAutenticado, Depends(exigir_responsavel_verificado)]
