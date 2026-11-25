import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useSessao } from "@c/sessao";
import { rotas, type Grupo } from "../api/servicos";
import type { MinhaConta } from "../api/tipos";

const PAPEIS: Record<string, string> = { ONG: "ONG", PROTETOR: "Protetor(a)", ADMIN: "Administração" };
const GRUPOS: Grupo[] = ["auth", "eu", "painel", "animais", "solicitacoes", "admin"];

export function Layout({ children }: { children: ReactNode }) {
  const { conta, sair } = useSessao<MinhaConta>();
  const navegar = useNavigate();
  const consultas = useQueryClient();

  return (
    <div className="casca">
      <aside className="lateral">
        <div className="marca">
          <span className="marca-nome">Ampara</span>
          <span className="marca-sub">painel de quem cuida</span>
        </div>
        <nav>
          <NavLink to="/" end>
            <span aria-hidden>◐</span> Visão geral
          </NavLink>
          <NavLink to="/animais">
            <span aria-hidden>🐾</span> Animais
          </NavLink>
          <NavLink to="/solicitacoes">
            <span aria-hidden>✉</span> Solicitações
          </NavLink>
          {conta?.role === "ADMIN" && (
            <NavLink to="/admin/contas">
              <span aria-hidden>✓</span> Verificar contas
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
          <div>
            <strong>{conta?.nome}</strong>
            <small>{PAPEIS[conta?.role ?? ""] ?? conta?.role}</small>
          </div>
          <button
            className="sair"
            title="Sair"
            onClick={() => {
              sair();
              consultas.clear();
              navegar("/entrar");
            }}
          >
            ⎋<span className="sr-only">Sair</span>
          </button>
        </div>
      </aside>
      <main className="conteudo">{children}</main>
    </div>
  );
}

export function Cabecalho({ titulo, sobre, origem, acoes }: { titulo: ReactNode; sobre?: ReactNode; origem?: "real" | "simulado"; acoes?: ReactNode }) {
  return (
    <header className="cabecalho surgir">
      <div>
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
