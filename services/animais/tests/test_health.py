from fastapi.testclient import TestClient


def test_health_responde_ok(cliente: TestClient):
    resposta = cliente.get("/health")

    assert resposta.status_code == 200
    assert resposta.json() == {"status": "ok"}
