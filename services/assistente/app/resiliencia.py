"""O LLM como dependência falível (#69): timeout, retry, circuit breaker, cache e fallback.

Ordem de uma chamada ao LLM:
1. cache (Redis): se a mesma pergunta já foi respondida com a mesma base e o mesmo
   modelo, devolve sem chamar o provedor;
2. circuit breaker: depois de N falhas seguidas o circuito abre e, por um tempo, nem
   tenta o provedor (vai direto ao fallback); depois deixa passar uma tentativa
   (meio-aberto) e fecha de novo se ela der certo;
3. timeout por tentativa e retry com backoff exponencial e jitter, só em erro transitório;
4. se tudo falhar: quem chamou usa o fallback (resposta montada sem o LLM, degradado=true).

O estado é por processo (cada réplica tem o seu circuito), o que basta para a demo e é o
comportamento esperado de um circuit breaker local.
"""

import asyncio
import hashlib
import json
import logging
import random
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

logger = logging.getLogger(__name__)


class CircuitoAberto(Exception):
    pass


@dataclass
class Metricas:
    chamadas: int = 0
    falhas: int = 0
    fallbacks: int = 0
    cache_hits: int = 0
    citacoes_invalidas: int = 0


@dataclass
class Circuito:
    limite_falhas: int = 3
    tempo_aberto_s: float = 30.0
    falhas_consecutivas: int = 0
    aberto_ate: float | None = None
    _agora: Callable[[], float] = field(default=time.monotonic, repr=False)

    @property
    def estado(self) -> str:
        if self.aberto_ate is None:
            return "fechado"
        return "aberto" if self._agora() < self.aberto_ate else "meio-aberto"

    def tentar_novamente_em(self) -> str | None:
        if self.estado != "aberto":
            return None
        faltam = self.aberto_ate - self._agora()
        return (datetime.now(UTC) + timedelta(seconds=faltam)).isoformat()

    def permitir(self) -> None:
        if self.estado == "aberto":
            raise CircuitoAberto("circuito aberto: o provedor falhou seguidamente")

    def sucesso(self) -> None:
        self.falhas_consecutivas = 0
        self.aberto_ate = None

    def abrir_por(self, segundos: float) -> None:
        self.aberto_ate = self._agora() + segundos
        logger.warning("circuito do LLM aberto por cota esgotada", extra={"segundos": segundos})

    def falha(self) -> None:
        self.falhas_consecutivas += 1
        # meio-aberto e falhou de novo, ou chegou ao limite: (re)abre
        if self.aberto_ate is not None or self.falhas_consecutivas >= self.limite_falhas:
            self.aberto_ate = self._agora() + self.tempo_aberto_s
            logger.warning(
                "circuito do LLM aberto", extra={"falhasConsecutivas": self.falhas_consecutivas}
            )


def cota_diaria_esgotada(erro: BaseException) -> bool:
    """429 de cota por dia (ex.: free tier do Gemini): tentar de novo hoje não adianta."""
    texto = str(erro).lower()
    return "429" in texto and ("per day" in texto or "perday" in texto)


# erros de rede do SDK da Groq (e do httpx por baixo dele) que não têm status HTTP
ERROS_DE_REDE = {
    "APIConnectionError",
    "APITimeoutError",
    "ConnectError",
    "ReadTimeout",
    "RemoteProtocolError",
}


def transitorio(erro: BaseException) -> bool:
    """Vale tentar de novo: tempo esgotado, rede, limite de taxa (429) ou erro 5xx do provedor.

    Pedido inválido (4xx) ou bug no código não melhoram com outra tentativa.
    """
    if isinstance(erro, TimeoutError | asyncio.TimeoutError | ConnectionError):
        return True
    if type(erro).__name__ in ERROS_DE_REDE:
        return True
    status = getattr(erro, "status_code", None) or getattr(
        getattr(erro, "response", None), "status_code", None
    )
    return status is not None and (status == 429 or status >= 500)


class Resiliencia:
    def __init__(
        self,
        timeout_s: float,
        tentativas: int = 3,
        base_backoff_s: float = 0.4,
        circuito: Circuito | None = None,
    ):
        self.timeout_s, self.tentativas, self.base_backoff_s = timeout_s, tentativas, base_backoff_s
        self.circuito = circuito or Circuito()
        self.metricas = Metricas()

    async def chamar(
        self, operacao: Callable[[], Awaitable], repassar: tuple[type[BaseException], ...] = ()
    ):
        """`repassar`: erros que não são do LLM (ex.: Animais fora) sobem sem contar falha."""
        self.circuito.permitir()
        ultimo: BaseException | None = None
        for tentativa in range(self.tentativas):
            self.metricas.chamadas += 1
            try:
                resultado = await asyncio.wait_for(operacao(), timeout=self.timeout_s)
            except repassar:
                raise
            except Exception as erro:
                ultimo = erro
                self.metricas.falhas += 1
                logger.warning(
                    "falha no LLM", extra={"tentativa": tentativa + 1, "erro": type(erro).__name__}
                )
                if cota_diaria_esgotada(erro):
                    # não gasta tentativas nem espera: abre por 1 h e o próximo modelo assume
                    self.circuito.abrir_por(3600)
                    raise
                if not transitorio(erro) or tentativa == self.tentativas - 1:
                    break
                # backoff exponencial com jitter "cheio": espera aleatória até 0,4 s, 0,8 s…
                await asyncio.sleep(random.uniform(0, self.base_backoff_s * 2**tentativa))  # noqa: S311
            else:
                self.circuito.sucesso()
                return resultado
        self.circuito.falha()
        raise ultimo  # type: ignore[misc]

    def estado(self) -> dict:
        return {
            "circuito": self.circuito.estado,
            "falhasConsecutivas": self.circuito.falhas_consecutivas,
            "chamadas": self.metricas.chamadas,
            "falhas": self.metricas.falhas,
            "fallbacks": self.metricas.fallbacks,
            "cacheHits": self.metricas.cache_hits,
            "citacoesInvalidas": self.metricas.citacoes_invalidas,
            "tentarNovamenteEm": self.circuito.tentar_novamente_em(),
        }


class Cache:
    """Cache de respostas no redis-assistente. Falha do cache nunca derruba a resposta."""

    def __init__(self, redis, ttl_s: int):
        self.redis, self.ttl_s = redis, ttl_s

    @staticmethod
    def chave(tipo: str, versao_base: str, modelo: str, texto: str) -> str:
        normalizado = " ".join(texto.lower().split())
        resumo = hashlib.sha256(normalizado.encode()).hexdigest()[:32]
        return f"assistente:{tipo}:{versao_base}:{modelo}:{resumo}"

    async def ler(self, chave: str) -> dict | None:
        try:
            bruto = await asyncio.wait_for(self.redis.get(chave), timeout=0.5)
            return json.loads(bruto) if bruto else None
        except Exception:
            logger.warning("cache indisponível na leitura")
            return None

    async def gravar(self, chave: str, valor: dict) -> None:
        try:
            await asyncio.wait_for(
                self.redis.set(chave, json.dumps(valor, ensure_ascii=False), ex=self.ttl_s),
                timeout=0.5,
            )
        except Exception:
            logger.warning("cache indisponível na escrita")
