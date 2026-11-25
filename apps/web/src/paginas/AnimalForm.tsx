import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Carregando, Erro } from "@c/ui";
import { cadastrarAnimal, editarAnimal, obterAnimal, rotas } from "../api/servicos";
import type { AnimalEntrada } from "../api/tipos";
import { Cabecalho } from "../componentes/Layout";

const VAZIO: AnimalEntrada = {
  nome: "",
  especie: "CAO",
  porte: "MEDIO",
  idadeMeses: 12,
  temperamento: [],
  fotos: [],
  localizacao: { lat: -21.2453, lng: -44.9998, bairro: "Centro", cidade: "Lavras" },
};

export function AnimalForm() {
  const { id } = useParams();
  const editando = !!id;
  const navegar = useNavigate();
  const consultas = useQueryClient();
  const atual = useQuery({ queryKey: ["animal", id], queryFn: () => obterAnimal(id!), enabled: editando });
  const [d, setD] = useState<AnimalEntrada>(VAZIO);
  const [temperamento, setTemperamento] = useState("");
  const [foto, setFoto] = useState("");

  useEffect(() => {
    if (atual.data) {
      const { nome, especie, porte, idadeMeses, temperamento: t, fotos, localizacao } = atual.data;
      setD({ nome, especie, porte, idadeMeses, temperamento: t, fotos, localizacao });
      setTemperamento(t.join(", "));
      setFoto(fotos.join("\n"));
    }
  }, [atual.data]);

  const salvar = useMutation({
    mutationFn: (dados: AnimalEntrada) => (editando ? editarAnimal(id!, dados) : cadastrarAnimal(dados)),
    onSuccess: (a) => {
      consultas.invalidateQueries({ queryKey: ["animais"] });
      consultas.invalidateQueries({ queryKey: ["painel"] });
      consultas.setQueryData(["animal", a.id], a);
      navegar(`/animais/${a.id}`);
    },
  });

  if (editando && atual.isPending) return <Carregando />;

  const loc = (k: keyof AnimalEntrada["localizacao"], v: string) =>
    setD({ ...d, localizacao: { ...d.localizacao, [k]: k === "lat" || k === "lng" ? Number(v) : v } });

  const usarMinhaLocalizacao = () =>
    navigator.geolocation?.getCurrentPosition((p) => setD((x) => ({ ...x, localizacao: { ...x.localizacao, lat: +p.coords.latitude.toFixed(5), lng: +p.coords.longitude.toFixed(5) } })));

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const fotos = foto.split(/\s+/).filter(Boolean);
    salvar.mutate({
      ...d,
      temperamento: temperamento.split(",").map((t) => t.trim()).filter(Boolean),
      // o contrato exige ao menos uma foto; sem URL, vai um retrato padrão
      fotos: fotos.length ? fotos : [`https://fotos.ampara.dev/padrao/${d.especie.toLowerCase()}.jpg`],
    });
  };

  return (
    <>
      <Link to={editando ? `/animais/${id}` : "/animais"} className="voltar">← Voltar</Link>
      <Cabecalho titulo={editando ? <>Editar <em>{d.nome}</em></> : "Cadastrar animal"} sobre="Os dados aparecem na busca dos adotantes em poucos segundos (projeção do CQRS)." origem={rotas.origem("animais")} />
      <form className="cartao formulario" onSubmit={enviar}>
        {salvar.isError && <Erro erro={salvar.error} />}
        <div className="grade-campos">
          <label className="campo" style={{ gridColumn: "1 / -1" }}>
            <span>Nome</span>
            <input required value={d.nome} onChange={(e) => setD({ ...d, nome: e.target.value })} />
          </label>
          <label className="campo">
            <span>Espécie</span>
            <select value={d.especie} onChange={(e) => setD({ ...d, especie: e.target.value as AnimalEntrada["especie"] })}>
              <option value="CAO">Cão</option>
              <option value="GATO">Gato</option>
              <option value="OUTRO">Outro</option>
            </select>
          </label>
          <label className="campo">
            <span>Porte</span>
            <select value={d.porte} onChange={(e) => setD({ ...d, porte: e.target.value as AnimalEntrada["porte"] })}>
              <option value="PEQUENO">Pequeno</option>
              <option value="MEDIO">Médio</option>
              <option value="GRANDE">Grande</option>
            </select>
          </label>
          <label className="campo">
            <span>Idade (meses)</span>
            <input type="number" min={0} required value={d.idadeMeses} onChange={(e) => setD({ ...d, idadeMeses: Number(e.target.value) })} />
          </label>
        </div>
        <label className="campo">
          <span>Temperamento (separe por vírgula)</span>
          <input placeholder="dócil, brincalhão" value={temperamento} onChange={(e) => setTemperamento(e.target.value)} />
        </label>
        <label className="campo">
          <span>Fotos (uma URL por linha)</span>
          <textarea rows={2} placeholder="https://…" value={foto} onChange={(e) => setFoto(e.target.value)} />
        </label>
        <fieldset>
          <legend>Onde o animal está</legend>
          <div className="grade-campos">
            <label className="campo"><span>Bairro</span><input required value={d.localizacao.bairro} onChange={(e) => loc("bairro", e.target.value)} /></label>
            <label className="campo"><span>Cidade</span><input required value={d.localizacao.cidade} onChange={(e) => loc("cidade", e.target.value)} /></label>
            <label className="campo"><span>Latitude</span><input type="number" step="any" min={-90} max={90} required value={d.localizacao.lat} onChange={(e) => loc("lat", e.target.value)} /></label>
            <label className="campo"><span>Longitude</span><input type="number" step="any" min={-180} max={180} required value={d.localizacao.lng} onChange={(e) => loc("lng", e.target.value)} /></label>
          </div>
          <button type="button" className="btn contorno pequeno" style={{ justifySelf: "start" }} onClick={usarMinhaLocalizacao}>⌖ Usar minha localização</button>
          <small style={{ color: "var(--tinta-3)" }}>O adotante só vê o bairro e a distância aproximada, nunca o ponto exato.</small>
        </fieldset>
        <div className="acoes">
          <button className="btn acento" disabled={salvar.isPending}>{salvar.isPending ? "Salvando…" : editando ? "Salvar alterações" : "Cadastrar"}</button>
          <Link className="btn contorno" to={editando ? `/animais/${id}` : "/animais"}>Cancelar</Link>
        </div>
      </form>
    </>
  );
}
