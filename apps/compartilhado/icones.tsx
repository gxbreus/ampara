// Ícones de traço único (24×24, traço 2), desenhados para a Ampara. Herdam a cor do texto.
import type { SVGProps } from "react";

type Props = SVGProps<SVGSVGElement> & { tamanho?: number };

function Base({ tamanho = 22, children, ...resto }: Props & { children: React.ReactNode }) {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable={false}
      style={{ flex: "none" }}
      {...resto}
    >
      {children}
    </svg>
  );
}

export const IcCasa = (p: Props) => (
  <Base {...p}>
    <path d="M4 20v-8.5A8 8 0 0 1 20 11.5V20z" />
    <path d="M9.5 20v-4.5a2.5 2.5 0 0 1 5 0V20" />
  </Base>
);
export const IcPata = (p: Props) => (
  <Base {...p}>
    <path d="M12 13.5c-2.6 0-4.5 2.1-4.5 4.1 0 1.4 1 2.4 2.4 2.4.9 0 1.4-.4 2.1-.4s1.2.4 2.1.4c1.4 0 2.4-1 2.4-2.4 0-2-1.9-4.1-4.5-4.1z" />
    <circle cx="5.5" cy="10.5" r="1.8" />
    <circle cx="9" cy="6.5" r="1.9" />
    <circle cx="15" cy="6.5" r="1.9" />
    <circle cx="18.5" cy="10.5" r="1.8" />
  </Base>
);
export const IcEnvelope = (p: Props) => (
  <Base {...p}>
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <path d="m4 7 8 6 8-6" />
  </Base>
);
export const IcEscudo = (p: Props) => (
  <Base {...p}>
    <path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z" />
    <path d="m9 12 2 2 4-4" />
  </Base>
);
export const IcSair = (p: Props) => (
  <Base {...p}>
    <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
    <path d="M10 16l-4-4 4-4M6 12h10" />
  </Base>
);
export const IcBusca = (p: Props) => (
  <Base {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </Base>
);
export const IcCoracao = (p: Props) => (
  <Base {...p}>
    <path d="M12 20s-7.5-4.4-7.5-10.1A4.4 4.4 0 0 1 12 7.3a4.4 4.4 0 0 1 7.5 2.6C19.5 15.6 12 20 12 20z" />
  </Base>
);
export const IcBrilho = (p: Props) => (
  <Base {...p}>
    <path d="M12 3.5 13.8 9a2 2 0 0 0 1.2 1.2l5.5 1.8-5.5 1.8a2 2 0 0 0-1.2 1.2L12 20.5 10.2 15a2 2 0 0 0-1.2-1.2L3.5 12 9 10.2A2 2 0 0 0 10.2 9z" />
  </Base>
);
export const IcSino = (p: Props) => (
  <Base {...p}>
    <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
    <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
  </Base>
);
export const IcPessoa = (p: Props) => (
  <Base {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
  </Base>
);
export const IcVoltar = (p: Props) => (
  <Base {...p}>
    <path d="M15 5l-7 7 7 7" />
  </Base>
);
export const IcMais = (p: Props) => (
  <Base {...p}>
    <path d="M12 5v14M5 12h14" />
  </Base>
);
export const IcLocal = (p: Props) => (
  <Base {...p}>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
    <circle cx="12" cy="10" r="2.3" />
  </Base>
);
export const IcSeta = (p: Props) => (
  <Base {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Base>
);
export const IcEnviar = (p: Props) => (
  <Base {...p}>
    <path d="M4 12 20 4l-5 16-3-7z" />
    <path d="m12 13 8-9" />
  </Base>
);
export const IcFonte = (p: Props) => (
  <Base {...p}>
    <path d="M6 3h9l4 4v14H6z" />
    <path d="M14 3v5h5M9 13h7M9 17h5" />
  </Base>
);
export const IcAlerta = (p: Props) => (
  <Base {...p}>
    <path d="M12 4 2.8 19.5h18.4z" />
    <path d="M12 10v4M12 17v.01" />
  </Base>
);
export const IcX = (p: Props) => (
  <Base {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Base>
);
export const IcCheck = (p: Props) => (
  <Base {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Base>
);
export const IcEditar = (p: Props) => (
  <Base {...p}>
    <path d="M4 20h4L19 9l-4-4L4 16z" />
    <path d="m13.5 6.5 4 4" />
  </Base>
);
export const IcGrade = (p: Props) => (
  <Base {...p}>
    <rect x="4" y="4" width="7" height="7" rx="2" />
    <rect x="13" y="4" width="7" height="7" rx="2" />
    <rect x="4" y="13" width="7" height="7" rx="2" />
    <rect x="13" y="13" width="7" height="7" rx="2" />
  </Base>
);
export const IcRelogio = (p: Props) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Base>
);
