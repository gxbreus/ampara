import { ehUuid } from '../contas/uuid';

export const TIPOS_COMANDO = ['ValidarPerfil', 'LiberarVaga', 'RegistrarAdocao'] as const;
export type TipoComando = (typeof TIPOS_COMANDO)[number];
export type TipoResposta = 'PerfilValidado' | 'PerfilRecusado' | 'VagaLiberada' | 'AdocaoRegistrada';

/** Envelope do catálogo (eventos.md §2) para os comandos que a Identidade recebe. */
export interface Comando {
  messageId: string;
  type: TipoComando;
  version: 1;
  correlationId: string;
  sagaId: string;
  occurredAt: string;
  payload: { adotanteId: string; animalId?: string };
}

export interface Resposta {
  messageId: string;
  type: TipoResposta;
  version: 1;
  correlationId: string;
  sagaId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export type Leitura = { ok: true; comando: Comando } | { ok: false; motivo: string; parcial?: Partial<Comando> };

const OBJECT_ID = /^[0-9a-f]{24}$/;

/**
 * Lê e valida o comando contra o catálogo: envelope completo, `version: 1`, UUIDs
 * em messageId, sagaId e adotanteId e `animalId` com 24 hex. Qualquer falha aqui é
 * definitiva: a mensagem vai direto para a DLQ, sem gastar as devoluções.
 * Campos desconhecidos são ignorados (leitor tolerante, ADR-006).
 */
export function lerComando(conteudo: Buffer): Leitura {
  let bruto: unknown;
  try {
    bruto = JSON.parse(conteudo.toString('utf8'));
  } catch {
    return { ok: false, motivo: 'JSON inválido' };
  }
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return { ok: false, motivo: 'envelope não é um objeto' };
  const m = bruto as Record<string, unknown>;
  const parcial = { messageId: m.messageId, type: m.type, sagaId: m.sagaId, correlationId: m.correlationId } as Partial<Comando>;
  const falha = (motivo: string): Leitura => ({ ok: false, motivo, parcial });

  if (!ehUuid(m.messageId)) return falha('messageId deve ser UUID');
  if (typeof m.type !== 'string' || !(TIPOS_COMANDO as readonly string[]).includes(m.type)) return falha(`type desconhecido: ${String(m.type)}`);
  if (m.version !== 1) return falha(`version não suportada: ${String(m.version)}`);
  if (typeof m.correlationId !== 'string' || m.correlationId.length === 0) return falha('correlationId ausente');
  if (!ehUuid(m.sagaId)) return falha('sagaId deve ser UUID');
  if (typeof m.occurredAt !== 'string' || Number.isNaN(Date.parse(m.occurredAt))) return falha('occurredAt deve ser data e hora');
  if (!m.payload || typeof m.payload !== 'object' || Array.isArray(m.payload)) return falha('payload ausente');

  const payload = m.payload as Record<string, unknown>;
  if (!ehUuid(payload.adotanteId)) return falha('payload.adotanteId deve ser UUID');
  if (m.type === 'RegistrarAdocao' && (typeof payload.animalId !== 'string' || !OBJECT_ID.test(payload.animalId))) {
    return falha('payload.animalId deve ter 24 caracteres hexadecimais');
  }

  return {
    ok: true,
    comando: {
      messageId: m.messageId,
      type: m.type as TipoComando,
      version: 1,
      correlationId: m.correlationId,
      sagaId: m.sagaId,
      occurredAt: m.occurredAt,
      payload: m.type === 'RegistrarAdocao'
        ? { adotanteId: payload.adotanteId, animalId: payload.animalId as string }
        : { adotanteId: payload.adotanteId },
    },
  };
}
