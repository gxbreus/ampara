from datetime import UTC, datetime

from app.schemas.animal import HistoricoStatusItem


def test_historico_aceita_saga_id_gravado_pela_saga():
    # regressão: saga.py grava sagaId no histórico; o schema com extra="forbid" recusava
    # e toda listagem de animais respondia 500 depois da primeira reserva
    item = HistoricoStatusItem(
        status="RESERVADO",
        motivo="ReservarAnimal",
        alteradoEm=datetime.now(UTC),
        alteradoPor="SAGA",
        sagaId="f3d4574a-c91b-45c4-88da-cc8205c15360",
    )
    assert item.sagaId == "f3d4574a-c91b-45c4-88da-cc8205c15360"


def test_historico_manual_continua_sem_saga_id():
    item = HistoricoStatusItem(
        status="EM_TRATAMENTO", alteradoEm=datetime.now(UTC), alteradoPor="RESPONSAVEL"
    )
    assert item.sagaId is None
