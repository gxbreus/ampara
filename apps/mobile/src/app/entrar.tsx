import { useState } from "react";
import { router } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { api } from "../api";
import { useSessao } from "../sessao";
import { Botao, Campo, Erro, Tela } from "../ui";
export default function Entrar() {
  const sessao = useSessao();
  const [cadastro, setCadastro] = useState(false),
    [email, setEmail] = useState(""),
    [senha, setSenha] = useState(""),
    [nome, setNome] = useState(""),
    [cidade, setCidade] = useState("");
  const enviar = useMutation({
    mutationFn: async () => {
      if (cadastro)
        await api("/auth/v1/contas", {
          method: "POST",
          body: JSON.stringify({
            nome,
            email,
            senha,
            cidade,
            tipo: "ADOTANTE",
          }),
        });
      const token = await api<{
        accessToken: string;
        claims: { role: string };
      }>("/auth/v1/sessoes", {
        method: "POST",
        body: JSON.stringify({ email, senha }),
      });
      if (token.claims.role !== "ADOTANTE")
        throw new Error("Use uma conta de adotante neste aplicativo.");
      await sessao.entrar(token.accessToken);
      router.back();
    },
  });
  return (
    <Tela titulo={cadastro ? "Crie sua conta" : "Bem-vindo de volta"}>
      {cadastro && (
        <>
          <Campo label="Seu nome" value={nome} onChangeText={setNome} />
          <Campo label="Cidade" value={cidade} onChangeText={setCidade} />
        </>
      )}
      <Campo
        label="E-mail"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
      />
      <Campo
        label="Senha"
        value={senha}
        onChangeText={setSenha}
        secureTextEntry
        autoCapitalize="none"
      />
      <Erro error={enviar.error} />
      <Botao
        disabled={
          enviar.isPending ||
          !email ||
          !senha ||
          (cadastro && (!nome || !cidade || senha.length < 8))
        }
        onPress={() => enviar.mutate()}
      >
        {enviar.isPending
          ? "Aguarde…"
          : cadastro
            ? "Criar conta e entrar"
            : "Entrar"}
      </Botao>
      <Botao
        onPress={() => {
          enviar.reset();
          setCadastro(!cadastro);
        }}
      >
        {cadastro ? "Já tenho conta" : "Criar conta de adotante"}
      </Botao>
    </Tela>
  );
}
