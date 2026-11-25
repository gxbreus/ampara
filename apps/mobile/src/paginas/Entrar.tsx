import { useTituloPagina } from "@c/ganchos";
import { IcSeta } from "@c/icones";
import { Logo } from "@c/marca";
import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useSessao } from "@c/sessao";
import { Erro, Origem } from "@c/ui";
import { entrar, rotas } from "../api/servicos";
import type { MinhaConta } from "../api/tipos";

// Com o login simulado (VITE_AUTH_REAL=false) qualquer senha serve; com a Identidade real,
// a conta do seed usa a SEED_SENHA_DEMO do .env.
const LOGIN_SIMULADO = import.meta.env.VITE_LOGIN_SIMULADO === true;

export function Entrar() {
  useTituloPagina("Entrar", "Ampara");
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
        <Link to="/" aria-label="Ampara, início" style={{ textDecoration: "none" }}><Logo tamanho={34} arco="var(--tinta)" pata="var(--laranja)" /></Link>
        <h1>Adote com <em>calma</em> e com amor.</h1>
      </section>
      <form className="entrada-form surgir" onSubmit={(e: FormEvent) => { e.preventDefault(); login.mutate(); }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: "1.6rem" }}>Entrar</h2>
          <Origem origem={rotas.origem("auth")} />
        </div>
        {expirou && <div className="aviso-faixa">Sua sessão expirou. Entre de novo.</div>}
        {login.isError && <Erro erro={login.error} />}
        <label className="campo"><span>E-mail</span><input type="email" required name="email" autoComplete="username" spellCheck={false} autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="campo"><span>Senha</span><input type="password" required name="senha" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} /></label>
        <button className="btn acento largo" disabled={login.isPending}>{login.isPending ? "Entrando…" : "Entrar"}</button>
        <p style={{ textAlign: "center", margin: 0, fontSize: "0.92rem" }}>Primeira vez? <Link to="/cadastro">Crie sua conta</Link></p>
        <Link to="/" className="link-discreto">Só quero olhar os animais <IcSeta tamanho={17} /></Link>
        {import.meta.env.DEV && (
          <>
            <button type="button" className="chip" style={{ justifySelf: "center" }} onClick={() => { setEmail("adotante@ampara.dev"); setSenha(LOGIN_SIMULADO ? "demo1234" : ""); }}>
              {LOGIN_SIMULADO ? "Usar conta de desenvolvimento" : "Usar conta do seed"}
            </button>
            {!LOGIN_SIMULADO && <small style={{ textAlign: "center" }}>A senha é a SEED_SENHA_DEMO do .env.</small>}
          </>
        )}
      </form>
    </div>
  );
}
