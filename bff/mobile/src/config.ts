export interface Config {
  porta: number;
  timeoutMs: number;
  jwtPublicKey: string;
  servicos: Record<"identidade" | "animais" | "adocao" | "notificacoes" | "assistente", string>;
}

export function carregarConfig(): Config {
  if (!process.env.JWT_PUBLIC_KEY) throw new Error("JWT_PUBLIC_KEY não definida");
  return {
    porta: Number(process.env.PORT ?? 3020),
    timeoutMs: Number(process.env.BFF_TIMEOUT_MS ?? 3000),
    jwtPublicKey: process.env.JWT_PUBLIC_KEY.replace(/\\n/g, "\n"),
    servicos: {
      identidade: process.env.IDENTIDADE_URL ?? "http://identidade:3001",
      animais: process.env.ANIMAIS_URL ?? "http://animais:8001",
      adocao: process.env.ADOCAO_URL ?? "http://adocao:8080",
      notificacoes: process.env.NOTIFICACOES_URL ?? "http://notificacoes:8003",
      assistente: process.env.ASSISTENTE_URL ?? "http://assistente:8004",
    },
  };
}
