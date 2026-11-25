import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useSessao } from "@c/sessao";
import { Erro, Origem } from "@c/ui";
import { entrar, rotas } from "../api/servicos";
import type { MinhaConta } from "../api/tipos";

export function Entrar() {
  const { conta, entrar: guardar, expirou } = useSessao<MinhaConta>();
  const navegar = useNavigate();
  const de = (useLocation().state as { de?: string } | null)?.de ?? "/";
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const login = useMutation({
    mutationFn: () => entrar(email, senha),
    onSuccess: ({ token, conta }) => {
      guardar(token, conta);
      navegar(de, { replace: true });
    },
  });
  if (conta) return <Navigate to={de} replace />;

  return (
    <div className="entrada-tela">
      <section className="entrada-arte">
        <Link to="/" className="marca" style={{ textDecoration: "none" }}>Ampara.</Link>
        <h1>Adote com <em>calma</em> e com amor.</h1>
      </section>
      <form className="entrada-form surgir" onSubmit={(e: FormEvent) => { e.preventDefault(); login.mutate(); }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: "1.6rem" }}>Entrar</h2>
          <Origem origem={rotas.origem("auth")} />
        </div>
        {expirou && <div className="aviso-faixa">Sua sessão expirou. Entre de novo.</div>}
        {login.isError && <Erro erro={login.error} />}
        <label className="campo"><span>E-mail</span><input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="campo"><span>Senha</span><input type="password" required autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} /></label>
        <button className="btn acento largo" disabled={login.isPending}>{login.isPending ? "Entrando…" : "Entrar"}</button>
        <p style={{ textAlign: "center", margin: 0, fontSize: "0.92rem" }}>Primeira vez? <Link to="/cadastro">Crie sua conta</Link></p>
        <Link to="/" style={{ textAlign: "center", fontSize: "0.9rem", color: "var(--tinta-2)" }}>Só quero olhar os animais →</Link>
        {import.meta.env.DEV && (
          <button type="button" className="chip" style={{ justifySelf: "center" }} onClick={() => { setEmail("adotante@ampara.dev"); setSenha("demo1234"); }}>
            Usar conta de desenvolvimento
          </button>
        )}
      </form>
    </div>
  );
}
