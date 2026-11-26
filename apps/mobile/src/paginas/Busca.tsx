import { IcLocal } from "@c/icones";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PORTES } from "@c/api";
import { Avisos, Carregando, Erro, Origem, Retrato, SeloEstado, Vazio } from "@c/ui";
import { buscar, LAVRAS, rotas } from "../api/servicos";
import type { Especie, Porte } from "../api/tipos";

// Sem permissão de localização, a busca parte do centro de Lavras (onde está o seed).
// Cada busca guarda o ponto usado; a recomendação do assistente parte dele.

export function Busca() {
  const [ponto, setPonto] = useState(LAVRAS);
  const [onde, setOnde] = useState<"padrao" | "buscando" | "gps" | "negado">("padrao");
  // filtros na URL: o link da busca pode ser compartilhado e o "voltar" da ficha mantém a busca
  const [params, setParams] = useSearchParams();
  const especie = (params.get("especie") as Especie | null) ?? undefined;
  const porte = (params.get("porte") as Porte | null) ?? undefined;
  const raioAplicado = Math.min(100, Math.max(1, Number(params.get("raio")) || 10));
  const [raioKm, setRaioKm] = useState(raioAplicado);
  const filtro = (chave: string, valor?: string) =>
    setParams(
      (atual) => {
        const novo = new URLSearchParams(atual);
        if (valor) novo.set(chave, valor);
        else novo.delete(chave);
        return novo;
      },
      { replace: true },
    );
  const setEspecie = (e?: Especie) => filtro("especie", e);
  const setPorte = (p?: Porte) => filtro("porte", p);

  // o raio só vai para a URL (e dispara a busca) quando o dedo para de arrastar
  useEffect(() => {
    if (raioKm === raioAplicado) return;
    const t = setTimeout(() => filtro("raio", raioKm === 10 ? undefined : String(raioKm)), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raioKm]);

  const usarGps = () => {
    if (!navigator.geolocation) return;
    setOnde("buscando");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPonto({ lat: +p.coords.latitude.toFixed(4), lng: +p.coords.longitude.toFixed(4) });
        setOnde("gps");
      },
      () => setOnde("negado"),
      { timeout: 8000 },
    );
  };

  const q = useInfiniteQuery({
    queryKey: ["busca", ponto, raioAplicado, especie, porte],
    queryFn: ({ pageParam }) => buscar({ ...ponto, raioKm: raioAplicado, especie, porte, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.proximoCursor ?? undefined,
  });
  const itens = q.data?.pages.flatMap((p) => p.itens) ?? [];

  return (
    <>
      <section className="hero surgir">
        <div className="onde">
          <span><IcLocal tamanho={17} /> {onde === "gps" ? "Perto de você" : "Lavras, MG"}</span>
          <button onClick={usarGps} disabled={onde === "buscando"}>{onde === "buscando" ? "Localizando…" : "Usar minha localização"}</button>
        </div>
        <h1>
          Quem está esperando por <em>você</em>?
        </h1>
        {onde === "negado" && (
          <small role="status" style={{ fontWeight: 600 }}>
            Sem acesso à localização. Mostrando animais perto do centro de Lavras; libere a localização no navegador para ver os mais próximos de você.
          </small>
        )}
        <label className="raio">
          <span>Até {raioKm} km daqui</span>
          <input type="range" min={1} max={100} value={raioKm} aria-valuetext={`${raioKm} quilômetros`} onChange={(e) => setRaioKm(Number(e.target.value))} />
        </label>
      </section>

      {/* dois grupos que cabem inteiros na tela: nada de linha rolando de lado com chip cortado */}
      <div className="filtros-bloco">
        <div className="segmentado" role="group" aria-label="Espécie">
          {([undefined, "CAO", "GATO"] as const).map((e) => (
            <button key={e ?? "todos"} aria-pressed={especie === e} onClick={() => setEspecie(e)}>
              {e === "CAO" ? "Cães" : e === "GATO" ? "Gatos" : "Todos"}
            </button>
          ))}
        </div>
        <div className="porte" role="group" aria-label="Porte">
          <span>Porte</span>
          {([undefined, "PEQUENO", "MEDIO", "GRANDE"] as const).map((p) => (
            <button key={p ?? "qualquer"} className="chip" aria-pressed={porte === p} onClick={() => setPorte(p)}>
              {p ? PORTES[p] : "Qualquer"}
            </button>
          ))}
        </div>
      </div>

      <div className="contador-busca" aria-live="polite">
        <span>{q.isSuccess ? `${itens.length} ${itens.length === 1 ? "animal" : "animais"} até ${raioAplicado} km` : " "}</span>
        <Origem origem={rotas.origem("busca")} />
      </div>

      {q.isPending && <Carregando texto="Procurando animais perto…" />}
      {q.isError && <Erro erro={q.error} onTentar={() => q.refetch()} />}
      {q.data && <Avisos avisos={q.data.pages[0]?.avisos} />}
      {q.isSuccess && itens.length === 0 && (
        <Vazio titulo="Ninguém por perto ainda">Aumente o raio ou tire algum filtro. Se o backend acabou de subir, rode o seed (scripts/seed.sh).</Vazio>
      )}

      <div className="feed">
        {itens.map((a, i) => (
          <Link key={a.id} to={`/animais/${a.id}`} className="cartao bicho" style={{ animationDelay: `${Math.min(i, 10) * 0.05}s` }}>
            <Retrato nome={a.nome} especie={a.especie} src={a.fotoThumb} />
            <span className="distancia">{a.distanciaKm.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km</span>
            {a.minhaSolicitacao && (
              <span className="meu-pedido">
                <SeloEstado estado={a.minhaSolicitacao.estado} />
              </span>
            )}
            <div className="info">
              <h3>{a.nome}</h3>
              <small>
                {PORTES[a.porte]} · {a.cidade}
              </small>
            </div>
          </Link>
        ))}
      </div>
      {q.hasNextPage && (
        <button className="btn contorno" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
          {q.isFetchingNextPage ? "Carregando…" : "Ver mais"}
        </button>
      )}
    </>
  );
}
