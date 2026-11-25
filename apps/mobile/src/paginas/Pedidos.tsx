import { IcSeta } from "@c/icones";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { PORTES, relativo } from "@c/api";
import { Avisos, Carregando, Erro, Origem, Retrato, SeloEstado, Vazio } from "@c/ui";
import { minhasSolicitacoes, rotas } from "../api/servicos";
import { Topo } from "../componentes/Casca";

export function Pedidos() {
  const q = useQuery({ queryKey: ["pedidos"], queryFn: minhasSolicitacoes, refetchInterval: 3_000 });
  return (
    <>
      <Topo titulo="Meus pedidos" sobre="Acompanhe cada adoção do pedido até a casa nova." direita={<Origem origem={rotas.origem("solicitacoes")} />} />
      {q.isPending && <Carregando />}
      {q.isError && <Erro erro={q.error} onTentar={() => q.refetch()} />}
      {q.data && <Avisos avisos={q.data.avisos} />}
      {q.data?.itens.length === 0 && (
        <Vazio titulo="Nenhum pedido ainda">
          <Link to="/">Encontre um animal</Link> e toque em “Quero adotar”.
        </Vazio>
      )}
      {q.data?.itens.map((s, i) => (
        <Link key={s.id} to={`/pedidos/${s.id}`} className="cartao pedido" style={{ animationDelay: `${i * 0.05}s` }}>
          <Retrato className="foto" nome={s.animal.nome ?? "?"} src={s.animal.fotoThumb} />
          <div style={{ display: "grid", gap: "0.3rem" }}>
            <strong>{s.animal.nome ?? "Animal"}</strong>
            <small>
              {s.animal.porte ? `${PORTES[s.animal.porte]} · ` : ""}pedido {relativo(s.criadoEm)}
            </small>
            <span><SeloEstado estado={s.estado} /></span>
          </div>
          <IcSeta className="seta" />
        </Link>
      ))}
    </>
  );
}
