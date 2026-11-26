"""Configuração do serviço, lida só de variáveis de ambiente com o prefixo NOTIFICACOES_.

Regras:
- Chame get_settings() só no lifespan e nas dependências (Depends), nunca no topo de
  um módulo nem em create_app(): importar o app não pode exigir variável de ambiente.
- URL com senha e chave são SecretStr e não têm valor padrão. Assim não aparecem em
  log nem em repr, e o serviço não sobe sem elas.
- A chave pública de Identidade é compartilhada com os outros serviços.
"""

from functools import lru_cache

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="NOTIFICACOES_")

    redis_url: SecretStr
    amqp_url: SecretStr
    jwt_public_key: str = Field(min_length=1, validation_alias="JWT_PUBLIC_KEY")


@lru_cache
def get_settings() -> Settings:
    return Settings()
