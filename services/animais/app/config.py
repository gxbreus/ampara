"""Configuração do serviço, lida só de variáveis de ambiente com o prefixo ANIMAIS_."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ANIMAIS_")

    porta: int = 8001

    # TODO(#39): ANIMAIS_MONGO_URL (database animais, escrita) e
    # ANIMAIS_LEITURA_MONGO_URL (database animais_leitura, projeção).
    # Sem valor padrão: a URL tem senha e vem sempre do ambiente.


@lru_cache
def get_settings() -> Settings:
    return Settings()
