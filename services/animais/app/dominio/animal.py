"""Entidades e regras de transição de status do domínio de Animais."""

from enum import Enum


class StatusAnimal(str, Enum):
    DISPONIVEL = "DISPONIVEL"
    EM_TRATAMENTO = "EM_TRATAMENTO"
    INDISPONIVEL = "INDISPONIVEL"
    RESERVADO = "RESERVADO"
    ADOTADO = "ADOTADO"


class EspecieAnimal(str, Enum):
    CAO = "CAO"
    GATO = "GATO"
    OUTRO = "OUTRO"


class PorteAnimal(str, Enum):
    PEQUENO = "PEQUENO"
    MEDIO = "MEDIO"
    GRANDE = "GRANDE"


class SexoAnimal(str, Enum):
    MACHO = "MACHO"
    FEMEA = "FEMEA"


class OrigemTransicao(str, Enum):
    MANUAL = "manual"
    SAGA = "saga"


STATUS_MANUAIS_PERMITIDOS = frozenset(
    {
        StatusAnimal.DISPONIVEL,
        StatusAnimal.EM_TRATAMENTO,
        StatusAnimal.INDISPONIVEL,
    }
)


def pode_transicionar(
    de: StatusAnimal | str,
    para: StatusAnimal | str,
    origem: OrigemTransicao | str = OrigemTransicao.MANUAL,
) -> bool:
    """Verifica se uma transição de status é permitida pelo domínio.

    Regras:
    1. Origem "manual" (responsável pela ONG via HTTP):
       - Tentativas de definir RESERVADO ou ADOTADO manualmente retornam False
         (devem resultar em 409).
       - Tentar alterar um animal que já está RESERVADO ou ADOTADO manualmente retorna False.
       - Transição para o mesmo status retorna False.
    2. Origem "saga" (comandos da SAGA via RabbitMQ):
       - DISPONIVEL -> RESERVADO (comando ReservarAnimal)
       - RESERVADO -> DISPONIVEL (comando LiberarReserva - compensação)
       - RESERVADO -> ADOTADO (comando ConfirmarAdocao - sucesso da SAGA)
       - Qualquer outra transição na SAGA retorna False.
    """
    try:
        status_de = StatusAnimal(de)
        status_para = StatusAnimal(para)
        origem_enum = OrigemTransicao(origem)
    except ValueError:
        return False

    if status_de == status_para:
        return False

    if origem_enum == OrigemTransicao.MANUAL:
        return status_de in STATUS_MANUAIS_PERMITIDOS and status_para in STATUS_MANUAIS_PERMITIDOS

    if origem_enum == OrigemTransicao.SAGA:
        transicoes_saga_validas = {
            (StatusAnimal.DISPONIVEL, StatusAnimal.RESERVADO),
            (StatusAnimal.RESERVADO, StatusAnimal.DISPONIVEL),
            (StatusAnimal.RESERVADO, StatusAnimal.ADOTADO),
        }
        return (status_de, status_para) in transicoes_saga_validas

    return False
