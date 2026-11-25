import { useAvisoSaida } from "@c/ganchos";
import { IcLocal, IcVoltar } from "@c/icones";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Carregando, Erro } from "@c/ui";
import { cadastrarAnimal, editarAnimal, obterAnimal, rotas } from "../api/servicos";
import type { AnimalEntrada, AnimalPainel, Endereco } from "../api/tipos";
import { Cabecalho } from "../componentes/Layout";

// Endereço da ONG do seed como ponto de partida: a ONG costuma cadastrar vários animais do mesmo abrigo.
const ENDERECO_PADRAO: Endereco = { rua: "Rua Doutor Francisco Sales", numero: "100", complemento: "", bairro: "Centro", cidade: "Lavras", uf: "MG", cep: "37200-000" };

const VAZIO: AnimalEntrada = {
  nome: "",
  especie: "CAO",
  porte: "MEDIO",
  sexo: "FEMEA",
  idadeMeses: 12,
  temperamento: [],
  descricao: "",
  fotos: [],
  localizacao: { lat: -21.2453, lng: -44.9998 },
  endereco: ENDERECO_PADRAO,
};

function daFicha(a: AnimalPainel): AnimalEntrada {
  return {
    nome: a.nome,
    especie: a.especie,
    porte: a.porte,
    sexo: a.sexo,
    idadeMeses: a.idadeMeses,
    temperamento: a.temperamento,
    descricao: a.descricao ?? "",
    fotos: a.fotos,
    localizacao: { lat: a.localizacao.lat, lng: a.localizacao.lng },
    endereco: { ...a.endereco, complemento: a.endereco.complemento ?? "" },
  };
}

// 37200000 → 37200-000, enquanto a pessoa digita
const mascararCep = (v: string) => v.replace(/\D/g, "").slice(0, 8).replace(/^(\d{5})(\d)/, "$1-$2");

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
      const f = daFicha(atual.data);
      setD(f);
      setTemperamento((f.temperamento ?? []).join(", "));
      setFoto(f.fotos.join("\n"));
    }
  }, [atual.data]);

  const original = useMemo(() => (atual.data ? daFicha(atual.data) : VAZIO), [atual.data]);
  const salvo = useState(false);
  useAvisoSaida(!salvo[0] && JSON.stringify(d) !== JSON.stringify(original));

  const salvar = useMutation({
    mutationFn: (dados: AnimalEntrada) => (editando ? editarAnimal(id!, dados) : cadastrarAnimal(dados)),
    onSuccess: (r) => {
      salvo[1](true);
      // a resposta é o resumo; a ficha é buscada de novo na tela do animal
      consultas.invalidateQueries({ queryKey: ["animais"] });
      consultas.invalidateQueries({ queryKey: ["animal", r.id] });
      consultas.invalidateQueries({ queryKey: ["painel"] });
      navegar(`/animais/${r.id}`);
    },
  });

  if (editando && atual.isPending) return <Carregando />;
  if (editando && atual.isError) return <Erro erro={atual.error} onTentar={() => atual.refetch()} />;

  const end = (k: keyof Endereco, v: string) => setD({ ...d, endereco: { ...d.endereco, [k]: v } });
  const coord = (k: "lat" | "lng", v: string) => setD({ ...d, localizacao: { ...d.localizacao, [k]: Number(v) } });

  const usarMinhaLocalizacao = () =>
    navigator.geolocation?.getCurrentPosition((p) =>
      setD((x) => ({ ...x, localizacao: { lat: +p.coords.latitude.toFixed(5), lng: +p.coords.longitude.toFixed(5) } })),
    );

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const fotos = foto.split(/\s+/).filter(Boolean);
    salvar.mutate({
      ...d,
      temperamento: temperamento.split(",").map((t) => t.trim()).filter(Boolean),
      descricao: d.descricao?.trim() || null,
      // o contrato exige ao menos uma foto; sem URL, vai um retrato padrão
      fotos: fotos.length ? fotos : [`https://fotos.ampara.dev/padrao/${d.especie.toLowerCase()}.jpg`],
      endereco: { ...d.endereco, uf: d.endereco.uf.toUpperCase(), complemento: d.endereco.complemento?.trim() || null },
    });
  };

  const voltarPara = editando ? `/animais/${id}` : "/animais";

  return (
    <>
      <Link to={voltarPara} className="voltar"><IcVoltar tamanho={18} /> Voltar</Link>
      <Cabecalho titulo={editando ? <>Editar <em>{d.nome}</em></> : "Cadastrar animal"} sobre="Os dados aparecem na busca dos adotantes em poucos segundos (projeção do CQRS)." origem={rotas.origem("animais")} />
      <form className="cartao formulario" onSubmit={enviar}>
        {salvar.isError && <Erro erro={salvar.error} />}
        <div className="grade-campos">
          <label className="campo" style={{ gridColumn: "1 / -1" }}>
            <span>Nome</span>
            <input name="nome" required maxLength={100} value={d.nome} onChange={(e) => setD({ ...d, nome: e.target.value })} />
          </label>
          <label className="campo">
            <span>Espécie</span>
            <select name="especie" value={d.especie} onChange={(e) => setD({ ...d, especie: e.target.value as AnimalEntrada["especie"] })}>
              <option value="CAO">Cão</option>
              <option value="GATO">Gato</option>
              <option value="OUTRO">Outro</option>
            </select>
          </label>
          <label className="campo">
            <span>Sexo</span>
            <select name="sexo" value={d.sexo} onChange={(e) => setD({ ...d, sexo: e.target.value as AnimalEntrada["sexo"] })}>
              <option value="FEMEA">Fêmea</option>
              <option value="MACHO">Macho</option>
            </select>
          </label>
          <label className="campo">
            <span>Porte</span>
            <select name="porte" value={d.porte} onChange={(e) => setD({ ...d, porte: e.target.value as AnimalEntrada["porte"] })}>
              <option value="PEQUENO">Pequeno</option>
              <option value="MEDIO">Médio</option>
              <option value="GRANDE">Grande</option>
            </select>
          </label>
          <label className="campo">
            <span>Idade (meses)</span>
            <input type="number" inputMode="numeric" name="idadeMeses" min={0} required value={d.idadeMeses} onChange={(e) => setD({ ...d, idadeMeses: Number(e.target.value) })} />
          </label>
        </div>
        <label className="campo">
          <span>Temperamento (separe por vírgula)</span>
          <input name="temperamento" placeholder="Ex.: dócil, brincalhão…" value={temperamento} onChange={(e) => setTemperamento(e.target.value)} />
        </label>
        <label className="campo">
          <span>Descrição (opcional)</span>
          <textarea name="descricao" rows={3} maxLength={2000} placeholder="Ex.: vacinado, castrado, gosta de passear…" value={d.descricao ?? ""} onChange={(e) => setD({ ...d, descricao: e.target.value })} />
        </label>
        <label className="campo">
          <span>Fotos (uma URL por linha)</span>
          <textarea name="fotos" rows={2} placeholder="https://exemplo.com/foto.jpg…" value={foto} onChange={(e) => setFoto(e.target.value)} />
        </label>

        <fieldset>
          <legend>Endereço do abrigo</legend>
          <div className="grade-campos">
            <label className="campo" style={{ gridColumn: "1 / -1" }}><span>Rua</span><input name="rua" required autoComplete="address-line1" value={d.endereco.rua} onChange={(e) => end("rua", e.target.value)} /></label>
            <label className="campo"><span>Número</span><input name="numero" required inputMode="numeric" value={d.endereco.numero} onChange={(e) => end("numero", e.target.value)} /></label>
            <label className="campo"><span>Complemento</span><input name="complemento" autoComplete="address-line2" value={d.endereco.complemento ?? ""} onChange={(e) => end("complemento", e.target.value)} /></label>
            <label className="campo"><span>Bairro</span><input name="bairro" required value={d.endereco.bairro} onChange={(e) => end("bairro", e.target.value)} /></label>
            <label className="campo"><span>Cidade</span><input name="cidade" required autoComplete="address-level2" value={d.endereco.cidade} onChange={(e) => end("cidade", e.target.value)} /></label>
            <label className="campo"><span>UF</span><input name="uf" required minLength={2} maxLength={2} autoComplete="address-level1" style={{ textTransform: "uppercase" }} value={d.endereco.uf} onChange={(e) => end("uf", e.target.value)} /></label>
            <label className="campo"><span>CEP</span><input name="cep" required inputMode="numeric" autoComplete="postal-code" pattern="\d{5}-\d{3}" title="00000-000" placeholder="00000-000" value={d.endereco.cep} onChange={(e) => end("cep", mascararCep(e.target.value))} /></label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Ponto no mapa</legend>
          <div className="grade-campos">
            <label className="campo"><span>Latitude</span><input type="number" inputMode="decimal" name="lat" step="any" min={-90} max={90} required value={d.localizacao.lat} onChange={(e) => coord("lat", e.target.value)} /></label>
            <label className="campo"><span>Longitude</span><input type="number" inputMode="decimal" name="lng" step="any" min={-180} max={180} required value={d.localizacao.lng} onChange={(e) => coord("lng", e.target.value)} /></label>
          </div>
          <button type="button" className="btn contorno pequeno" style={{ justifySelf: "start" }} onClick={usarMinhaLocalizacao}><IcLocal tamanho={18} /> Usar minha localização</button>
          <small style={{ color: "var(--tinta-3)" }}>O adotante só vê o bairro e a distância aproximada, nunca a rua nem o ponto exato.</small>
        </fieldset>

        <div className="acoes">
          <button className="btn acento" disabled={salvar.isPending}>{salvar.isPending ? "Salvando…" : editando ? "Salvar alterações" : "Cadastrar"}</button>
          <Link className="btn contorno" to={voltarPara}>Cancelar</Link>
        </div>
      </form>
    </>
  );
}
