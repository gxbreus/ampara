import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ESTADOS, dataHora, relativo } from "@c/api";
import { Avisos, Carregando, Erro, LinhaDoTempo, Origem, Retrato } from "@c/ui";
import { cancelar, linhaDoTempo, obterSolicitacao, rotas } from "../api/servicos";
import { Topo } from "../componentes/Casca";

const ETAPAS: Record<string, string> = {
  SOLICITADA: "Pedido enviado",
  ANIMAL_RESERVADO: "Animal reservado",
  PERFIL_VALIDADO: "Perfil validado",
  PERFIL_INVALIDO: "Perfil incompleto",
  AGUARDANDO_APROVACAO: "Com a ONG",
  APROVADA: "Aprovado",
  RECUSADA: "Recusado",
  CONCLUIDA: "Adoção concluída",
  CANCELAMENTO_PEDIDO: "Você desistiu",
  ANIMAL_LIBERADO: "Reserva desfeita",
  EXPIRADA: "Prazo vencido",
};
const FALHAS = new Set(["PERFIL_INVALIDO", "RECUSADA", "CANCELAMENTO_PEDIDO", "ANIMAL_LIBERADO", "EXPIRADA", "REJEITADA_INDISPONIVEL", "FALHOU"]);

const MENSAGEM: Record<string, string> = {
  SOLICITADA: "Recebemos o pedido. Já estamos reservando o animal para você.",
  ANIMAL_RESERVADO: "Reservado! Agora conferimos o seu perfil de adoção.",
  AGUARDANDO_APROVACAO: "Tudo certo do seu lado. A ONG está avaliando o pedido.",
  APROVADA: "A ONG aprovou! Falta só concluir.",
  COMPENSANDO: "Desfazendo a reserva…",
  CONCLUIDA: "Parabéns, a adoção está concluída. 🎉",
  PERFIL_INVALIDO: "O pedido parou porque o perfil de adoção está incompleto.",
  RECUSADA: "A ONG recusou este pedido.",
  CANCELADA: "Você cancelou este pedido.",
  EXPIRADA: "O prazo de resposta venceu e a reserva caiu.",
  REJEITADA_INDISPONIVEL: "O animal já não estava disponível.",
  FALHOU: "Algo deu errado no processo. A reserva foi desfeita.",
};

export function PedidoDetalhe() {
  const { id = "" } = useParams();
  const consultas = useQueryClient();
  const [confirmar, setConfirmar] = useState(false);
  const fim = (e?: string) => !!e && !!ESTADOS[e]?.final;

  const s = useQuery({ queryKey: ["pedido", id], queryFn: () => obterSolicitacao(id), refetchInterval: (c) => (fim(c.state.data?.estado) ? false : 1_500) });
  const t = useQuery({ queryKey: ["tempo", id], queryFn: () => linhaDoTempo(id), refetchInterval: () => (fim(s.data?.estado) ? false : 1_500) });
  const desistir = useMutation({
    mutationFn: () => cancelar(id),
    onSuccess: () => {
      setConfirmar(false);
      consultas.invalidateQueries({ queryKey: ["pedido", id] });
      consultas.invalidateQueries({ queryKey: ["pedidos"] });
    },
  });

  if (s.isPending) return <Carregando />;
  if (s.isError) return <Erro erro={s.error} onTentar={() => s.refetch()} />;
  const p = s.data;
  const e = ESTADOS[p.estado] ?? { rotulo: p.estado, tom: "neutro" };

  return (
    <>
      <Topo voltar titulo={<>Pedido por <em>{p.animal.nome}</em></>} direita={<Origem origem={rotas.origem("solicitacoes")} />} />
      <Avisos avisos={p.avisos} />
      <section className={`estado-grande ${e.tom} surgir`} aria-live="polite">
        <small>{e.rotulo}</small>
        <strong>{MENSAGEM[p.estado] ?? e.rotulo}</strong>
        {p.expiraEm && p.estado === "AGUARDANDO_APROVACAO" && <span style={{ fontSize: "0.85rem", opacity: 0.8 }}>A ONG tem até {dataHora(p.expiraEm)} ({relativo(p.expiraEm)}).</span>}
      </section>

      <Link to={`/animais/${p.animal.id}`} className="cartao pedido">
        <Retrato className="foto" nome={p.animal.nome} especie={p.animal.especie} src={p.animal.fotoThumb} />
        <div>
          <strong>{p.animal.nome}</strong>
          <small>{p.animal.responsavel.nome}</small>
        </div>
      </Link>

      <section className="cartao" style={{ padding: "1.2rem" }}>
        <h2 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>Linha do tempo</h2>
        {t.isPending && <Carregando />}
        {t.isError && <Erro erro={t.error} />}
        {t.data && (
          <LinhaDoTempo
            atualFinal={fim(p.estado)}
            etapas={t.data.etapas.map((x) => ({ titulo: ETAPAS[x.etapa] ?? x.etapa, detalhe: x.descricao, em: x.concluidaEm, falha: FALHAS.has(x.etapa) }))}
          />
        )}
      </section>

      {p.podeCancelar && (
        <section style={{ display: "grid", gap: "0.6rem" }}>
          {desistir.isError && <Erro erro={desistir.error} />}
          {confirmar ? (
            <>
              <p style={{ margin: 0, textAlign: "center" }}>Desistir libera {p.animal.nome} para outras pessoas. Tem certeza?</p>
              <button className="btn perigo largo" disabled={desistir.isPending} onClick={() => desistir.mutate()}>
                {desistir.isPending ? "Cancelando…" : "Sim, desistir do pedido"}
              </button>
              <button className="btn contorno largo" onClick={() => setConfirmar(false)}>Voltar</button>
            </>
          ) : (
            <button className="btn contorno largo" onClick={() => setConfirmar(true)}>Desistir do pedido</button>
          )}
        </section>
      )}
    </>
  );
}
