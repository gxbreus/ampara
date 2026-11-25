import { useTituloPagina } from "@c/ganchos";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { IcCasa, IcEnvelope, IcEscudo, IcPata, IcSair } from "@c/icones";
import { Logo } from "@c/marca";
import { useSessao } from "@c/sessao";
import { rotas, type Grupo } from "../api/servicos";
import type { MinhaConta } from "../api/tipos";

const PAPEIS: Record<string, string> = { ONG: "ONG", PROTETOR: "Protetor(a)", ADMIN: "Administração" };
const GRUPOS: Grupo[] = ["auth", "eu", "painel", "animais", "solicitacoes", "admin"];

function tituloDaRota(caminho: string) {
  if (caminho === "/") return "Visão geral";
  if (caminho === "/animais/novo") return "Cadastrar animal";
  if (caminho.endsWith("/editar")) return "Editar animal";
  if (caminho.startsWith("/animais/")) return "Animal";
  if (caminho === "/animais") return "Animais";
  if (caminho.startsWith("/solicitacoes/")) return "Solicitação";
  if (caminho === "/solicitacoes") return "Solicitações";
  if (caminho.startsWith("/admin")) return "Verificação de contas";
  return undefined;
}

export function Layout({ children }: { children: ReactNode }) {
  const { conta, sair } = useSessao<MinhaConta>();
  const navegar = useNavigate();
  const consultas = useQueryClient();
  const { pathname } = useLocation();
  useTituloPagina(tituloDaRota(pathname), "Ampara · Painel");

  // ao trocar de tela, volta ao topo e leva o foco ao conteúdo (leitor de tela anuncia a página nova)
  useEffect(() => {
    window.scrollTo({ top: 0 });
    document.getElementById("conteudo")?.focus({ preventScroll: true });
  }, [pathname]);

  const encerrar = () => {
    sair();
    consultas.clear();
    navegar("/entrar");
  };

  return (
    <div className="casca">
      <a href="#conteudo" className="pular">Pular para o conteúdo</a>
      <aside className="lateral">
        <NavLink to="/" className="lateral-marca" aria-label="Ampara, visão geral">
          <Logo tamanho={36} sub="painel de quem cuida" />
        </NavLink>

        <nav className="menu" aria-label="Seções do painel">
          <NavLink to="/" end>
            <IcCasa /> <span>Visão geral</span>
          </NavLink>
          <NavLink to="/animais">
            <IcPata /> <span>Animais</span>
          </NavLink>
          <NavLink to="/solicitacoes">
            <IcEnvelope /> <span>Solicitações</span>
          </NavLink>
          {conta?.role === "ADMIN" && (
            <NavLink to="/admin/contas">
              <IcEscudo /> <span>Contas</span>
            </NavLink>
          )}
        </nav>

        <details className="integracao">
          <summary>Integração das rotas</summary>
          <ul>
            {GRUPOS.map((g) => (
              <li key={g}>
                <code>{g}</code>
                <span className={`origem ${rotas.origem(g)}`}>{rotas.origem(g)}</span>
              </li>
            ))}
          </ul>
        </details>

        <div className="quem">
          <div className="avatar" aria-hidden>
            {conta?.nome.charAt(0)}
          </div>
          <div className="quem-texto">
            <strong>{conta?.nome}</strong>
            <small>{PAPEIS[conta?.role ?? ""] ?? conta?.role}</small>
          </div>
          <button className="sair" onClick={encerrar} aria-label="Sair da conta" title="Sair">
            <IcSair />
          </button>
        </div>
      </aside>
      <main className="conteudo" id="conteudo" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}

export function Cabecalho({ titulo, sobre, origem, acoes }: { titulo: ReactNode; sobre?: ReactNode; origem?: "real" | "simulado"; acoes?: ReactNode }) {
  return (
    <header className="cabecalho surgir">
      <div className="cabecalho-texto">
        <h1>{titulo}</h1>
        {(sobre || origem) && (
          <p>
            {sobre} {origem && <span className={`origem ${origem}`}>{origem === "real" ? "● real" : "◌ simulado"}</span>}
          </p>
        )}
      </div>
      {acoes && <div className="acoes">{acoes}</div>}
    </header>
  );
}
