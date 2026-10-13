import pytest

from app.dominio.animal import (
    OrigemTransicao,
    StatusAnimal,
    pode_transicionar,
)


def test_transicoes_manuais_validas():
    # DISPONIVEL <-> EM_TRATAMENTO
    assert (
        pode_transicionar(
            StatusAnimal.DISPONIVEL, StatusAnimal.EM_TRATAMENTO, OrigemTransicao.MANUAL
        )
        is True
    )
    assert (
        pode_transicionar(
            StatusAnimal.EM_TRATAMENTO, StatusAnimal.DISPONIVEL, OrigemTransicao.MANUAL
        )
        is True
    )

    # DISPONIVEL <-> INDISPONIVEL
    assert (
        pode_transicionar(
            StatusAnimal.DISPONIVEL, StatusAnimal.INDISPONIVEL, OrigemTransicao.MANUAL
        )
        is True
    )
    assert (
        pode_transicionar(
            StatusAnimal.INDISPONIVEL, StatusAnimal.DISPONIVEL, OrigemTransicao.MANUAL
        )
        is True
    )

    # EM_TRATAMENTO <-> INDISPONIVEL
    assert (
        pode_transicionar(
            StatusAnimal.EM_TRATAMENTO, StatusAnimal.INDISPONIVEL, OrigemTransicao.MANUAL
        )
        is True
    )
    assert (
        pode_transicionar(
            StatusAnimal.INDISPONIVEL, StatusAnimal.EM_TRATAMENTO, OrigemTransicao.MANUAL
        )
        is True
    )


@pytest.mark.parametrize("status_proibido", [StatusAnimal.RESERVADO, StatusAnimal.ADOTADO])
def test_transicoes_manuais_proibidas_para_reservado_e_adotado(status_proibido):
    # Proibido definir RESERVADO ou ADOTADO manualmente (exclusivo da SAGA)
    assert (
        pode_transicionar(StatusAnimal.DISPONIVEL, status_proibido, OrigemTransicao.MANUAL) is False
    )
    assert (
        pode_transicionar(StatusAnimal.EM_TRATAMENTO, status_proibido, OrigemTransicao.MANUAL)
        is False
    )
    assert (
        pode_transicionar(StatusAnimal.INDISPONIVEL, status_proibido, OrigemTransicao.MANUAL)
        is False
    )


@pytest.mark.parametrize("status_atual", [StatusAnimal.RESERVADO, StatusAnimal.ADOTADO])
@pytest.mark.parametrize("status_destino", list(StatusAnimal))
def test_transicoes_manuais_a_partir_de_reservado_ou_adotado_sao_bloqueadas(
    status_atual, status_destino
):
    # Uma vez reservado ou adotado, intervenção manual direta é proibida
    assert pode_transicionar(status_atual, status_destino, OrigemTransicao.MANUAL) is False


def test_transicao_para_mesmo_status_retorna_falso():
    for status in StatusAnimal:
        assert pode_transicionar(status, status, OrigemTransicao.MANUAL) is False
        assert pode_transicionar(status, status, OrigemTransicao.SAGA) is False


def test_transicoes_saga_validas():
    # ReservarAnimal: DISPONIVEL -> RESERVADO
    assert (
        pode_transicionar(StatusAnimal.DISPONIVEL, StatusAnimal.RESERVADO, OrigemTransicao.SAGA)
        is True
    )

    # LiberarReserva (compensação): RESERVADO -> DISPONIVEL
    assert (
        pode_transicionar(StatusAnimal.RESERVADO, StatusAnimal.DISPONIVEL, OrigemTransicao.SAGA)
        is True
    )

    # ConfirmarAdocao: RESERVADO -> ADOTADO
    assert (
        pode_transicionar(StatusAnimal.RESERVADO, StatusAnimal.ADOTADO, OrigemTransicao.SAGA)
        is True
    )


def test_transicoes_saga_invalidas():
    # SAGA não pode pular direto de DISPONIVEL para ADOTADO
    assert (
        pode_transicionar(StatusAnimal.DISPONIVEL, StatusAnimal.ADOTADO, OrigemTransicao.SAGA)
        is False
    )

    # SAGA não opera sobre EM_TRATAMENTO ou INDISPONIVEL
    assert (
        pode_transicionar(StatusAnimal.EM_TRATAMENTO, StatusAnimal.RESERVADO, OrigemTransicao.SAGA)
        is False
    )
    assert (
        pode_transicionar(StatusAnimal.INDISPONIVEL, StatusAnimal.RESERVADO, OrigemTransicao.SAGA)
        is False
    )


def test_status_ou_origem_invalidos_retornam_falso():
    assert pode_transicionar("STATUS_INEXISTENTE", StatusAnimal.DISPONIVEL) is False
    assert pode_transicionar(StatusAnimal.DISPONIVEL, "STATUS_INEXISTENTE") is False
    assert (
        pode_transicionar(StatusAnimal.DISPONIVEL, StatusAnimal.EM_TRATAMENTO, "origem_invalida")
        is False
    )
