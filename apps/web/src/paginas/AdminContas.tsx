import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Carregando, Erro, Selo, Vazio } from "@c/ui";
import { listarContas, rotas, verificarConta } from "../api/servicos";
import { Cabecalho } from "../componentes/Layout";

export function AdminContas() {
  const [status, setStatus] = useState<"PENDENTE_VERIFICACAO" | "VERIFICADA">("PENDENTE_VERIFICACAO");
  const consultas = useQueryClient();
  const q = useQuery({ queryKey: ["contas", status], queryFn: () => listarContas(status) });
  const verificar = useMutation({
    mutationFn: verificarConta,
    onSuccess: () => consultas.invalidateQueries({ queryKey: ["contas"] }),
  });

  return (
    <>
      <Cabecalho titulo="Verificação de contas" sobre="ONGs e protetores só publicam animais depois de verificados." origem={rotas.origem("admin")} />
      <div className="chips">
        <button className="chip" aria-pressed={status === "PENDENTE_VERIFICACAO"} onClick={() => setStatus("PENDENTE_VERIFICACAO")}>Pendentes</button>
        <button className="chip" aria-pressed={status === "VERIFICADA"} onClick={() => setStatus("VERIFICADA")}>Verificadas</button>
      </div>
      {q.isPending && <Carregando />}
      {q.isError && <Erro erro={q.error} onTentar={() => q.refetch()} />}
      {verificar.isError && <Erro erro={verificar.error} />}
      {q.data?.length === 0 && <Vazio titulo={status === "PENDENTE_VERIFICACAO" ? "Nenhuma conta esperando" : "Nenhuma conta verificada"} />}
      <div className="lista">
        {q.data?.map((c, i) => (
          <div key={c.id} className="linha-solicitacao" style={{ gridTemplateColumns: "48px 1fr auto auto", animationDelay: `${i * 0.04}s` }}>
            <div className="avatar" style={{ color: "var(--papel)" }}>{c.nome.charAt(0)}</div>
            <div>
              <strong>{c.nome}</strong>
              <small>{c.role === "ONG" ? "ONG" : "Protetor(a)"} · {c.cidade}</small>
            </div>
            <Selo tom={c.statusVerificacao === "VERIFICADA" ? "ok" : "atencao"}>{c.statusVerificacao === "VERIFICADA" ? "Verificada" : "Pendente"}</Selo>
            {c.statusVerificacao === "PENDENTE_VERIFICACAO" ? (
              <button className="btn pequeno acento" disabled={verificar.isPending} onClick={() => verificar.mutate(c.id)}>Verificar</button>
            ) : <span />}
          </div>
        ))}
      </div>
    </>
  );
}
