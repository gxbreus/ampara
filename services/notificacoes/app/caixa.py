"""Armazenamento atômico da caixa no Redis e paginação por posição estável."""

import base64
import json
import re
from datetime import UTC, datetime
from uuid import UUID

from pydantic import BaseModel
from redis.asyncio import Redis

from app.eventos import Evento, Notificacao, TipoEvento

CAPACIDADE = 200
TTL_DEDUPLICACAO = 7 * 24 * 60 * 60
EPOCA = datetime(1970, 1, 1, tzinfo=UTC)
FRACAO = re.compile(r"\.([0-9]+)")

_GRAVAR = """
local marca, caixa, item, contador = unpack(KEYS)
local membro, score, ttl, capacidade, tipo, titulo, texto, criada, link = unpack(ARGV)
if redis.call('EXISTS', marca, item) > 0 then
    return 0
end
redis.call('ZADD', caixa, score, membro)
redis.call('HSET', item, 'tipo', tipo, 'titulo', titulo, 'texto', texto,
    'lida', '0', 'criadaEm', criada, 'link', link, 'membro', membro)
redis.call('INCR', contador)

local excedente = redis.call('ZCARD', caixa) - tonumber(capacidade)
if excedente > 0 then
    for _, antigo in ipairs(redis.call('ZRANGE', caixa, 0, excedente - 1)) do
        local chave = 'notif:item:' .. string.sub(antigo, 11)
        if redis.call('HGET', chave, 'lida') == '0' then
            redis.call('DECR', contador)
        end
        redis.call('DEL', chave)
    end
    redis.call('ZREMRANGEBYRANK', caixa, 0, excedente - 1)
end

redis.call('SET', marca, '1', 'NX', 'EX', ttl)
return 1
"""

_LISTAR = """
local caixa, contador = unpack(KEYS)
local filtro, limite, scoreCursor, membroCursor = unpack(ARGV)
local itens = {}
local fim = scoreCursor == '' and '+inf' or scoreCursor
local ordem = redis.call('ZREVRANGEBYSCORE', caixa, fim, '-inf', 'WITHSCORES')
for i = 1, #ordem, 2 do
    local membro, score = ordem[i], ordem[i + 1]
    if scoreCursor == '' or tonumber(score) < tonumber(scoreCursor) or membro < membroCursor then
        local campos = redis.call('HMGET', 'notif:item:' .. string.sub(membro, 11),
            'tipo', 'titulo', 'texto', 'lida', 'criadaEm', 'link')
        if campos[1] and (filtro == '0' or campos[4] == '0') then
            table.insert(itens, {membro, score, unpack(campos)})
            if #itens > tonumber(limite) then
                break
            end
        end
    end
end
return {redis.call('GET', contador) or '0', itens}
"""

_MARCAR_LIDA = """
local caixa, item, contador = unpack(KEYS)
local membro = redis.call('HGET', item, 'membro')
if not membro or not redis.call('ZSCORE', caixa, membro) then
    return 0
end
if redis.call('HGET', item, 'lida') == '0' then
    redis.call('HSET', item, 'lida', '1')
    redis.call('DECR', contador)
end
return 1
"""

_MARCAR_TODAS = """
local caixa, contador = unpack(KEYS)
for _, membro in ipairs(redis.call('ZRANGE', caixa, 0, -1)) do
    redis.call('HSET', 'notif:item:' .. string.sub(membro, 11), 'lida', '1')
end
redis.call('DEL', contador)
"""


class ItemCaixa(BaseModel):
    id: str
    tipo: TipoEvento
    titulo: str
    mensagem: str
    lida: bool
    criadaEm: str
    link: str


class PaginaCaixa(BaseModel):
    itens: list[ItemCaixa]
    naoLidas: int
    proximoCursor: str | None


class CursorInvalido(ValueError):
    pass


def _codificar_cursor(usuario: UUID, filtro: bool, score: int, membro: str) -> str:
    dados = json.dumps([str(usuario), filtro, score, membro], separators=(",", ":"))
    return base64.urlsafe_b64encode(dados.encode()).decode().rstrip("=")


def _ler_cursor(usuario: UUID, filtro: bool, cursor: str) -> tuple[int, str]:
    try:
        dados = base64.b64decode(cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True)
        dono, nao_lidas, score, membro = json.loads(dados)
        if (
            dono != str(usuario)
            or nao_lidas is not filtro
            or type(score) is not int
            or not isinstance(membro, str)
            or not membro.endswith(f":{usuario}")
            or cursor != _codificar_cursor(usuario, filtro, score, membro)
        ):
            raise CursorInvalido
        return score, membro
    except (TypeError, ValueError) as erro:
        raise CursorInvalido from erro


class Caixa:
    def __init__(self, redis: Redis) -> None:
        self._gravar = redis.register_script(_GRAVAR)
        self._listar = redis.register_script(_LISTAR)
        self._marcar_lida = redis.register_script(_MARCAR_LIDA)
        self._marcar_todas = redis.register_script(_MARCAR_TODAS)

    async def gravar(self, evento: Evento, notificacao: Notificacao) -> None:
        usuario = notificacao.usuario
        id_item = f"{evento.messageId}:{usuario}"
        segundo = datetime.fromisoformat(evento.occurredAt).astimezone(UTC).replace(microsecond=0)
        fracao = FRACAO.search(evento.occurredAt)
        nanos = (fracao.group(1) if fracao else "").ljust(9, "0")
        # O score do Redis usa double. Segundos no score e nanos no membro
        # preservam a precisão do RFC3339Nano emitido pelo Orquestrador.
        membro = f"{nanos}:{id_item}"
        await self._gravar(
            keys=[
                f"notif:proc:{id_item}",
                f"notif:caixa:{usuario}",
                f"notif:item:{id_item}",
                f"notif:naolidas:{usuario}",
            ],
            args=[
                membro,
                int((segundo - EPOCA).total_seconds()),
                TTL_DEDUPLICACAO,
                CAPACIDADE,
                evento.type,
                notificacao.titulo,
                notificacao.texto,
                f"{segundo.isoformat()[:19]}.{nanos}Z",
                notificacao.link,
            ],
        )

    async def listar(
        self, usuario: UUID, nao_lidas: bool, limite: int, cursor: str | None
    ) -> PaginaCaixa:
        score, membro = ("", "") if cursor is None else _ler_cursor(usuario, nao_lidas, cursor)
        total, linhas = await self._listar(
            keys=[f"notif:caixa:{usuario}", f"notif:naolidas:{usuario}"],
            args=[int(nao_lidas), limite, score, membro],
        )
        proximo = None
        if len(linhas) > limite:
            ultimo_membro, ultimo_score, *_ = linhas[limite - 1]
            proximo = _codificar_cursor(usuario, nao_lidas, int(ultimo_score), ultimo_membro)
        return PaginaCaixa(
            itens=[
                ItemCaixa(
                    id=membro[10:],
                    tipo=tipo,
                    titulo=titulo,
                    mensagem=texto,
                    lida=lida == "1",
                    criadaEm=criada,
                    link=link,
                )
                for membro, _, tipo, titulo, texto, lida, criada, link in linhas[:limite]
            ],
            naoLidas=int(total),
            proximoCursor=proximo,
        )

    async def marcar_lida(self, usuario: UUID, id_item: str) -> bool:
        return bool(
            await self._marcar_lida(
                keys=[
                    f"notif:caixa:{usuario}",
                    f"notif:item:{id_item}",
                    f"notif:naolidas:{usuario}",
                ],
            )
        )

    async def marcar_todas(self, usuario: UUID) -> None:
        await self._marcar_todas(keys=[f"notif:caixa:{usuario}", f"notif:naolidas:{usuario}"])
