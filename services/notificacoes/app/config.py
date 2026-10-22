"""Configuração do serviço, lida só de variáveis de ambiente com o prefixo NOTIFICACOES_.

Regras:
- Chame get_settings() só no lifespan e nas dependências (Depends), nunca no topo de
  um módulo nem em create_app(): importar o app não pode exigir variável de ambiente.
- URL com senha e chave são SecretStr e não têm valor padrão. Assim não aparecem em
  log nem em repr, e o serviço não sobe sem elas.
- Variável compartilhada, sem o prefixo, usa validation_alias. Exemplo (#60):
      jwt_public_key: str = Field(validation_alias="JWT_PUBLIC_KEY")
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="NOTIFICACOES_")

    # TODO(#41): redis_url (NOTIFICACOES_REDIS_URL) e amqp_url (NOTIFICACOES_AMQP_URL),
    # as duas como SecretStr, sem valor padrão. O formato está no .env.example.


@lru_cache
def get_settings() -> Settings:
    return Settings()
