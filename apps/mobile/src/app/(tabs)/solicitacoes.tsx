import { Text, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api, estados, finais, type Solicitacao } from "../../api";
import { useSessao } from "../../sessao";
import { Botao, Carregando, Erro, estilos, Protegido, Tela } from "../../ui";
export default function Solicitacoes() {
  const { token } = useSessao();
  const lista = useQuery({
    queryKey: ["solicitacoes"],
    enabled: !!token,
    queryFn: () => api<{ itens: Solicitacao[] }>("/mobile/v1/solicitacoes"),
    refetchInterval: (q) =>
      q.state.data?.itens.some((s) => !finais.includes(s.estado))
        ? 3000
        : false,
  });
  return (
    <Protegido>
      <Tela titulo="Seus encontros">
        <Erro error={lista.error} />
        {lista.isLoading && <Carregando />}
        {lista.data?.itens.length === 0 && (
          <Text style={estilos.texto}>
            Suas solicitações de adoção vão aparecer aqui.
          </Text>
        )}
        {lista.data?.itens.map((s) => (
          <View key={s.id} style={estilos.card}>
            <Text style={estilos.titulo}>{s.animal.nome ?? "Animal"}</Text>
            <Text style={estilos.texto}>{estados[s.estado] ?? s.estado}</Text>
            <Botao onPress={() => router.push(`/solicitacao/${s.id}`)}>
              Acompanhar
            </Botao>
          </View>
        ))}
        <Botao
          onPress={() => {
            void lista.refetch();
          }}
        >
          Atualizar
        </Botao>
      </Tela>
    </Protegido>
  );
}
