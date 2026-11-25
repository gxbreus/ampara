import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Erro } from "@c/ui";
import { cadastrar } from "../api/servicos";
import type { NovaConta } from "../api/tipos";

export function Cadastro() {
  const [dados, setDados] = useState<NovaConta>({ nome: "", email: "", senha: "", cidade: "", tipo: "ONG" });
  const criar = useMutation({ mutationFn: () => cadastrar(dados) });
  const campo = (k: keyof NovaConta) => ({ value: dados[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setDados({ ...dados, [k]: e.target.value }) });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    criar.mutate();
  };

  return (
    <div className="portal">
      <section className="portal-arte">
        <span className="marca-nome">Ampara</span>
        <div>
          <h1>
            Junte-se a quem <em>ampara</em>.
          </h1>
          <p>ONGs e protetores entram verificados: depois do cadastro, a administração confere a conta antes de liberar a publicação de animais.</p>
        </div>
        <span />
      </section>
      <section className="portal-form">
        {criar.isSuccess ? (
          <div className="surgir" style={{ maxWidth: 400, display: "grid", gap: "1rem" }}>
            <h2>Conta criada 🎉</h2>
            <p>
              {criar.data.statusVerificacao === "PENDENTE_VERIFICACAO"
                ? "Sua conta está aguardando a verificação da administração. Você já pode entrar e preparar os cadastros."
                : "Sua conta já está ativa."}
            </p>
            <Link className="btn acento" to="/entrar">Ir para o login</Link>
          </div>
        ) : (
          <form onSubmit={enviar} className="surgir">
            <h2>Criar conta</h2>
            {criar.isError && <Erro erro={criar.error} />}
            <label className="campo">
              <span>Tipo de conta</span>
              <select {...campo("tipo")}>
                <option value="ONG">ONG</option>
                <option value="PROTETOR">Protetor(a) independente</option>
              </select>
            </label>
            <label className="campo">
              <span>Nome</span>
              <input required {...campo("nome")} />
            </label>
            <label className="campo">
              <span>E-mail</span>
              <input type="email" required {...campo("email")} />
            </label>
            <label className="campo">
              <span>Senha (mínimo 8)</span>
              <input type="password" required minLength={8} {...campo("senha")} />
            </label>
            <label className="campo">
              <span>Cidade</span>
              <input required {...campo("cidade")} />
            </label>
            <button className="btn acento largo" disabled={criar.isPending}>
              {criar.isPending ? "Criando…" : "Criar conta"}
            </button>
            <p style={{ textAlign: "center", margin: 0, fontSize: "0.92rem" }}>
              Já tem conta? <Link to="/entrar">Entrar</Link>
            </p>
          </form>
        )}
      </section>
    </div>
  );
}
