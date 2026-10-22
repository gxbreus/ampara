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

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # TODO(#42), com os nomes do .env.example:
    #     llm_provider: str = "groq"
    #     llm_model: str = ""
    #     llm_api_key: SecretStr = SecretStr("")   # vazia = modo degradado
    #     llm_fallback_model: str = ""
    #     qdrant_url: str
    #     redis_url: SecretStr = Field(validation_alias="ASSISTENTE_REDIS_URL")
    #     animais_url: str = "http://animais:8001"
    pass


@lru_cache
def get_settings() -> Settings:
    return Settings()
