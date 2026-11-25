import { useInfiniteQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { ESTADOS } from "@c/api";
import { Avisos, Carregando, Erro, Vazio } from "@c/ui";
import { listarSolicitacoes, rotas } from "../api/servicos";
import type { EstadoSolicitacao } from "../api/tipos";
import { Cabecalho } from "../componentes/Layout";
import { LinhaSolicitacao } from "../componentes/LinhaSolicitacao";

const FILTROS: (EstadoSolicitacao | undefined)[] = [undefined, "AGUARDANDO_APROVACAO", "APROVADA", "CONCLUIDA", "RECUSADA", "PERFIL_INVALIDO", "CANCELADA", "EXPIRADA"];

export function Solicitacoes() {
  // o filtro mora na URL: dá para compartilhar o link e o "voltar" do navegador respeita
  const [params, setParams] = useSearchParams();
  const estado = (params.get("estado") as EstadoSolicitacao | null) ?? undefined;
  const setEstado = (e?: EstadoSolicitacao) => setParams(e ? { estado: e } : {}, { replace: true });
  const q = useInfiniteQuery({
    queryKey: ["solicitacoes", estado ?? "todas", "paginas"],
    queryFn: ({ pageParam }) => listarSolicitacoes({ estado, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (ultima) => ultima.proximoCursor ?? undefined,
    refetchInterval: 8_000,
  });
  const itens = q.data?.pages.flatMap((p) => p.itens) ?? [];

  return (
    <>
      <Cabecalho titulo="Solicitações de adoção" sobre="Cada pedido passa pela SAGA: reserva o animal, valida o perfil e espera a sua decisão." origem={rotas.origem("solicitacoes")} />
      <div className="chips" role="group" aria-label="Filtrar por estado">
        {FILTROS.map((f) => (
          <button key={f ?? "todas"} className="chip" aria-pressed={estado === f} onClick={() => setEstado(f)}>
            {f ? ESTADOS[f].rotulo : "Todas"}
          </button>
        ))}
      </div>
      {q.isPending && <Carregando />}
      {q.isError && <Erro erro={q.error} onTentar={() => q.refetch()} />}
      {q.data && <Avisos avisos={q.data.pages[0]?.avisos} />}
      {q.isSuccess && itens.length === 0 && <Vazio titulo="Nada por aqui">Nenhuma solicitação {estado ? `em “${ESTADOS[estado].rotulo}”` : "ainda"}.</Vazio>}
      <div className="lista">
        {itens.map((s, i) => <LinhaSolicitacao key={s.id} s={s} atraso={Math.min(i, 10) * 0.03} />)}
      </div>
      {q.hasNextPage && (
        <button className="btn contorno" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
          {q.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
        </button>
      )}
    </>
  );
}
