"""Rotas do contrato: autenticação, validação (422 em problem+json) e estado."""

import time

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import create_app
from app.resiliencia import Resiliencia


class RagFake:
    class indice:  # noqa: N801
        versao = "v1"

    async def responder(self, pergunta):
        return {
            "resposta": f"eco: {pergunta}",
            "fontes": [],
            "degradado": False,
            "cache": False,
            "latenciaMs": 1,
        }


@pytest.fixture(scope="module")
def chaves():
    privada = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    publica = privada.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    return privada, publica.decode()


def cliente(publica: str = "") -> TestClient:
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(
        qdrant_url="http://q", ASSISTENTE_REDIS_URL="redis://r", jwt_public_key=publica
    )
    app.state.rag = RagFake()
    app.state.llms = []
    resiliencia = Resiliencia(1.0)
    app.state.resiliencias = [resiliencia]
    app.state.resiliencias_estado = resiliencia.estado
    return TestClient(app)


def token(privada, **extra):
    claims = {
        "iss": "ampara-identidade",
        "sub": "u1",
        "role": "ADOTANTE",
        "exp": int(time.time()) + 60,
        **extra,
    }
    return jwt.encode(claims, privada, algorithm="RS256")


def test_pergunta_sem_jwt_da_401_em_problem_json(chaves):
    r = cliente(chaves[1]).post("/v1/perguntas", json={"pergunta": "oi"})
    assert r.status_code == 401 and r.headers["content-type"].startswith("application/problem+json")


def test_pergunta_com_jwt_valido(chaves):
    r = cliente(chaves[1]).post(
        "/v1/perguntas",
        json={"pergunta": "  vacina  "},
        headers={"Authorization": f"Bearer {token(chaves[0])}"},
    )
    assert r.status_code == 200 and r.json()["resposta"] == "eco: vacina"  # o texto chega aparado


def test_jwt_de_outro_emissor_da_401(chaves):
    r = cliente(chaves[1]).post(
        "/v1/perguntas",
        json={"pergunta": "oi"},
        headers={"Authorization": f"Bearer {token(chaves[0], iss='outro')}"},
    )
    assert r.status_code == 401


@pytest.mark.parametrize(
    "corpo", [{"pergunta": "   "}, {"pergunta": "x" * 1001}, {"pergunta": "oi", "extra": 1}, {}]
)
def test_texto_invalido_da_422(corpo):
    r = cliente().post("/v1/perguntas", json=corpo)
    assert r.status_code == 422 and r.json()["title"] == "Dados inválidos"


def test_recomendacao_exige_lat_lng():
    r = cliente().post("/v1/recomendacoes", json={"rotina": "moro em casa"})
    assert r.status_code == 422


def test_estado_do_circuito():
    r = cliente().get("/v1/estado")
    assert r.status_code == 200
    corpo = r.json()
    assert (
        corpo["circuito"] == "fechado" and corpo["baseVersao"] == "v1" and corpo["modelo"] is None
    )
    assert {
        "falhasConsecutivas",
        "chamadas",
        "falhas",
        "fallbacks",
        "cacheHits",
        "cacheSemanticoHits",
        "tentarNovamenteEm",
    } <= corpo.keys()


def test_provedor_compativel_com_openai_usa_o_gemini_por_padrao():
    from langchain_openai import ChatOpenAI

    from app.main import criar_llms

    s = Settings(
        qdrant_url="http://q",
        ASSISTENTE_REDIS_URL="redis://r",
        llm_provider="openai",
        llm_api_key="x",
    )
    principal, *reservas = criar_llms(s)
    assert isinstance(principal, ChatOpenAI) and principal.model_name == "gemini-2.5-flash-lite"
    # cota diária por modelo no plano gratuito: várias reservas multiplicam a cota
    assert [r.model_name for r in reservas] == [
        "gemini-3.5-flash-lite",
        "gemini-flash-lite-latest",
        "gemini-3.5-flash",
        "gemini-2.5-flash",
    ]
    assert "generativelanguage.googleapis.com" in str(principal.openai_api_base)


def test_sem_chave_nao_cria_llm():
    from app.main import criar_llms

    assert criar_llms(Settings(qdrant_url="http://q", ASSISTENTE_REDIS_URL="redis://r")) == []
