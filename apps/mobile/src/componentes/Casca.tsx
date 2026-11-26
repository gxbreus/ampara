import { useTituloPagina } from "@c/ganchos";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { IcBrilho, IcBusca, IcCoracao, IcPessoa, IcSino, IcVoltar } from "@c/icones";
import { Logo } from "@c/marca";
import { useSessao } from "@c/sessao";
import { notificacoes } from "../api/servicos";
import type { MinhaConta } from "../api/tipos";

function tituloDaRota(caminho: string) {
  if (caminho === "/") return "Buscar animais";
  if (caminho.startsWith("/animais/")) return "Animal";
  if (caminho.startsWith("/pedidos/")) return "Pedido";
  if (caminho === "/pedidos") return "Meus pedidos";
  if (caminho === "/assistente") return "Assistente";
  if (caminho === "/avisos") return "Avisos";
  if (caminho === "/perfil") return "Perfil";
  return undefined;
}

export function Casca() {
  const { conta } = useSessao<MinhaConta>();
  const { pathname } = useLocation();
  useTituloPagina(tituloDaRota(pathname), "Ampara");
  const avisos = useQuery({ queryKey: ["notificacoes", conta?.id], queryFn: notificacoes, enabled: !!conta, refetchInterval: 4_000 });
  const naoLidas = avisos.data?.itens.filter((n) => !n.lida).length ?? 0;

  // cada tela nova começa do topo, e o foco vai para o conteúdo (leitor de tela anuncia a mudança)
  useEffect(() => {
    window.scrollTo({ top: 0 });
    document.getElementById("conteudo")?.focus({ preventScroll: true });
  }, [pathname]);

  return (
    <div className="aparelho">
      <a href="#conteudo" className="pular">Pular para o conteúdo</a>
      <main className="tela" id="conteudo" tabIndex={-1}>
        <Outlet />
      </main>
      <nav className="abas" aria-label="Navegação principal">
        <NavLink to="/" end>
          <IcBusca />
          <span>Buscar</span>
        </NavLink>
        <NavLink to="/pedidos">
          <IcCoracao />
          <span>Pedidos</span>
        </NavLink>
        <NavLink to="/assistente">
          <IcBrilho />
          <span>Assistente</span>
        </NavLink>
        <NavLink to="/avisos" aria-label={naoLidas ? `Avisos, ${naoLidas} não lidos` : "Avisos"}>
          <span className="icone-com-bolinha">
            <IcSino />
            {naoLidas > 0 && <b className="bolinha" aria-hidden>{naoLidas > 9 ? "9+" : naoLidas}</b>}
          </span>
          <span>Avisos</span>
        </NavLink>
        <NavLink to={conta ? "/perfil" : "/entrar"}>
          <IcPessoa />
          <span>{conta ? "Perfil" : "Entrar"}</span>
        </NavLink>
      </nav>
    </div>
  );
}

// "Voltar" leva à tela anterior quando ela é do app; aberto por link direto, cai num destino seguro.
export function BotaoVoltar({ para = "/", className = "voltar-btn" }: { para?: string; className?: string }) {
  const navegar = useNavigate();
  const { key } = useLocation();
  return (
    <button className={className} onClick={() => (key !== "default" ? navegar(-1) : navegar(para))} aria-label="Voltar">
      <IcVoltar />
    </button>
  );
}

export function Topo({ titulo, sobre, voltar, direita }: { titulo: React.ReactNode; sobre?: React.ReactNode; voltar?: string; direita?: React.ReactNode }) {
  return (
    <header className="topo surgir">
      <div className="topo-linha">
        {voltar ? (
          <BotaoVoltar para={voltar} />
        ) : (
          <Link to="/" className="topo-marca" aria-label="Ampara, início">
            <Logo tamanho={26} />
          </Link>
        )}
        {direita}
      </div>
      <h1>{titulo}</h1>
      {sobre && <p>{sobre}</p>}
    </header>
  );
}
