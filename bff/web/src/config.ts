// Configuração só por variáveis de ambiente.

export interface Config {
  porta: number;
  timeoutMs: number;
  jwtPublicKey: string;
  servicos: {
    identidade: string;
    animais: string;
    adocao: string;
  };
}

function obrigatoria(nome: string): string {
  const valor = process.env[nome];
  if (!valor) throw new Error(`${nome} não definida`);
  return valor;
}

export function carregarConfig(): Config {
  return {
    porta: Number(process.env.PORT ?? 3010),
    timeoutMs: Number(process.env.BFF_TIMEOUT_MS ?? 3000),
    // Aceita o PEM com quebras de linha reais ou escapadas como \n (formato do .env).
    jwtPublicKey: obrigatoria("JWT_PUBLIC_KEY").replace(/\\n/g, "\n"),
    servicos: {
      identidade: process.env.IDENTIDADE_URL ?? "http://identidade:3001",
      animais: process.env.ANIMAIS_URL ?? "http://animais:8001",
      adocao: process.env.ADOCAO_URL ?? "http://adocao:8080",
    },
  };
}
