// Marca da Ampara: um arco de abrigo (casa e abraço ao mesmo tempo) com uma pata dentro.
// O arco é sempre laranja; a pata usa a cor do fundo onde a marca está, como um recorte.

interface PropsSimbolo {
  tamanho?: number;
  pata?: string; // cor da pata (o "recorte"); padrão: papel
  arco?: string;
  titulo?: string;
}

export function Simbolo({ tamanho = 40, pata = "var(--papel)", arco = "var(--laranja)", titulo = "Ampara" }: PropsSimbolo) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 48 48" role="img" aria-label={titulo} style={{ flex: "none" }}>
      <path d="M5 45V23C5 12.5 13.5 4 24 4s19 8.5 19 19v22z" fill={arco} />
      <g fill={pata}>
        <ellipse cx="24" cy="34" rx="7.2" ry="5.8" />
        <circle cx="14.6" cy="25.8" r="3" />
        <circle cx="19.8" cy="19.8" r="3.2" />
        <circle cx="28.2" cy="19.8" r="3.2" />
        <circle cx="33.4" cy="25.8" r="3" />
      </g>
    </svg>
  );
}

export function Logo({ tamanho = 34, pata, arco, sub, cor = "var(--tinta)" }: { tamanho?: number; pata?: string; arco?: string; sub?: string; cor?: string }) {
  return (
    <span className="logo" style={{ color: cor }}>
      <Simbolo tamanho={tamanho} pata={pata} arco={arco} />
      <span className="logo-texto">
        <span className="logo-nome" translate="no" style={{ fontSize: tamanho * 0.82 }}>
          ampara
        </span>
        {sub && <span className="logo-sub">{sub}</span>}
      </span>
    </span>
  );
}
