import type React from "react";
import type { ReactNode } from "react";
import { ErroApi, ESTADOS, STATUS_ANIMAL, dataHora, type Tom } from "./api";

export function Selo({ tom = "neutro", children }: { tom?: Tom; children: ReactNode }) {
  return <span className={`selo ${tom}`}>{children}</span>;
}

export function SeloEstado({ estado }: { estado: string }) {
  const e = ESTADOS[estado] ?? { rotulo: estado, tom: "neutro" as Tom };
  return <Selo tom={e.tom}>{e.rotulo}</Selo>;
}

export function SeloStatus({ status }: { status: string }) {
  const s = STATUS_ANIMAL[status] ?? { rotulo: status, tom: "neutro" as Tom };
  return <Selo tom={s.tom}>{s.rotulo}</Selo>;
}

// Mostra de onde vêm os dados da tela. Ajuda a acompanhar a integração rota a rota.
export function Origem({ origem }: { origem: "real" | "simulado" }) {
  return (
    <span className={`origem ${origem}`} title={origem === "real" ? "Dados do backend, via gateway" : "Dados simulados a partir do contrato OpenAPI"}>
      {origem === "real" ? "● real" : "◌ simulado"}
    </span>
  );
}

const NOMES_SERVICO: Record<string, string> = {
  animais: "Animais",
  adocao: "Adoção",
  identidade: "Identidade",
  notificacoes: "Notificações",
  assistente: "Assistente",
};
const MOTIVOS: Record<string, string> = {
  TIMEOUT: "não respondeu a tempo",
  INDISPONIVEL: "está fora do ar",
  CIRCUITO_ABERTO: "está com o circuito aberto",
};

// Falha parcial: o BFF respondeu 200, mas algum serviço complementar faltou.
export function Avisos({ avisos }: { avisos?: (string | { servico: string; motivo: string })[] }) {
  if (!avisos?.length) return null;
  return (
    <div className="aviso-faixa" role="status">
      <span aria-hidden>⚠</span>
      <div>
        <strong>Resposta parcial.</strong>{" "}
        {avisos
          .map((a) => (typeof a === "string" ? a : `${NOMES_SERVICO[a.servico] ?? a.servico} ${MOTIVOS[a.motivo] ?? a.motivo}`))
          .join("; ")}
        . O resto da tela segue normal.
      </div>
    </div>
  );
}

export function Carregando({ texto = "Carregando…" }: { texto?: string }) {
  return <div className="carregando">{texto}</div>;
}

export function Erro({ erro, onTentar }: { erro: unknown; onTentar?: () => void }) {
  const e = erro instanceof ErroApi ? erro : null;
  return (
    <div className="aviso-faixa erro" role="alert">
      <span aria-hidden>✕</span>
      <div style={{ flex: 1 }}>
        <strong>{e?.titulo ?? "Algo deu errado"}.</strong> {e?.detalhe ?? (erro instanceof Error ? erro.message : "")}
        {e && e.status > 0 && <small style={{ opacity: 0.7 }}> (HTTP {e.status})</small>}
      </div>
      {onTentar && (
        <button className="btn pequeno contorno" onClick={onTentar}>
          Tentar de novo
        </button>
      )}
    </div>
  );
}

export function Vazio({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="vazio">
      <h3>{titulo}</h3>
      {children}
    </div>
  );
}

export interface EtapaTempo {
  titulo: string;
  detalhe?: string;
  em: string;
  falha?: boolean;
}

export function LinhaDoTempo({ etapas, atualFinal }: { etapas: EtapaTempo[]; atualFinal?: boolean }) {
  return (
    <ol className="linha-tempo">
      {etapas.map((e, i) => {
        const atual = i === etapas.length - 1 && !atualFinal;
        return (
          <li key={`${e.titulo}-${i}`} className={`${e.falha ? "falha" : ""} ${atual ? "atual" : ""}`}>
            <span className="carimbo" aria-hidden>
              {e.falha ? "✕" : atual ? "●" : "✓"}
            </span>
            <strong>{e.titulo}</strong>
            {e.detalhe && <small>{e.detalhe} · </small>}
            <time dateTime={e.em}>{dataHora(e.em)}</time>
          </li>
        );
      })}
    </ol>
  );
}

const FALHAS = new Set(["REJEITADA_INDISPONIVEL", "PERFIL_INVALIDO", "RECUSADA", "FALHOU", "EXPIRADA", "CANCELADA", "COMPENSANDO"]);
export const ehFalha = (estado: string) => FALHAS.has(estado);

// Retrato do animal: usa a foto quando existe; sem foto (o seed não tem), desenha um
// cartão com a inicial, em cores derivadas do nome. Funciona offline na demo.
const PALETAS = [
  ["#c4532f", "#f6e3bd"],
  ["#6f8a5c", "#f5efe3"],
  ["#3e6a7d", "#f6e3bd"],
  ["#8f2d3a", "#f1d6d6"],
  ["#d99a2b", "#1d2a23"],
  ["#1d2a23", "#dfe6d3"],
];
const GLIFOS: Record<string, string> = { CAO: "🐕", GATO: "🐈", OUTRO: "🐾" };

export function Retrato({ nome, especie, src, className = "foto", style }: { nome: string; especie?: string; src?: string | null; className?: string; style?: React.CSSProperties }) {
  if (src && !src.includes("exemplo.ampara.dev")) return <img className={className} style={style} src={src} alt={`Foto de ${nome}`} loading="lazy" />;
  let h = 0;
  for (const c of nome) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const [fundo, tinta] = PALETAS[h % PALETAS.length];
  return (
    <div
      className={className}
      role="img"
      aria-label={`Retrato de ${nome}`}
      style={{
        ...style,
        background: `radial-gradient(circle at ${20 + (h % 60)}% ${15 + (h % 40)}%, ${tinta}33 0 18%, transparent 19%), radial-gradient(circle at 85% 90%, ${tinta}22 0 30%, transparent 31%), ${fundo}`,
        color: tinta,
        display: "grid",
        placeItems: "center",
        position: "relative",
        overflow: "hidden",
        containerType: "inline-size",
      }}
    >
      <span style={{ fontFamily: "var(--serif)", fontWeight: 700, fontSize: "clamp(1.6rem, 24cqw, 7.5rem)", fontStyle: "italic", lineHeight: 1 }}>{nome.charAt(0)}</span>
      <span style={{ position: "absolute", right: "8%", bottom: "6%", fontSize: "clamp(0.8rem, 8cqw, 1.6rem)", opacity: 0.85 }}>{GLIFOS[especie ?? ""] ?? "🐾"}</span>
    </div>
  );
}
