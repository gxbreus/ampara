import type { LookupAddress } from "node:dns";
import { Resolver } from "node:dns/promises";
import { readFileSync } from "node:fs";
import { isIP } from "node:net";

// Resolução de nomes para as chamadas internas, sem o pool de threads do Node.
//
// O dns.lookup padrão usa o pool de threads do libuv (4 threads), e um nome que não existe
// (serviço fora do ar) pode prender threads por 5 s esperando o DNS. Com dois serviços
// fora, o pool esgotava e até a chamada a um serviço de pé estourava o timeout (#44).
// Aqui a resolução é feita pelo c-ares (dns.Resolver), que é assíncrono e tem timeout.
//
// O c-ares consulta o nome exatamente como recebe, sem a linha "search" do resolv.conf.
// No Kubernetes, "adocao" só existe como "adocao.ampara.svc.cluster.local", então os
// candidatos são montados como o sistema faria: com menos pontos que o ndots, os sufixos
// de busca vêm antes do nome puro. As consultas saem em paralelo, e vale a primeira que
// der certo na ordem de prioridade.

export interface ConfigResolv {
  search: string[];
  ndots: number;
}

export function lerResolvConf(texto: string): ConfigResolv {
  const cfg: ConfigResolv = { search: [], ndots: 1 };
  for (const linha of texto.split("\n")) {
    const [chave, ...valores] = linha.trim().split(/\s+/);
    if (chave === "search" || chave === "domain") cfg.search = valores;
    if (chave === "options") {
      for (const opcao of valores) {
        const m = /^ndots:(\d+)$/.exec(opcao);
        if (m) cfg.ndots = Number(m[1]);
      }
    }
  }
  return cfg;
}

export function candidatos(nome: string, cfg: ConfigResolv): string[] {
  if (nome.endsWith(".")) return [nome.slice(0, -1)];
  const comSufixo = cfg.search.map((d) => `${nome}.${d}`);
  const pontos = nome.split(".").length - 1;
  return pontos >= cfg.ndots ? [nome, ...comSufixo] : [...comSufixo, nome];
}

function configDoSistema(): ConfigResolv {
  try {
    return lerResolvConf(readFileSync("/etc/resolv.conf", "utf8"));
  } catch {
    return { search: [], ndots: 1 };
  }
}

type Resolve4 = (nome: string) => Promise<string[]>;

export function criarResolvedor(cfg: ConfigResolv = configDoSistema(), resolve4?: Resolve4) {
  const resolver = new Resolver({ timeout: 1000, tries: 2 });
  const consultar: Resolve4 = resolve4 ?? ((n) => resolver.resolve4(n));

  return async function resolver4(nome: string): Promise<string[]> {
    if (isIP(nome)) return [nome];
    const tentativas = candidatos(nome, cfg).map((c) => consultar(c));
    // evita "unhandled rejection" das tentativas que perderem
    for (const t of tentativas) t.catch(() => undefined);
    let ultimoErro: unknown;
    for (const t of tentativas) {
      try {
        return await t;
      } catch (erro) {
        ultimoErro = erro;
      }
    }
    throw ultimoErro;
  };
}

type CallbackLookup = (erro: NodeJS.ErrnoException | null, endereco: string | LookupAddress[], familia?: number) => void;

// Função no formato do dns.lookup, para o agente do undici. Só IPv4: as redes do Compose
// e do cluster não usam IPv6.
export function criarLookup(resolver4 = criarResolvedor()) {
  return (nome: string, opcoes: { all?: boolean }, callback: CallbackLookup) => {
    resolver4(nome).then(
      (enderecos) => {
        if (opcoes.all) callback(null, enderecos.map((address) => ({ address, family: 4 })));
        else callback(null, enderecos[0], 4);
      },
      (erro: unknown) => callback(erro as NodeJS.ErrnoException, ""),
    );
  };
}
