import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ESPECIES, PORTES, idade, novoUuid, relativo } from "@c/api";
import { useSessao } from "@c/sessao";
import { Avisos, Carregando, Erro, Origem, Retrato, SeloEstado, SeloStatus } from "@c/ui";
import { obterAnimal, perfilAdocao, rotas, solicitar } from "../api/servicos";
import type { MinhaConta } from "../api/tipos";

export function AnimalDetalhe() {
  const { id = "" } = useParams();
  const { conta } = useSessao<MinhaConta>();
  const navegar = useNavigate();
  const consultas = useQueryClient();
  // a mesma chave em toda tentativa deste toque: se a rede cair e o app reenviar, a Adoção não duplica
  const chave = useRef(novoUuid());

  const q = useQuery({ queryKey: ["animal", id], queryFn: () => obterAnimal(id) });
  const perfil = useQuery({ queryKey: ["perfil"], queryFn: perfilAdocao, enabled: !!conta });
  const pedir = useMutation({
    mutationFn: () => solicitar(id, chave.current),
    onSuccess: (s) => {
      consultas.invalidateQueries({ queryKey: ["busca"] });
      consultas.invalidateQueries({ queryKey: ["pedidos"] });
      navegar(`/pedidos/${s.id}`);
    },
  });

  if (q.isPending) return <Carregando />;
  if (q.isError) return <Erro erro={q.error} onTentar={() => q.refetch()} />;
  const a = q.data;
  const sexo = a.sexo === "FEMEA" ? "Fêmea" : "Macho";

  return (
    <>
      <div className="ficha-foto">
        <Retrato nome={a.nome} especie={a.especie} src={a.fotos[0] ?? a.fotoThumb} />
        <button className="voltar-btn" onClick={() => history.back()} aria-label="Voltar">←</button>
      </div>
      <section className="cartao ficha-corpo surgir">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
          <div>
            <h1>{a.nome}</h1>
            <small style={{ color: "var(--tinta-3)" }}>
              {a.bairro ? `${a.bairro}, ` : ""}
              {a.cidade} · atualizado {relativo(a.atualizadoEm)}
            </small>
          </div>
          <Origem origem={rotas.origem("detalhe")} />
        </div>
        <Avisos avisos={a.avisos} />
        <div className="atributos">
          <div><small>{ESPECIES[a.especie]}</small><b>{sexo}</b></div>
          <div><small>Porte</small><b>{PORTES[a.porte]}</b></div>
          <div><small>Idade</small><b>{idade(a.idadeMeses)}</b></div>
        </div>
        {!!a.temperamento?.length && <div className="etiquetas">{a.temperamento.map((t) => <span key={t} className="etiqueta">{t}</span>)}</div>}
        {a.descricao && <p style={{ margin: 0 }}>{a.descricao}</p>}
        <div className="responsavel">
          <div className="avatar">{a.responsavel.nome.charAt(0)}</div>
          <div style={{ flex: 1 }}>
            <strong>{a.responsavel.nome}</strong>
            <br />
            <small style={{ color: "var(--tinta-3)" }}>{a.responsavel.verificado ? "✓ responsável verificado" : "responsável em verificação"}</small>
          </div>
        </div>
        {a.status !== "DISPONIVEL" && !a.minhaSolicitacao && <SeloStatus status={a.status} />}
      </section>

      <div className="acao-fixa">
        {pedir.isError && <Erro erro={pedir.error} />}
        {a.minhaSolicitacao ? (
          <Link className="btn largo" to={`/pedidos/${a.minhaSolicitacao.id}`}>
            Acompanhar meu pedido · <SeloEstado estado={a.minhaSolicitacao.estado} />
          </Link>
        ) : !conta ? (
          <Link className="btn acento largo" to="/entrar" state={{ de: `/animais/${a.id}` }}>Entrar para adotar {a.nome}</Link>
        ) : perfil.data && !perfil.data.completo ? (
          <Link className="btn contorno largo" to="/perfil">Complete seu perfil de adoção para pedir</Link>
        ) : (
          <button className="btn acento largo" disabled={pedir.isPending || a.status !== "DISPONIVEL"} onClick={() => pedir.mutate()}>
            {pedir.isPending ? "Enviando pedido…" : `Quero adotar ${a.nome}`}
          </button>
        )}
      </div>
    </>
  );
}
