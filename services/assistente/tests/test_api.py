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
    # só Gemini 2.x: os 3.x recusam a segunda etapa da conversa com ferramenta
    assert [r.model_name for r in reservas] == ["gemini-2.5-flash"]
    assert "generativelanguage.googleapis.com" in str(principal.openai_api_base)


def test_sem_chave_nao_cria_llm():
    from app.main import criar_llms

    assert criar_llms(Settings(qdrant_url="http://q", ASSISTENTE_REDIS_URL="redis://r")) == []


def test_reservas_gratuitas_entram_depois_do_principal_na_ordem():
    from langchain_groq import ChatGroq
    from langchain_openai import ChatOpenAI

    from app.main import criar_llms

    s = Settings(
        qdrant_url="http://q",
        ASSISTENTE_REDIS_URL="redis://r",
        llm_provider="openai",
        llm_api_key="g",
        groq_api_key="q",
        openrouter_api_key="o",
    )
    llms = criar_llms(s)
    nomes = [m.model_name for m in llms]
    assert nomes[:2] == ["gemini-2.5-flash-lite", "gemini-2.5-flash"]
    assert nomes[2:4] == ["qwen/qwen3.8-27b", "openai/gpt-oss-120b"]
    assert all(isinstance(m, ChatGroq) for m in llms[2:4])
    assert all(n.endswith(":free") for n in nomes[4:]) and len(nomes) == 7
    assert all(isinstance(m, ChatOpenAI) for m in llms[4:])
    assert "openrouter.ai" in str(llms[4].openai_api_base)


def test_so_a_chave_da_groq_ainda_responde_com_llm():
    from app.main import criar_llms

    s = Settings(qdrant_url="http://q", ASSISTENTE_REDIS_URL="redis://r", groq_api_key="q")
    assert [m.model_name for m in criar_llms(s)] == ["qwen/qwen3.8-27b", "openai/gpt-oss-120b"]


def test_mesmo_modelo_da_groq_nao_entra_duas_vezes():
    from app.main import criar_llms

    s = Settings(
        qdrant_url="http://q",
        ASSISTENTE_REDIS_URL="redis://r",
        llm_provider="groq",
        llm_api_key="q",
        groq_api_key="q",
    )
    nomes = [m.model_name for m in criar_llms(s)]
    assert nomes == ["openai/gpt-oss-120b", "qwen/qwen3.8-27b"]


def test_llm_ordem_poe_a_groq_na_frente_sem_perder_os_outros_grupos():
    from app.main import criar_llms

    s = Settings(
        qdrant_url="http://q",
        ASSISTENTE_REDIS_URL="redis://r",
        llm_provider="openai",
        llm_api_key="g",
        groq_api_key="q",
        openrouter_api_key="o",
        llm_ordem="groq, principal",
    )
    nomes = [m.model_name for m in criar_llms(s)]
    assert nomes[:4] == [
        "qwen/qwen3.8-27b",
        "openai/gpt-oss-120b",
        "gemini-2.5-flash-lite",
        "gemini-2.5-flash",
    ]
    # o grupo não citado vem depois, na ordem padrão
    assert all(n.endswith(":free") for n in nomes[4:])
