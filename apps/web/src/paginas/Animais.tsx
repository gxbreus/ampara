import { IcMais } from "@c/icones";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { ESPECIES, PORTES, STATUS_ANIMAL, relativo } from "@c/api";
import { Avisos, Carregando, Erro, Retrato, SeloStatus, Vazio } from "@c/ui";
import { listarAnimais, rotas } from "../api/servicos";
import type { StatusAnimal } from "../api/tipos";
import { Cabecalho } from "../componentes/Layout";

const FILTROS: (StatusAnimal | undefined)[] = [undefined, "DISPONIVEL", "RESERVADO", "EM_TRATAMENTO", "INDISPONIVEL", "ADOTADO"];

export function Animais() {
  const [params, setParams] = useSearchParams();
  const status = (params.get("status") as StatusAnimal | null) ?? undefined;
  const setStatus = (s?: StatusAnimal) => setParams(s ? { status: s } : {}, { replace: true });
  const q = useQuery({ queryKey: ["animais", status ?? "todos"], queryFn: () => listarAnimais({ status }) });

  return (
    <>
      <Cabecalho
        titulo="Seus animais"
        sobre="Quem está reservado ou adotado muda de status pela SAGA, não à mão."
        origem={rotas.origem("animais")}
        acoes={<Link className="btn acento" to="/animais/novo"><IcMais tamanho={18} /> Cadastrar animal</Link>}
      />
      <div className="chips" role="group" aria-label="Filtrar por status">
        {FILTROS.map((f) => (
          <button key={f ?? "todos"} className="chip" aria-pressed={status === f} onClick={() => setStatus(f)}>
            {f ? STATUS_ANIMAL[f].rotulo : "Todos"}
          </button>
        ))}
      </div>
      {q.isPending && <Carregando />}
      {q.isError && <Erro erro={q.error} onTentar={() => q.refetch()} />}
      {q.data && <Avisos avisos={q.data.avisos} />}
      {q.data?.itens.length === 0 && <Vazio titulo="Nenhum animal aqui">Cadastre um animal para ele aparecer na busca dos adotantes.</Vazio>}
      <div className="grade">
        {q.data?.itens.map((a, i) => (
          <Link key={a.id} to={`/animais/${a.id}`} className="cartao ficha" style={{ animationDelay: `${Math.min(i, 12) * 0.04}s` }}>
            <Retrato nome={a.nome} especie={a.especie} src={a.fotoCapa} />
            <div className="corpo">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
                <h3>{a.nome}</h3>
                <SeloStatus status={a.status} />
              </div>
              <span className="meta">{ESPECIES[a.especie]} · porte {PORTES[a.porte].toLowerCase()}</span>
              <div className="rodape">
                <span>atualizado {relativo(a.atualizadoEm)}</span>
                {!!a.solicitacoesAtivas && <span className="contagem">{a.solicitacoesAtivas} pedido{a.solicitacoesAtivas > 1 ? "s" : ""}</span>}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
