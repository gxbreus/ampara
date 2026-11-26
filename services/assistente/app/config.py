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
    # "groq" ou "openai" (qualquer API compatível com a da OpenAI: Gemini, GitHub Models,
    # OpenRouter…, apontada por LLM_BASE_URL). Trocar de provedor é só trocar variáveis.
    llm_provider: str = "groq"
    llm_base_url: str = ""
    # vazio no .env = o padrão do provedor (veja modelo / modelo_reserva)
    llm_model: str = ""
    llm_api_key: SecretStr = SecretStr("")
    llm_fallback_model: str = ""
    # reservas gratuitas de outros provedores, tentadas depois dos modelos acima, nesta
    # ordem; cada uma só entra com a chave preenchida. Modelos escolhidos em 26/11 pelo teste
    # com o prompt do RAG (docs/llm/provedores.md); vazio = esses padrões.
    groq_api_key: SecretStr = SecretStr("")
    groq_models: str = ""
    openrouter_api_key: SecretStr = SecretStr("")
    openrouter_models: str = ""
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
    # 4 trechos: o assunto costuma estar espalhado em textos curtos da base (ex.: "primeiros
    # cuidados com filhote" está em resgate, vacinação e adaptação); a checagem de citação
    # devolve só os que a resposta usou
    trechos_por_resposta: int = 4
    # recomendação: abaixo disto o texto não descreve uma rotina (medido: rotinas reais
    # ≥ 0,58, inclusive curtas como "tenho quintal"; "Neymar", "receita de bolo" ≤ 0,30)
    limiar_rotina: float = 0.45
    timeout_llm_s: float = 12.0
    cache_ttl_s: int = 24 * 3600

    @property
    def modelo(self) -> str:
        if self.llm_model:
            return self.llm_model
        # flash-lite: o Gemini mais barato e o mais rápido nos testes (resposta ~1 s, tool
        # calling ok); as perguntas são simples e curtas
        return "gemini-2.5-flash-lite" if self.llm_provider == "openai" else "openai/gpt-oss-120b"

    @property
    def modelos_reserva(self) -> list[str]:
        """Reservas na ordem, separadas por vírgula em LLM_FALLBACK_MODEL.

        No plano gratuito do Gemini a cota diária é por modelo (20 requisições por dia no
        flash-lite): encadear modelos multiplica a cota sem custo.
        """
        if self.llm_fallback_model:
            return [m.strip() for m in self.llm_fallback_model.split(",") if m.strip()]
        if self.llm_provider == "openai":
            return [
                "gemini-3.5-flash-lite",
                "gemini-flash-lite-latest",
                "gemini-3.5-flash",
                "gemini-2.5-flash",
            ]
        return ["qwen/qwen3.8-27b"]

    @property
    def groq_modelos(self) -> list[str]:
        return separar(self.groq_models) or ["qwen/qwen3.8-27b", "openai/gpt-oss-120b"]

    @property
    def openrouter_modelos(self) -> list[str]:
        # :free = gratuitos (20/min e 50/dia por conta); devagar (~8 s), por isso por último
        return separar(self.openrouter_models) or [
            "nvidia/nemotron-3.5-super-vl:free",
            "nvidia/nemotron-3.5-lightning:free",
            "google/gemma-4-31b-it:free",
        ]

    @property
    def modelo_reserva(self) -> str:
        return self.modelos_reserva[0]


def separar(lista: str) -> list[str]:
    return [m.strip() for m in lista.split(",") if m.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
