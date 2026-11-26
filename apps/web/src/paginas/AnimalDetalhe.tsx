import { IcEditar, IcVoltar } from "@c/icones";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ESPECIES, PORTES, STATUS_ANIMAL, idade, relativo } from "@c/api";
import { Avisos, Carregando, Erro, LinhaDoTempo, Retrato, SeloEstado, SeloStatus, Vazio } from "@c/ui";
import { alterarStatus, obterAnimal, rotas } from "../api/servicos";
import { Cabecalho } from "../componentes/Layout";

const MANUAIS = ["DISPONIVEL", "EM_TRATAMENTO", "INDISPONIVEL"] as const;

export function AnimalDetalhe() {
  const { id = "" } = useParams();
  const consultas = useQueryClient();
  const q = useQuery({ queryKey: ["animal", id], queryFn: () => obterAnimal(id), refetchInterval: 6_000 });
  const mudar = useMutation({
    mutationFn: (s: (typeof MANUAIS)[number]) => alterarStatus(id, s),
    // a resposta é o resumo do animal: a ficha (com o histórico novo) é buscada de novo
    onSuccess: () => {
      consultas.invalidateQueries({ queryKey: ["animal", id] });
      consultas.invalidateQueries({ queryKey: ["animais"] });
      consultas.invalidateQueries({ queryKey: ["painel"] });
    },
  });

  if (q.isPending) return <Carregando />;
  if (q.isError) return <Erro erro={q.error} onTentar={() => q.refetch()} />;
  const a = q.data;
  const travado = a.status === "RESERVADO" || a.status === "ADOTADO";

  return (
    <>
      <Link to="/animais" className="voltar"><IcVoltar tamanho={18} /> Animais</Link>
      <Cabecalho
        titulo={a.nome}
        sobre={<><SeloStatus status={a.status} /> · atualizado {relativo(a.atualizadoEm)}</>}
        origem={rotas.origem("animais")}
        acoes={<Link className="btn contorno" to={`/animais/${a.id}/editar`}><IcEditar tamanho={18} /> Editar dados</Link>}
      />
      <Avisos avisos={a.avisos} />
      <div className="detalhe">
        <div className="coluna">
          <div className="retrato">
            <Retrato nome={a.nome} especie={a.especie} src={a.fotoCapa} />
          </div>
          <section className="cartao bloco">
            <h2>Histórico de status</h2>
            <LinhaDoTempo
              etapas={a.historicoStatus.map((h) => ({ titulo: STATUS_ANIMAL[h.status]?.rotulo ?? h.status, detalhe: h.por === "SAGA" ? "pela SAGA" : "por você", em: h.em }))}
            />
          </section>
        </div>

        <div className="coluna">
          <section className="cartao bloco">
            <h2>Ficha</h2>
            <dl className="dados">
              <div><dt>Espécie</dt><dd>{ESPECIES[a.especie]}</dd></div>
              <div><dt>Sexo</dt><dd>{a.sexo === "MACHO" ? "Macho" : "Fêmea"}</dd></div>
              <div><dt>Porte</dt><dd>{PORTES[a.porte]}</dd></div>
              <div><dt>Idade</dt><dd>{idade(a.idadeMeses)}</dd></div>
              <div><dt>Onde está</dt><dd>{a.localizacao.bairro}, {a.localizacao.cidade}</dd></div>
              <div style={{ gridColumn: "1 / -1" }}>
                <dt>Endereço do abrigo (só o painel vê)</dt>
                <dd style={{ fontFamily: "var(--texto)", fontSize: "0.95rem", fontWeight: 500 }}>
                  {a.endereco.rua}, {a.endereco.numero}
                  {a.endereco.complemento ? ` · ${a.endereco.complemento}` : ""} · {a.endereco.bairro}, {a.endereco.cidade}/{a.endereco.uf} · {a.endereco.cep}
                </dd>
              </div>
            </dl>
            {a.descricao && <p style={{ margin: 0 }}>{a.descricao}</p>}
            {a.temperamento.length > 0 && (
              <div className="etiquetas">{a.temperamento.map((t) => <span className="etiqueta" key={t}>{t}</span>)}</div>
            )}
          </section>

          <section className="cartao bloco">
            <h2>Status manual</h2>
            {travado ? (
              <p style={{ margin: 0, color: "var(--tinta-2)" }}>
                {a.status === "RESERVADO" ? "Reservado por uma solicitação em andamento: só a SAGA muda o status agora." : "Adotado. A SAGA encerrou o processo."}
              </p>
            ) : (
              <div className="chips">
                {MANUAIS.map((s) => (
                  <button key={s} className="chip" aria-pressed={a.status === s} disabled={mudar.isPending || a.status === s} onClick={() => mudar.mutate(s)}>
                    {STATUS_ANIMAL[s].rotulo}
                  </button>
                ))}
              </div>
            )}
            {mudar.isError && <Erro erro={mudar.error} />}
          </section>

          <section className="cartao bloco">
            <h2>Pedidos deste animal <small>{a.solicitacoes.length}</small></h2>
            {a.solicitacoes.length === 0 && <Vazio titulo="Nenhum pedido ainda" />}
            <div className="lista">
              {a.solicitacoes.map((s) => (
                <Link key={s.id} to={`/solicitacoes/${s.id}`} className="linha-solicitacao" style={{ gridTemplateColumns: "1fr auto" }}>
                  <div>
                    <strong>{s.adotante?.nome ?? "Adotante"}</strong>
                    <small>{relativo(s.criadoEm)}</small>
                  </div>
                  <SeloEstado estado={s.estado} />
                </Link>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
