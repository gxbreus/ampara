"""Configuração do serviço, lida só de variáveis de ambiente com o prefixo ANIMAIS_.

Regras:
- Chame get_settings() só no lifespan e nas dependências (Depends), nunca no topo de
  um módulo nem em create_app(): importar o app não pode exigir variável de ambiente.
- URL com senha e chave são SecretStr e não têm valor padrão. Assim não aparecem em
  log nem em repr, e o serviço não sobe sem elas.
- Variável compartilhada, sem o prefixo, usa validation_alias. Exemplo:
      jwt_public_key: str = Field(validation_alias="JWT_PUBLIC_KEY")
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ANIMAIS_")

    # TODO(#39): mongo_url (ANIMAIS_MONGO_URL, database animais, escrita) e
    # leitura_mongo_url (ANIMAIS_LEITURA_MONGO_URL, database animais_leitura, projeção),
    # os dois como SecretStr, sem valor padrão.


@lru_cache
def get_settings() -> Settings:
    return Settings()
