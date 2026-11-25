import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet } from "react-router-dom";
import { useSessao } from "@c/sessao";
import { notificacoes } from "../api/servicos";
import type { MinhaConta } from "../api/tipos";

export function Casca() {
  const { conta } = useSessao<MinhaConta>();
  const avisos = useQuery({ queryKey: ["notificacoes"], queryFn: notificacoes, enabled: !!conta, refetchInterval: 4_000 });
  const naoLidas = avisos.data?.itens.filter((n) => !n.lida).length ?? 0;

  return (
    <div className="aparelho">
      <div className="tela">
        <Outlet />
      </div>
      <nav className="abas" aria-label="Navegação principal">
        <NavLink to="/" end>
          <span aria-hidden>⌕</span>Buscar
        </NavLink>
        <NavLink to="/pedidos">
          <span aria-hidden>❤</span>Pedidos
        </NavLink>
        <NavLink to="/assistente">
          <span aria-hidden>✦</span>Assistente
        </NavLink>
        <NavLink to="/avisos">
          <span aria-hidden>
            ◔{naoLidas > 0 && <b className="bolinha">{naoLidas}</b>}
          </span>
          Avisos
        </NavLink>
        <NavLink to={conta ? "/perfil" : "/entrar"}>
          <span aria-hidden>☺</span>
          {conta ? "Perfil" : "Entrar"}
        </NavLink>
      </nav>
    </div>
  );
}

export function Topo({ titulo, sobre, voltar, direita }: { titulo: React.ReactNode; sobre?: React.ReactNode; voltar?: boolean; direita?: React.ReactNode }) {
  return (
    <header className="topo surgir">
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", justifyContent: "space-between" }}>
        {voltar && (
          <button className="voltar-btn" onClick={() => history.back()} aria-label="Voltar">
            ←
          </button>
        )}
        <h1 style={{ flex: 1 }}>{titulo}</h1>
        {direita}
      </div>
      {sobre && <p>{sobre}</p>}
    </header>
  );
}
