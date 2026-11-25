import { useAvisoSaida } from "@c/ganchos";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useSessao } from "@c/sessao";
import { Carregando, Erro, Origem, Selo } from "@c/ui";
import { eu, perfilAdocao, rotas, salvarPerfil } from "../api/servicos";
import type { MinhaConta, PerfilAdocao } from "../api/tipos";
import { Topo } from "../componentes/Casca";

type Form = Omit<PerfilAdocao, "completo">;

export function Perfil() {
  const { conta, sair } = useSessao<MinhaConta>();
  const navegar = useNavigate();
  const consultas = useQueryClient();
  const minha = useQuery({ queryKey: ["eu"], queryFn: () => eu(conta) });
  const perfil = useQuery({ queryKey: ["perfil"], queryFn: perfilAdocao });
  const [f, setF] = useState<Form>({ tipoMoradia: undefined, temQuintal: false, outrosAnimais: false, horasForaDeCasa: 0, aceiteTermo: false });
  const [salvo, setSalvo] = useState(false);

  useEffect(() => {
    if (perfil.data) {
      const { completo: _c, ...resto } = perfil.data;
      setF((x) => ({ ...x, ...resto }));
    }
  }, [perfil.data]);

  const sujo = !!perfil.data && (() => {
    const { completo: _c, ...salvoAgora } = perfil.data;
    return (Object.keys(f) as (keyof Form)[]).some((k) => (f[k] ?? null) !== (salvoAgora[k] ?? null));
  })();
  useAvisoSaida(sujo);

  const salvar = useMutation({
    mutationFn: () => salvarPerfil(f),
    onSuccess: (p) => {
      consultas.setQueryData(["perfil"], p);
      setSalvo(true);
      setTimeout(() => setSalvo(false), 2500);
    },
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    salvar.mutate();
  };

  return (
    <>
      <Topo titulo={<>Olá, <em>{(minha.data ?? conta)?.nome.split(" ")[0]}</em></>} sobre={(minha.data ?? conta)?.email} direita={<Origem origem={rotas.origem("conta")} />} />

      <form className="cartao" style={{ padding: "1.2rem", display: "grid", gap: "1rem" }} onSubmit={enviar}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: "1.3rem" }}>Perfil de adoção</h2>
          {perfil.data && <Selo tom={perfil.data.completo ? "ok" : "atencao"}>{perfil.data.completo ? "Completo" : "Incompleto"}</Selo>}
        </div>
        <p style={{ margin: 0, color: "var(--tinta-2)", fontSize: "0.9rem" }}>A SAGA confere este perfil antes de levar o pedido à ONG. Sem ele, o pedido para e a reserva é desfeita.</p>
        {perfil.isPending && <Carregando />}
        {perfil.isError && <Erro erro={perfil.error} onTentar={() => perfil.refetch()} />}
        {salvar.isError && <Erro erro={salvar.error} />}
        <label className="campo">
          <span>Onde você mora</span>
          <select required value={f.tipoMoradia ?? ""} onChange={(e) => setF({ ...f, tipoMoradia: (e.target.value || undefined) as Form["tipoMoradia"] })}>
            <option value="">Escolha…</option>
            <option value="CASA">Casa</option>
            <option value="APARTAMENTO">Apartamento</option>
            <option value="SITIO">Sítio ou chácara</option>
          </select>
        </label>
        <label className="campo">
          <span>Horas fora de casa por dia: {f.horasForaDeCasa ?? 0} h</span>
          <input type="range" min={0} max={24} aria-valuetext={`${f.horasForaDeCasa ?? 0} horas`} value={f.horasForaDeCasa ?? 0} onChange={(e) => setF({ ...f, horasForaDeCasa: Number(e.target.value) })} style={{ accentColor: "var(--terracota)", padding: 0, border: 0, background: "none" }} />
        </label>
        <label className="check"><input type="checkbox" checked={!!f.temQuintal} onChange={(e) => setF({ ...f, temQuintal: e.target.checked })} /> Tenho quintal ou área externa</label>
        <label className="check"><input type="checkbox" checked={!!f.outrosAnimais} onChange={(e) => setF({ ...f, outrosAnimais: e.target.checked })} /> Já tenho outros animais</label>
        <label className="check"><input type="checkbox" checked={!!f.aceiteTermo} onChange={(e) => setF({ ...f, aceiteTermo: e.target.checked })} /> Li e aceito o termo de adoção responsável</label>
        <button className="btn acento largo" disabled={salvar.isPending}>{salvar.isPending ? "Salvando…" : salvo ? "Perfil salvo" : "Salvar perfil"}</button>
        <span className="sr-only" role="status">{salvo ? "Perfil de adoção salvo." : ""}</span>
      </form>

      <button
        className="btn contorno largo"
        onClick={() => {
          sair();
          consultas.clear();
          navegar("/");
        }}
      >
        Sair da conta
      </button>
    </>
  );
}
