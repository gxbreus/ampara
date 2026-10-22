import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { connect } from "amqplib";
import { exigirRoles, type Verificador } from "./auth.js";

// Eventos em tempo real para o painel (#61, revisão da Parte 2): o BFF Web consome
// `adocao.*` e `animal.*` do RabbitMQ e repassa ao painel aberto por Server-Sent Events,
// para a ONG ver uma solicitação nova ou uma mudança de status sem recarregar a tela.
//
// O BFF não guarda estado: um evento que chega sem ninguém conectado é descartado, e o
// painel recarrega os dados quando reconecta. Por isso a fila é exclusiva de cada réplica
// (nome gerado pelo broker, apagada quando a réplica cai): com duas réplicas, cada uma
// recebe todos os eventos e entrega às conexões que estão com ela.

export const exchange = "ampara.eventos";
export const padroes = ["adocao.*", "animal.*"];

export interface Evento {
  id: string; // messageId do envelope
  tipo: string;
  ocorridoEm: string;
  dados: Record<string, unknown>;
}

interface Envelope {
  messageId?: string;
  type?: string;
  version?: number;
  occurredAt?: string;
  payload?: Record<string, unknown>;
}

// O dono do evento: o responsável pelo animal. `adocao.falhou` antes da reserva não tem
// responsável e não vai para ninguém.
export function destinatario(e: Pick<Evento, "tipo" | "dados">): string | null {
  if (e.tipo.startsWith("adocao.")) {
    const id = e.dados.responsavelId;
    return typeof id === "string" ? id : null;
  }
  if (e.tipo.startsWith("animal.")) {
    const responsavel = e.dados.responsavel as { id?: unknown } | undefined;
    return typeof responsavel?.id === "string" ? responsavel.id : null;
  }
  return null;
}

// Leitor tolerante (ADR-006): só a versão 1; o resto é ignorado com log.
export function decodificar(corpo: Buffer): Evento | null {
  let env: Envelope;
  try {
    env = JSON.parse(corpo.toString("utf8")) as Envelope;
  } catch {
    return null;
  }
  if (!env.messageId || !env.type || env.version !== 1 || typeof env.payload !== "object" || env.payload === null) return null;
  return { id: env.messageId, tipo: env.type, ocorridoEm: env.occurredAt ?? new Date().toISOString(), dados: env.payload };
}

type Escritor = (texto: string) => void;

export class Hub {
  private readonly conexoes = new Map<string, Set<Escritor>>();
  // o relay pode publicar a mesma mensagem duas vezes; os últimos ids bastam para o painel
  private readonly vistos = new Set<string>();

  conectar(sub: string, escrever: Escritor): () => void {
    const doUsuario = this.conexoes.get(sub) ?? new Set<Escritor>();
    doUsuario.add(escrever);
    this.conexoes.set(sub, doUsuario);
    return () => {
      doUsuario.delete(escrever);
      if (doUsuario.size === 0) this.conexoes.delete(sub);
    };
  }

  get abertas(): number {
    let n = 0;
    for (const c of this.conexoes.values()) n += c.size;
    return n;
  }

  // Devolve para quantas conexões o evento foi entregue.
  entregar(e: Evento): number {
    if (this.vistos.has(e.id)) return 0;
    this.vistos.add(e.id);
    if (this.vistos.size > 1000) this.vistos.delete(this.vistos.values().next().value as string);
    const sub = destinatario(e);
    const alvos = sub ? this.conexoes.get(sub) : undefined;
    if (!alvos) return 0;
    const texto = `id: ${e.id}\nevent: ${e.tipo}\ndata: ${JSON.stringify({ tipo: e.tipo, ocorridoEm: e.ocorridoEm, dados: e.dados })}\n\n`;
    for (const escrever of alvos) escrever(texto);
    return alvos.size;
  }
}

// Consome até `parar` ser chamado, reconectando depois de uma queda do broker.
export function consumirEventos(url: string, hub: Hub, log: FastifyBaseLogger): () => Promise<void> {
  let ativo = true;
  let fechar: (() => Promise<void>) | null = null;

  async function umaVez() {
    const conexao = await connect(url);
    fechar = async () => conexao.close().catch(() => undefined);
    const encerrada = new Promise<void>((resolve) => {
      conexao.on("close", () => resolve());
      conexao.on("error", (erro: Error) => log.warn({ erro: erro.message }, "conexão com o RabbitMQ caiu"));
    });
    const canal = await conexao.createChannel();
    const { queue } = await canal.assertQueue("", { exclusive: true, autoDelete: true, durable: false });
    for (const padrao of padroes) await canal.bindQueue(queue, exchange, padrao);
    await canal.consume(
      queue,
      (msg) => {
        if (!msg) return;
        const e = decodificar(msg.content);
        if (!e) {
          log.warn({ rk: msg.fields.routingKey }, "evento inválido ignorado");
          return;
        }
        const entregues = hub.entregar(e);
        log.debug({ tipo: e.tipo, messageId: e.id, entregues }, "evento repassado ao painel");
      },
      { noAck: true },
    );
    log.info({ fila: queue, padroes }, "consumindo eventos para o painel");
    await encerrada;
  }

  void (async () => {
    while (ativo) {
      try {
        await umaVez();
      } catch (erro) {
        if (ativo) log.warn({ erro: (erro as Error).message }, "sem RabbitMQ; tentando de novo em 2 s");
      }
      if (ativo) await new Promise((r) => setTimeout(r, 2000));
    }
  })();

  return async () => {
    ativo = false;
    await fechar?.();
  };
}

const intervaloPing = 20_000; // abaixo do read_timeout de 60 s do Kong

export function rotaDeEventos(r: FastifyInstance, { verificar, hub }: { verificar: Verificador; hub: Hub }) {
  const doPainel = exigirRoles(verificar, ["PROTETOR", "ONG", "ADMIN"]);

  // O navegador lê com fetch + ReadableStream (ou @microsoft/fetch-event-source), porque o
  // EventSource nativo não manda o header Authorization.
  r.get("/eventos", { onRequest: doPainel }, (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Correlation-Id": req.id,
    });
    // `retry` diz ao cliente quanto esperar antes de reconectar
    res.write(`retry: 3000\n: conectado\n\n`);
    const desconectar = hub.conectar(req.usuario!.sub, (texto) => res.write(texto));
    const ping = setInterval(() => res.write(`: ping\n\n`), intervaloPing);
    req.raw.on("close", () => {
      clearInterval(ping);
      desconectar();
    });
  });
}
