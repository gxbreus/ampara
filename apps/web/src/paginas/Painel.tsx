import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ESTADOS, STATUS_ANIMAL } from "@c/api";
import { useSessao } from "@c/sessao";
import { Avisos, Carregando, Erro, Vazio } from "@c/ui";
import { listarSolicitacoes, obterPainel, rotas } from "../api/servicos";
import type { MinhaConta } from "../api/tipos";
import { Cabecalho } from "../componentes/Layout";
import { LinhaSolicitacao } from "../componentes/LinhaSolicitacao";

const saudacao = () => {
  const h = new Date().getHours();
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
};

export function Painel() {
  const { conta } = useSessao<MinhaConta>();
  const painel = useQuery({ queryKey: ["painel"], queryFn: obterPainel, refetchInterval: 10_000 });
  const pendentes = useQuery({
    queryKey: ["solicitacoes", "AGUARDANDO_APROVACAO"],
    queryFn: () => listarSolicitacoes({ estado: "AGUARDANDO_APROVACAO" }),
    refetchInterval: 5_000,
  });

  const p = painel.data;
  const maxStatus = Math.max(1, ...Object.values(p?.animais?.porStatus ?? {}).map(Number));
  const maxEstado = Math.max(1, ...Object.values(p?.solicitacoes?.porEstado ?? {}).map(Number));

  return (
    <>
      <Cabecalho
        titulo={<>{saudacao()}, <em>{conta?.nome.split(" ")[0]}</em>.</>}
        sobre="Como estão os seus animais e quem está esperando uma resposta."
        acoes={<Link className="btn acento" to="/animais/novo">+ Cadastrar animal</Link>}
      />

      {painel.isError && <Erro erro={painel.error} onTentar={() => painel.refetch()} />}
      {p && <Avisos avisos={p.avisos} />}

      <section className="numeros">
        <Link to="/solicitacoes" className="cartao numero destaque">
          <span className="valor">{p?.solicitacoes?.aguardandoAprovacao ?? "–"}</span>
          <span className="rotulo">aguardando sua decisão</span>
        </Link>
        <div className="cartao numero">
          <span className="valor">{p?.animais?.total ?? "–"}</span>
          <span className="rotulo">animais cadastrados</span>
        </div>
        <div className="cartao numero">
          <span className="valor">{p?.animais?.porStatus.DISPONIVEL ?? 0}</span>
          <span className="rotulo">disponíveis na busca</span>
        </div>
        <div className="cartao numero">
          <span className="valor">{p?.solicitacoes?.concluidasNoMes ?? "–"}</span>
          <span className="rotulo">adoções no mês</span>
        </div>
      </section>

      <div className="duas-colunas">
        <section className="cartao bloco">
          <h2>
            Esperando resposta <small><span className={`origem ${rotas.origem("solicitacoes")}`}>{rotas.origem("solicitacoes")}</span></small>
          </h2>
          {pendentes.isPending && <Carregando />}
          {pendentes.isError && <Erro erro={pendentes.error} onTentar={() => pendentes.refetch()} />}
          {pendentes.data && <Avisos avisos={pendentes.data.avisos} />}
          {pendentes.data?.itens.length === 0 && (
            <Vazio titulo="Nenhum pedido pendente">Quando alguém pedir um dos seus animais, o pedido aparece aqui.</Vazio>
          )}
          <div className="lista">
            {pendentes.data?.itens.slice(0, 5).map((s, i) => <LinhaSolicitacao key={s.id} s={s} atraso={i * 0.05} />)}
          </div>
        </section>

        <section className="cartao bloco">
          <h2>
            Retrato do abrigo <small><span className={`origem ${rotas.origem("painel")}`}>{rotas.origem("painel")}</span></small>
          </h2>
          {painel.isPending && <Carregando />}
          {p?.animais && (
            <div className="barras">
              {Object.entries(p.animais.porStatus).map(([st, n]) => (
                <div className="barra" key={st}>
                  <span>{STATUS_ANIMAL[st]?.rotulo ?? st}</span>
                  <span className="trilho"><span style={{ width: `${(Number(n) / maxStatus) * 100}%` }} /></span>
                  <b>{n}</b>
                </div>
              ))}
            </div>
          )}
          {p?.solicitacoes && (
            <>
              <h2 style={{ fontSize: "1.1rem", marginTop: "0.5rem" }}>Pedidos por estado</h2>
              <div className="barras">
                {Object.entries(p.solicitacoes.porEstado).map(([e, n]) => (
                  <div className="barra" key={e}>
                    <span>{ESTADOS[e]?.rotulo ?? e}</span>
                    <span className="trilho"><span style={{ width: `${(Number(n) / maxEstado) * 100}%`, background: "var(--terracota)" }} /></span>
                    <b>{n}</b>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}
