import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PORTES } from "@c/api";
import { Avisos, Carregando, Erro, Origem, Retrato, SeloEstado, Vazio } from "@c/ui";
import { buscar, rotas } from "../api/servicos";
import type { Especie, Porte } from "../api/tipos";

// Sem permissão de localização, a busca parte do centro de Lavras (onde está o seed).
const LAVRAS = { lat: -21.2453, lng: -44.9998 };

export function Busca() {
  const [ponto, setPonto] = useState(LAVRAS);
  const [onde, setOnde] = useState<"padrao" | "buscando" | "gps">("padrao");
  const [raioKm, setRaioKm] = useState(10);
  const [raioAplicado, setRaioAplicado] = useState(10);
  const [especie, setEspecie] = useState<Especie | undefined>();
  const [porte, setPorte] = useState<Porte | undefined>();

  useEffect(() => {
    const t = setTimeout(() => setRaioAplicado(raioKm), 350);
    return () => clearTimeout(t);
  }, [raioKm]);

  const usarGps = () => {
    if (!navigator.geolocation) return;
    setOnde("buscando");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPonto({ lat: +p.coords.latitude.toFixed(4), lng: +p.coords.longitude.toFixed(4) });
        setOnde("gps");
      },
      () => setOnde("padrao"),
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
          <span>📍 {onde === "gps" ? "Perto de você" : "Lavras, MG"}</span>
          <button onClick={usarGps} disabled={onde === "buscando"}>{onde === "buscando" ? "Localizando…" : "Usar minha localização"}</button>
        </div>
        <h1>
          Quem está esperando por <em>você</em>?
        </h1>
        <label className="raio">
          <span>Até {raioKm} km daqui</span>
          <input type="range" min={1} max={100} value={raioKm} onChange={(e) => setRaioKm(Number(e.target.value))} />
        </label>
      </section>

      <div className="filtros" role="group" aria-label="Filtros">
        {([undefined, "CAO", "GATO"] as const).map((e) => (
          <button key={e ?? "todos"} className="chip" aria-pressed={especie === e} onClick={() => setEspecie(e)}>
            {e === "CAO" ? "🐕 Cães" : e === "GATO" ? "🐈 Gatos" : "Todos"}
          </button>
        ))}
        {(["PEQUENO", "MEDIO", "GRANDE"] as const).map((p) => (
          <button key={p} className="chip" aria-pressed={porte === p} onClick={() => setPorte(porte === p ? undefined : p)}>
            {PORTES[p]}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <small style={{ color: "var(--tinta-3)" }}>{q.isSuccess ? `${itens.length} ${itens.length === 1 ? "animal" : "animais"} no raio` : " "}</small>
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
