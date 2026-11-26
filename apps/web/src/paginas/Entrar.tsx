import { useTituloPagina } from "@c/ganchos";
import { Logo } from "@c/marca";
import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Erro } from "@c/ui";
import { useSessao } from "@c/sessao";
import { entrar, rotas } from "../api/servicos";
import type { MinhaConta } from "../api/tipos";

// Contas do seed e do login simulado (apps/compartilhado/dev-auth.ts), com os mesmos e-mails.
// Com o login simulado qualquer senha serve; com a Identidade real, a senha é a SEED_SENHA_DEMO.
const LOGIN_SIMULADO = import.meta.env.VITE_LOGIN_SIMULADO === true;
const CONTAS_DEV = [
  ["ong@ampara.dev", "ONG"],
  ["protetor@ampara.dev", "Protetor"],
  ["admin@ampara.dev", "Admin"],
] as const;

export function Entrar() {
  useTituloPagina("Entrar", "Ampara · Painel");
  const { conta, entrar: guardar, expirou } = useSessao<MinhaConta>();
  const navegar = useNavigate();
  const de = (useLocation().state as { de?: string } | null)?.de ?? "/";
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erroPapel, setErroPapel] = useState(false);

  const login = useMutation({
    mutationFn: () => entrar(email, senha),
    onSuccess: ({ token, conta }) => {
      if (conta.role === "ADOTANTE") {
        setErroPapel(true);
        return;
      }
      guardar(token, conta);
      navegar(de, { replace: true });
    },
  });

  if (conta) return <Navigate to={de} replace />;

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    setErroPapel(false);
    login.mutate();
  };

  return (
    <div className="portal">
      <section className="portal-arte">
        <Logo tamanho={40} arco="var(--tinta)" pata="var(--laranja)" />
        <div>
          <h1>
            Cada resgate merece um <em>lar</em> de verdade.
          </h1>
          <p>O painel onde ONGs e protetores cadastram os animais, acompanham cada pedido de adoção e decidem com calma, vendo o perfil de quem pediu.</p>
        </div>
        <small className="portal-rodape">Sistemas Distribuídos · 2026</small>
      </section>

      <section className="portal-form">
        <form onSubmit={enviar} className="surgir">
          <div>
            <h2>Entrar no painel</h2>
            <p className="sub">
              Para ONGs, protetores e administração. <span className={`origem ${rotas.origem("auth")}`}>{rotas.origem("auth")}</span>
            </p>
          </div>
          {expirou && <div className="aviso-faixa">Sua sessão expirou. Entre de novo.</div>}
          {login.isError && <Erro erro={login.error} />}
          {erroPapel && <div className="aviso-faixa erro">Esta conta é de adotante. Use o app do adotante (porta 5174).</div>}
          <label className="campo">
            <span>E-mail</span>
            <input type="email" required name="email" autoComplete="username" spellCheck={false} autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="campo">
            <span>Senha</span>
            <input type="password" required name="senha" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
          </label>
          <button className="btn acento largo" disabled={login.isPending}>
            {login.isPending ? "Entrando…" : "Entrar"}
          </button>
          <p style={{ textAlign: "center", margin: 0, fontSize: "0.92rem" }}>
            Ainda não tem conta? <Link to="/cadastro">Cadastre sua ONG</Link>
          </p>
          {import.meta.env.DEV && (
            <div className="contas-dev">
              <span>
                {LOGIN_SIMULADO
                  ? "Contas de desenvolvimento (qualquer senha):"
                  : "Contas do seed (senha: SEED_SENHA_DEMO do .env):"}
              </span>
              <div>
                {CONTAS_DEV.map(([e, rotulo]) => (
                  <button key={e} type="button" className="chip" onClick={() => { setEmail(e); setSenha(LOGIN_SIMULADO ? "demo1234" : ""); }}>
                    {rotulo}
                  </button>
                ))}
              </div>
            </div>
          )}
        </form>
      </section>
    </div>
  );
}
