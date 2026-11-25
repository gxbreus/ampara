"""Configuração do serviço, lida só de variáveis de ambiente.

Diferente dos outros serviços, aqui não há prefixo: os nomes já estão no .env.example
(LLM_PROVIDER, LLM_MODEL, LLM_API_KEY, LLM_FALLBACK_MODEL, QDRANT_URL). A exceção é o
Redis, que usa validation_alias para ler ASSISTENTE_REDIS_URL.

Regras:
- Chame get_settings() só no lifespan e nas dependências (Depends), nunca no topo de
  um módulo nem em create_app(): importar o app não pode exigir variável de ambiente.
- URL com senha e chave são SecretStr. A URL do Redis não tem valor padrão.
- LLM_API_KEY é a única exceção: vazia é um estado válido (modo degradado, com
  fallback). Por isso ela tem padrão vazio e o serviço sobe sem ela.
"""

from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings

# kb/ fica ao lado de app/ no repositório e na imagem (/app/kb)
KB_PADRAO = Path(__file__).resolve().parent.parent / "kb"


class Settings(BaseSettings):
    llm_provider: str = "groq"
    # vazio no .env = estes padrões (decisão 7 do requisitos.md: free tier da Groq, com tools)
    llm_model: str = ""
    llm_api_key: SecretStr = SecretStr("")
    llm_fallback_model: str = ""
    # embeddings locais, multilíngues e leves (fastembed, ONNX em CPU): o modelo vem na
    # imagem, então funciona sem internet; o bge-m3 via Ollama não cabia na máquina da demo
    embeddings_model: str = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    qdrant_url: str
    redis_url: SecretStr = Field(validation_alias="ASSISTENTE_REDIS_URL")
    animais_url: str = "http://animais:8001"
    # chave pública RS256 da Identidade; vazia desliga a verificação (só nos testes)
    jwt_public_key: str = ""
    kb_dir: Path = KB_PADRAO
    # abaixo disto a pergunta está fora do domínio (medido: perguntas da base ≥ 0,48,
    # "capital da França" 0,10) e não vai ao LLM
    limiar_relevancia: float = 0.30
    trechos_por_resposta: int = 3
    timeout_llm_s: float = 12.0
    cache_ttl_s: int = 24 * 3600

    @property
    def modelo(self) -> str:
        return self.llm_model or "openai/gpt-oss-120b"

    @property
    def modelo_reserva(self) -> str:
        return self.llm_fallback_model or "llama-3.1-8b-instant"


@lru_cache
def get_settings() -> Settings:
    return Settings()
