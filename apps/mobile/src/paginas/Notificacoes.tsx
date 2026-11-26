import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { relativo } from "@c/api";
import { useSessao } from "@c/sessao";
import { Carregando, Erro, Origem, Vazio } from "@c/ui";
import { marcarLida, marcarTodas, notificacoes, rotas } from "../api/servicos";
import type { MinhaConta } from "../api/tipos";
import { Topo } from "../componentes/Casca";

export function Notificacoes() {
  const consultas = useQueryClient();
  const { conta } = useSessao<MinhaConta>();
  const queryKey = ["notificacoes", conta?.id];
  const q = useQuery({ queryKey, queryFn: notificacoes, enabled: !!conta, refetchInterval: 4_000 });
  const atualizar = () => consultas.invalidateQueries({ queryKey });
  const ler = useMutation({ mutationFn: marcarLida, onSuccess: atualizar });
  const lerTodas = useMutation({ mutationFn: marcarTodas, onSuccess: atualizar });
  const temNova = q.data?.itens.some((n) => !n.lida);

  return (
    <>
      <Topo
        titulo="Avisos"
        sobre={<>Cada passo do seu pedido chega aqui. <Origem origem={rotas.origem("notificacoes")} /></>}
        direita={temNova && <button className="btn pequeno contorno" onClick={() => lerTodas.mutate()}>Ler todos</button>}
      />
      {q.isPending && <Carregando />}
      {q.isError && <Erro erro={q.error} onTentar={() => q.refetch()} />}
      {q.data?.itens.length === 0 && <Vazio titulo="Nada de novo" />}
      <div style={{ display: "grid", gap: "0.6rem" }}>
        {q.data?.itens.map((n, i) => (
          <button key={n.id} className={`cartao notificacao ${n.lida ? "" : "nova"}`} style={{ animationDelay: `${i * 0.04}s` }} onClick={() => !n.lida && ler.mutate(n.id)}>
            <strong>{n.titulo}</strong>
            <span className="msg">{n.mensagem}</span>
            <time dateTime={n.criadoEm}>{relativo(n.criadoEm)}</time>
          </button>
        ))}
      </div>
    </>
  );
}
