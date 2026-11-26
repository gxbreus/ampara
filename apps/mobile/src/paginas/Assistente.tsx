import { IcAlerta, IcEnviar, IcFonte } from "@c/icones";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Erro, Origem, Retrato } from "@c/ui";
import { perguntar, recomendar, rotas } from "../api/servicos";
import type { RespostaPergunta } from "../api/tipos";
import { Topo } from "../componentes/Casca";

type Mensagem = { de: "eu"; texto: string } | { de: "ia"; resposta: RespostaPergunta };

const SUGESTOES = ["Quais os primeiros cuidados com um filhote?", "Dá para ter cachorro em apartamento?", "Quando castrar?"];

function Duvidas() {
  const [texto, setTexto] = useState("");
  const [conversa, setConversa] = useState<Mensagem[]>([]);
  const fim = useRef<HTMLDivElement>(null);
  const pergunta = useMutation({
    mutationFn: perguntar,
    onSuccess: (resposta) => setConversa((c) => [...c, { de: "ia", resposta }]),
  });

  useEffect(() => {
    // em navegadores novos scrollIntoView devolve uma Promise; não pode virar o "cleanup" do efeito
    void fim.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversa, pergunta.isPending]);

  const enviar = (p: string) => {
    if (p.trim().length < 3) return;
    setConversa((c) => [...c, { de: "eu", texto: p }]);
    setTexto("");
    pergunta.mutate(p);
  };

  return (
    <>
      {conversa.length === 0 && (
        <div className="sugestoes">
          {SUGESTOES.map((s) => <button key={s} className="chip" onClick={() => enviar(s)}>{s}</button>)}
        </div>
      )}
      <div className="conversa">
        {conversa.map((m, i) =>
          m.de === "eu" ? (
            <div key={i} className="balao eu">{m.texto}</div>
          ) : (
            <div key={i} className={`balao ia ${m.resposta.degradado ? "degradado" : ""}`}>
              {m.resposta.degradado && <strong style={{ display: "flex", gap: "0.3rem", alignItems: "center", marginBottom: "0.3rem" }}><IcAlerta tamanho={17} /> Resposta de contingência</strong>}
              {m.resposta.resposta}
              {!!m.resposta.fontes?.length && (
                <div className="fontes">
                  <b>Fontes</b>
                  {m.resposta.fontes.map((f) => <span key={f.titulo + f.paginaOuSecao}><IcFonte tamanho={15} /> {f.titulo} · {f.paginaOuSecao}</span>)}
                </div>
              )}
            </div>
          ),
        )}
        {pergunta.isPending && <div className="balao ia digitando" aria-label="O assistente está escrevendo"><span /><span /><span /></div>}
        {pergunta.isError && <Erro erro={pergunta.error} />}
        <div ref={fim} />
      </div>
      <form className="compositor" onSubmit={(e: FormEvent) => { e.preventDefault(); enviar(texto); }}>
        <label className="campo" style={{ flex: 1 }}>
          <span className="sr-only">Sua dúvida</span>
          <textarea rows={2} maxLength={500} placeholder="Ex.: quando vacinar um filhote…" value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (!pergunta.isPending) enviar(texto); } }} enterKeyHint="send" />
        </label>
        <button className="btn acento" aria-label="Enviar pergunta" disabled={pergunta.isPending || texto.trim().length < 3}><IcEnviar /></button>
      </form>
    </>
  );
}

function Recomendacoes() {
  const [rotina, setRotina] = useState("");
  // Recomenda perto do último ponto de busca (ou do centro de Lavras, se ainda não buscou).
  const rec = useMutation({ mutationFn: (r: string) => recomendar(r) });
  return (
    <>
      <form style={{ display: "grid", gap: "0.7rem" }} onSubmit={(e) => { e.preventDefault(); rec.mutate(rotina); }}>
        <label className="campo">
          <span>Conte sobre sua rotina</span>
          <textarea rows={4} minLength={10} maxLength={1000} required placeholder="Ex.: moro em apartamento, trabalho 6 h fora e gosto de caminhar no parque…" value={rotina} onChange={(e) => setRotina(e.target.value)} />
        </label>
        <button className="btn acento largo" disabled={rec.isPending || rotina.trim().length < 10}>{rec.isPending ? "Procurando quem combina com você…" : "Recomendar animais"}</button>
      </form>
      {rec.isError && <Erro erro={rec.error} />}
      {rec.data && (
        <section style={{ display: "grid", gap: "0.7rem" }} className="surgir">
          <div className={`balao ia ${rec.data.degradado ? "degradado" : ""}`} style={{ maxWidth: "100%" }}>{rec.data.explicacao}</div>
          {rec.data.animais.length === 0 && <p style={{ textAlign: "center", color: "var(--tinta-3)" }}>Nenhum animal disponível combina agora.</p>}
          {rec.data.animais.map((a, i) => (
            <Link key={a.animalId} to={`/animais/${a.animalId}`} className="cartao pedido" style={{ animationDelay: `${i * 0.08}s` }}>
              <Retrato className="foto" nome={a.nome} src={a.fotoThumb} />
              <div>
                <strong>{a.nome}</strong>
                <small>{a.motivoRecomendacao}</small>
              </div>
            </Link>
          ))}
        </section>
      )}
    </>
  );
}

export function Assistente() {
  const [aba, setAba] = useState<"duvidas" | "recomendacoes">("duvidas");
  return (
    <>
      <Topo titulo={<>Assistente <em>Ampara</em></>} sobre="Respostas com base em guias de posse responsável, sempre com as fontes." direita={<Origem origem={rotas.origem("assistente")} />} />
      <div className="abas-internas" role="group">
        <button aria-pressed={aba === "duvidas"} onClick={() => setAba("duvidas")}>Tirar dúvidas</button>
        <button aria-pressed={aba === "recomendacoes"} onClick={() => setAba("recomendacoes")}>Quem combina comigo</button>
      </div>
      {aba === "duvidas" ? <Duvidas /> : <Recomendacoes />}
    </>
  );
}
