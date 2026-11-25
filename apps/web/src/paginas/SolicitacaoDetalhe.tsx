import { IcVoltar } from "@c/icones";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ESTADOS, MORADIAS, dataHora, relativo } from "@c/api";
import { Avisos, Carregando, Erro, LinhaDoTempo, Retrato, SeloEstado, ehFalha } from "@c/ui";
import { obterSolicitacao, rotas, seguirLink } from "../api/servicos";
import { Cabecalho } from "../componentes/Layout";

// A Adoção grava o evento em PascalCase (SolicitacaoCriada); o catálogo usa ponto (adocao.aprovada).
const EVENTOS: Record<string, string> = {
  SolicitacaoCriada: "Pedido recebido",
  AnimalReservado: "Animal reservado para o pedido",
  AnimalIndisponivel: "O animal já não estava disponível",
  PerfilValidado: "Perfil do adotante validado",
  PerfilInvalido: "Perfil do adotante incompleto",
  VagaOcupada: "Vaga do adotante ocupada",
  Aprovada: "Você aprovou",
  Recusada: "Você recusou",
  Cancelada: "O adotante desistiu",
  Expirada: "Prazo de resposta venceu",
  Timeout: "Um serviço não respondeu a tempo",
  ReservaLiberada: "Reserva desfeita, animal de volta à busca",
  AdocaoConcluida: "Adoção concluída",
  CompensacaoRetomada: "Compensação retomada pela administração",
  "solicitacao.criada": "Pedido recebido",
  "solicitacao.decidida": "Decisão registrada",
  "solicitacao.retomada": "Compensação retomada pela administração",
  "adocao.aguardando_aprovacao": "Pronto para a sua decisão",
  "adocao.falhou": "A SAGA não conseguiu concluir",
  "adocao.solicitada": "Pedido recebido",
  "animal.reservado": "Animal reservado para o pedido",
  "perfil.validado": "Perfil do adotante validado",
  "perfil.invalido": "Perfil do adotante incompleto",
  "adocao.aprovada": "Você aprovou",
  "adocao.recusada": "Você recusou",
  "adocao.concluida": "Adoção concluída",
  "animal.liberado": "Reserva desfeita, animal de volta à busca",
  "adocao.expirada": "Prazo de resposta venceu",
  "adocao.cancelada": "O adotante desistiu",
};

export function SolicitacaoDetalhe() {
  const { id = "" } = useParams();
  const consultas = useQueryClient();
  const [motivo, setMotivo] = useState("");
  const [recusando, setRecusando] = useState(false);

  const q = useQuery({
    queryKey: ["solicitacao", id],
    queryFn: () => obterSolicitacao(id),
    // enquanto a SAGA anda, a tela acompanha sozinha
    refetchInterval: (consulta) => (consulta.state.data && ESTADOS[consulta.state.data.estado]?.final ? false : 2_000),
  });

  const decidir = useMutation({
    mutationFn: ({ href, corpo }: { href: string; corpo?: { motivo?: string } }) => seguirLink(href, corpo),
    onSuccess: () => {
      setRecusando(false);
      consultas.invalidateQueries({ queryKey: ["solicitacao", id] });
      consultas.invalidateQueries({ queryKey: ["solicitacoes"] });
      consultas.invalidateQueries({ queryKey: ["painel"] });
    },
  });

  if (q.isPending) return <Carregando />;
  if (q.isError) return <Erro erro={q.error} onTentar={() => q.refetch()} />;
  const s = q.data;
  const perfil = s.adotante?.perfil;
  const final = ESTADOS[s.estado]?.final;

  return (
    <>
      <Link to="/solicitacoes" className="voltar"><IcVoltar tamanho={18} /> Solicitações</Link>
      <Cabecalho
        titulo={<>Pedido por <em>{s.animal?.nome ?? "um animal"}</em></>}
        sobre={<>feito {relativo(s.criadoEm)} · <SeloEstado estado={s.estado} /></>}
        origem={rotas.origem("solicitacoes")}
      />
      <Avisos avisos={s.avisos} />

      <div className="detalhe">
        <div className="coluna">
          {s.animal && (
            <Link to={`/animais/${s.animal.id}`} className="retrato" style={{ display: "block" }}>
              <Retrato nome={s.animal.nome} src={s.animal.fotoCapa} />
            </Link>
          )}
          <section className="cartao bloco">
            <h2>Linha do tempo</h2>
            <LinhaDoTempo
              atualFinal={final}
              etapas={s.historico.map((h) => ({
                titulo: ESTADOS[h.para]?.rotulo ?? h.para,
                detalhe: EVENTOS[h.evento] ?? h.evento,
                em: h.em,
                falha: ehFalha(h.para),
              }))}
            />
          </section>
        </div>

        <div className="coluna">
          {(s._links.aprovar || s._links.recusar) && (
            <section className="cartao decisao surgir">
              <h2>Sua decisão</h2>
              <p style={{ margin: 0 }}>
                {s.animal?.nome} está reservado para este pedido
                {s.expiraEm && <> até <strong>{dataHora(s.expiraEm)}</strong> ({relativo(s.expiraEm)})</>}. Se o prazo vencer, a reserva cai sozinha.
              </p>
              {decidir.isError && <Erro erro={decidir.error} />}
              {recusando ? (
                <>
                  <label className="campo">
                    <span>Motivo (o adotante vai ver)</span>
                    <textarea rows={3} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                  </label>
                  <div className="botoes">
                    <button className="btn perigo" disabled={decidir.isPending} onClick={() => decidir.mutate({ href: s._links.recusar!.href, corpo: { motivo: motivo || undefined } })}>
                      Confirmar recusa
                    </button>
                    <button className="btn contorno" onClick={() => setRecusando(false)}>Voltar</button>
                  </div>
                </>
              ) : (
                <div className="botoes">
                  {s._links.aprovar && (
                    <button className="btn acento" disabled={decidir.isPending} onClick={() => decidir.mutate({ href: s._links.aprovar!.href })}>
                      {decidir.isPending ? "Enviando…" : "Aprovar adoção"}
                    </button>
                  )}
                  {s._links.recusar && (
                    <button className="btn perigo" onClick={() => setRecusando(true)}>Recusar</button>
                  )}
                </div>
              )}
              <small style={{ color: "var(--tinta-3)" }}>As ações vêm dos links HATEOAS da resposta (<code>_links</code>).</small>
            </section>
          )}

          <section className="cartao bloco">
            <h2>Quem pediu</h2>
            {s.adotante ? (
              <>
                <p style={{ margin: 0 }}>
                  <strong style={{ fontFamily: "var(--serif)", fontSize: "1.3rem" }}>{s.adotante.nome}</strong> · {s.adotante.cidade}
                </p>
                {perfil ? (
                  <div className="perfil-adotante">
                    <div><small>Moradia</small>{MORADIAS[perfil.tipoMoradia]}</div>
                    <div><small>Quintal</small>{perfil.temQuintal ? "Sim" : "Não"}</div>
                    <div><small>Outros animais</small>{perfil.outrosAnimais ? "Sim" : "Não"}</div>
                    <div><small>Fora de casa</small>{perfil.horasForaDeCasa ?? "–"} h/dia</div>
                    <div><small>Perfil</small>{perfil.completo ? "Completo" : "Incompleto"}</div>
                  </div>
                ) : (
                  <p style={{ margin: 0, color: "var(--tinta-3)" }}>O adotante ainda não preencheu o perfil de adoção.</p>
                )}
              </>
            ) : (
              <p style={{ margin: 0, color: "var(--tinta-3)" }}>Dados do adotante indisponíveis agora (Identidade não respondeu).</p>
            )}
            {s.motivo && (
              <div className="aviso-faixa">
                <span>
                  {/^[A-Z0-9_]+$/.test(s.motivo) ? (
                    <>
                      <strong>Motivo técnico:</strong> <code>{s.motivo}</code>. A SAGA desfez a reserva sozinha.
                    </>
                  ) : (
                    <>
                      <strong>Motivo:</strong> {s.motivo}
                    </>
                  )}
                </span>
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
