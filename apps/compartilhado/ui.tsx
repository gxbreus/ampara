import type React from "react";
import { useState, type ReactNode } from "react";
import { ErroApi, ESTADOS, STATUS_ANIMAL, dataHora, type Tom } from "./api";
import { IcAlerta, IcCheck, IcPata, IcX } from "./icones";

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
      <IcAlerta tamanho={20} />
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
      <IcX tamanho={20} />
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
              {e.falha ? <IcX tamanho={16} strokeWidth={3} /> : atual ? <span style={{ width: 9, height: 9, borderRadius: 9, background: "var(--tinta)" }} /> : <IcCheck tamanho={16} strokeWidth={3} />}
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
  ["#ff6a3d", "#1e1b2e"],
  ["#ffc145", "#1e1b2e"],
  ["#1f8a5b", "#fff9f1"],
  ["#ff8fa6", "#1e1b2e"],
  ["#1e1b2e", "#ffc145"],
  ["#f6ecde", "#ff6a3d"],
];

export function Retrato({ nome, especie, src, className = "foto", style }: { nome: string; especie?: string; src?: string | null; className?: string; style?: React.CSSProperties }) {
  const [falhou, setFalhou] = useState(false);
  // sem internet (ou URL quebrada) a foto cai no retrato desenhado, e a tela não fica com imagem quebrada
  if (src && !falhou && !src.includes("exemplo.ampara.dev"))
    return <img className={className} style={style} src={src} alt={`Foto de ${nome}`} width={640} height={480} loading="lazy" decoding="async" onError={() => setFalhou(true)} />;
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
        // formas grandes e chapadas, como recortes de papel colorido
        background: `radial-gradient(circle at ${15 + (h % 55)}% ${110 - (h % 25)}%, ${tinta}1f 0 34%, transparent 34.5%), radial-gradient(circle at ${88 - (h % 20)}% ${8 + (h % 22)}%, ${tinta}14 0 22%, transparent 22.5%), ${fundo}`,
        color: tinta,
        display: "grid",
        placeItems: "center",
        position: "relative",
        overflow: "hidden",
        containerType: "inline-size",
      }}
    >
      <span style={{ fontFamily: "var(--display)", fontWeight: 800, fontSize: "clamp(1.6rem, 30cqw, 9rem)", letterSpacing: "-0.06em", lineHeight: 1 }}>{nome.charAt(0)}</span>
      <span style={{ position: "absolute", right: "7%", bottom: "7%", width: "clamp(14px, 11cqw, 30px)", opacity: 0.9, display: "grid" }} title={especie === "GATO" ? "Gato" : especie === "CAO" ? "Cão" : undefined}>
        <IcPata tamanho={30} style={{ width: "100%", height: "auto" }} />
      </span>
    </div>
  );
}
