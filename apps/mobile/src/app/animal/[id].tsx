import { useRef } from "react";
import { Image, Text } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, estados, type Animal } from "../../api";
import { useSessao } from "../../sessao";
import { Botao, Carregando, Erro, estilos, Tela } from "../../ui";
export default function Detalhe() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sessao = useSessao();
  const cache = useQueryClient();
  const chave = useRef<string | undefined>(undefined);
  const animal = useQuery({
    queryKey: ["animal", id, sessao.token],
    enabled: sessao.pronto,
    queryFn: () => api<Animal>(`/mobile/v1/animais/${id}`),
  });
  const adotar = useMutation({
    mutationFn: () => {
      chave.current ??= `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      return api<{ id: string }>("/mobile/v1/solicitacoes", {
        method: "POST",
        headers: { "Idempotency-Key": chave.current },
        body: JSON.stringify({ animalId: id }),
      });
    },
    onSuccess: (s) => {
      void cache.invalidateQueries();
      router.push(`/solicitacao/${s.id}`);
    },
  });
  const a = animal.data;
  return (
    <Tela titulo={a?.nome ?? "Conheça este animal"}>
      <Erro error={animal.error} />
      {animal.isLoading && <Carregando />}
      {a && (
        <>
          {a.fotos.map((foto, i) => (
            <Image
              key={`${foto}-${i}`}
              source={{ uri: foto }}
              style={estilos.imagem}
              accessibilityLabel={`${a.nome}, foto ${i + 1}`}
            />
          ))}
          <Text style={estilos.texto}>
            {a.especie} · {a.porte} · {a.sexo} · {a.idadeMeses} meses
          </Text>
          <Text style={estilos.texto}>
            {a.bairro}, {a.cidade}
          </Text>
          <Text style={estilos.texto}>{a.descricao}</Text>
          <Text style={estilos.texto}>
            {a.responsavel.nome}
            {a.responsavel.verificado ? " · Responsável verificado ✓" : ""}
          </Text>
          {a.minhaSolicitacao ? (
            <Botao
              onPress={() =>
                router.push(`/solicitacao/${a.minhaSolicitacao!.id}`)
              }
            >
              {estados[a.minhaSolicitacao.estado] ?? "Acompanhar solicitação"}
            </Botao>
          ) : (
            <Botao
              disabled={adotar.isPending || a.status !== "DISPONIVEL"}
              onPress={() =>
                sessao.token ? adotar.mutate() : router.push("/entrar")
              }
            >
              {adotar.isPending
                ? "Enviando…"
                : a.status === "DISPONIVEL"
                  ? "Quero adotar"
                  : "Animal indisponível"}
            </Botao>
          )}
          <Erro error={adotar.error} />
          <Botao onPress={() => router.push("/(tabs)/perfil")}>
            Completar meu perfil de adoção
          </Botao>
        </>
      )}
    </Tela>
  );
}
