import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Erro } from "@c/ui";
import { cadastrar } from "../api/servicos";

export function Cadastro() {
  const [d, setD] = useState({ nome: "", email: "", senha: "", cidade: "" });
  const criar = useMutation({ mutationFn: () => cadastrar(d) });
  const campo = (k: keyof typeof d) => ({ value: d[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setD({ ...d, [k]: e.target.value }) });

  return (
    <div className="entrada-tela">
      <section className="entrada-arte">
        <Link to="/" className="marca" style={{ textDecoration: "none" }}>Ampara.</Link>
        <h1>Sua próxima <em>companhia</em> está perto.</h1>
      </section>
      {criar.isSuccess ? (
        <div className="entrada-form surgir">
          <h2>Conta criada 🎉</h2>
          <p>Entre e complete o seu perfil de adoção para poder pedir um animal.</p>
          <Link className="btn acento largo" to="/entrar">Entrar</Link>
        </div>
      ) : (
        <form className="entrada-form surgir" onSubmit={(e: FormEvent) => { e.preventDefault(); criar.mutate(); }}>
          <h2 style={{ fontSize: "1.6rem" }}>Criar conta</h2>
          {criar.isError && <Erro erro={criar.error} />}
          <label className="campo"><span>Nome</span><input required {...campo("nome")} /></label>
          <label className="campo"><span>E-mail</span><input type="email" required {...campo("email")} /></label>
          <label className="campo"><span>Senha (mínimo 8)</span><input type="password" required minLength={8} {...campo("senha")} /></label>
          <label className="campo"><span>Cidade</span><input required {...campo("cidade")} /></label>
          <button className="btn acento largo" disabled={criar.isPending}>{criar.isPending ? "Criando…" : "Criar conta"}</button>
          <p style={{ textAlign: "center", margin: 0, fontSize: "0.92rem" }}>Já tem conta? <Link to="/entrar">Entrar</Link></p>
        </form>
      )}
    </div>
  );
}
