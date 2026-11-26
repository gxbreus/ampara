"""Validação dos eventos v1 e projeção em notificações por destinatário."""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, Field, field_validator

TipoEvento = Literal[
    "adocao.aguardando_aprovacao",
    "adocao.aprovada",
    "adocao.concluida",
    "adocao.recusada",
    "adocao.cancelada",
    "adocao.expirada",
    "adocao.falhou",
    "conta.verificada",
]


class Evento(BaseModel):
    messageId: UUID
    type: TipoEvento
    version: int = Field(strict=True, ge=1, le=1)
    correlationId: str = Field(min_length=1)
    sagaId: UUID | None
    occurredAt: str = Field(
        pattern=(
            r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}"
            r"(?:\.[0-9]{1,9})?(?:Z|[+-][0-9]{2}:[0-9]{2})$"
        )
    )
    payload: dict

    @field_validator("occurredAt")
    @classmethod
    def validar_instante(cls, valor: str) -> str:
        datetime.fromisoformat(valor)
        return valor


class Adocao(BaseModel):
    solicitacaoId: UUID
    animalId: str = Field(pattern=r"^[0-9a-f]{24}$")
    animalNome: str
    adotanteId: UUID
    responsavelId: UUID


class AguardandoAprovacao(Adocao):
    expiraEm: AwareDatetime


class Recusa(Adocao):
    motivo: str | None = Field(max_length=500)


class Falha(Adocao):
    animalNome: str | None
    responsavelId: UUID | None
    estadoFinal: Literal["REJEITADA_INDISPONIVEL", "PERFIL_INVALIDO", "FALHOU"]
    motivo: str = Field(min_length=1)


class ContaVerificada(BaseModel):
    contaId: UUID
    nome: str
    role: Literal["PROTETOR", "ONG"]
    cidade: str


@dataclass(frozen=True)
class Notificacao:
    usuario: UUID
    titulo: str
    texto: str
    link: str


MOTIVOS = {
    "INDISPONIVEL": "o animal não está mais disponível",
    "INEXISTENTE": "o animal não foi encontrado",
    "ANIMAL_INDISPONIVEL": "o animal não está mais disponível",
    "PERFIL_INCOMPLETO": "complete o seu perfil de adoção",
    "LIMITE_SOLICITACOES": "seu limite de solicitações simultâneas foi atingido",
    "CONTA_INEXISTENTE": "a conta do adotante não foi encontrada",
    "TIMEOUT_T1": "a reserva do animal não respondeu a tempo",
    "TIMEOUT_T2": "a verificação do perfil não respondeu a tempo",
    "CONFIRMACAO_RECUSADA": "não foi possível confirmar a reserva do animal",
}


def destinatarios(evento: Evento) -> list[Notificacao]:
    match evento.type:
        case "conta.verificada":
            conta = ContaVerificada.model_validate(evento.payload)
            return [
                Notificacao(
                    conta.contaId,
                    "Conta verificada",
                    "Sua conta foi verificada. Você já pode cadastrar animais.",
                    "/perfil",
                )
            ]
        case "adocao.aguardando_aprovacao":
            pedido = AguardandoAprovacao.model_validate(evento.payload)
            link = f"/solicitacoes/{pedido.solicitacaoId}"
            return [
                Notificacao(
                    pedido.responsavelId,
                    "Nova solicitação",
                    f"Nova solicitação para {pedido.animalNome}.",
                    link,
                ),
                Notificacao(
                    pedido.adotanteId,
                    "Solicitação enviada",
                    f"Sua solicitação para {pedido.animalNome} foi enviada.",
                    link,
                ),
            ]
        case "adocao.falhou":
            falha = Falha.model_validate(evento.payload)
            quem = f" para {falha.animalNome}" if falha.animalNome else ""
            motivo = MOTIVOS.get(falha.motivo, "tente fazer a solicitação novamente mais tarde")
            return [
                Notificacao(
                    falha.adotanteId,
                    "Falha na solicitação",
                    f"Não foi possível seguir com a solicitação{quem}: {motivo}.",
                    f"/solicitacoes/{falha.solicitacaoId}",
                )
            ]
        case "adocao.recusada":
            recusa = Recusa.model_validate(evento.payload)
            motivo = f". Motivo: {recusa.motivo}" if recusa.motivo else "."
            return [
                Notificacao(
                    recusa.adotanteId,
                    "Solicitação recusada",
                    f"Sua solicitação para {recusa.animalNome} foi recusada{motivo}",
                    f"/solicitacoes/{recusa.solicitacaoId}",
                )
            ]

    adocao = Adocao.model_validate(evento.payload)
    animal = adocao.animalNome
    usuarios = [adocao.adotanteId, adocao.responsavelId]
    match evento.type:
        case "adocao.aprovada":
            titulo, texto = "Adoção aprovada", f"A adoção de {animal} foi aprovada."
        case "adocao.concluida":
            titulo, texto = "Adoção concluída", f"A adoção de {animal} foi concluída."
        case "adocao.cancelada":
            titulo, texto = "Solicitação cancelada", f"A solicitação para {animal} foi cancelada."
        case "adocao.expirada":
            titulo, texto = "Solicitação expirada", f"A solicitação para {animal} expirou."
            usuarios = [adocao.adotanteId]

    link = f"/solicitacoes/{adocao.solicitacaoId}"
    return [Notificacao(usuario, titulo, texto, link) for usuario in dict.fromkeys(usuarios)]
