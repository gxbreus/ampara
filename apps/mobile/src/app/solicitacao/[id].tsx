import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, estados, finais, type Solicitacao } from "../../api";
import { useSessao } from "../../sessao";
import { Botao, Carregando, Erro, estilos, Protegido, Tela } from "../../ui";
export default function Acompanhar() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useSessao();
  const cache = useQueryClient();
  const pedido = useQuery({
    queryKey: ["solicitacao", id],
    enabled: !!token,
    queryFn: () => api<Solicitacao>(`/mobile/v1/solicitacoes/${id}`),
    refetchInterval: (q) =>
      finais.includes(q.state.data?.estado ?? "") ? false : 3000,
  });
  const historia = useQuery({
    queryKey: ["historico", id, pedido.data?.estado],
    enabled: !!token && !!pedido.data,
    queryFn: () =>
      api<{
        etapas: { etapa: string; descricao: string; concluidaEm: string }[];
      }>(`/mobile/v1/solicitacoes/${id}/linha-do-tempo`),
  });
  const cancelar = useMutation({
    mutationFn: () =>
      api(pedido.data!._links.cancelar.href, { method: "POST" }),
    onSuccess: () => {
      void cache.invalidateQueries();
    },
  });
  return (
    <Protegido>
      <Tela titulo={pedido.data?.animal.nome ?? "Sua solicitação"}>
        <Erro error={pedido.error} />
        {pedido.isLoading && <Carregando />}
        {pedido.data && (
          <>
            <Text style={estilos.titulo}>
              {estados[pedido.data.estado] ?? pedido.data.estado}
            </Text>
            <Text style={estilos.texto}>{pedido.data.motivo}</Text>
            {(pedido.data.estado === "PERFIL_INVALIDO" ||
              pedido.data.desfecho === "PERFIL_INVALIDO") && (
              <Botao onPress={() => router.push("/(tabs)/perfil")}>
                Ver campos que faltam no perfil
              </Botao>
            )}
            {pedido.data._links.cancelar && (
              <Botao
                disabled={cancelar.isPending}
                onPress={() => cancelar.mutate()}
              >
                Cancelar solicitação
              </Botao>
            )}
          </>
        )}
        <Erro error={cancelar.error} />
        <Erro error={historia.error} />
        {historia.data?.etapas.map((etapa, i) => (
          <View key={`${etapa.etapa}-${i}`} style={estilos.card}>
            <Text style={estilos.texto}>{etapa.descricao}</Text>
            <Text>{new Date(etapa.concluidaEm).toLocaleString("pt-BR")}</Text>
          </View>
        ))}
      </Tela>
    </Protegido>
  );
}
