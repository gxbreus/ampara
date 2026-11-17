import { Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Notificacao } from "../../api";
import { useSessao } from "../../sessao";
import {
  Botao,
  Carregando,
  Erro,
  estilos,
  Protegido,
  Tela,
  cores,
} from "../../ui";
export default function Notificacoes() {
  const { token } = useSessao();
  const cache = useQueryClient();
  const lista = useQuery({
    queryKey: ["notificacoes"],
    enabled: !!token,
    queryFn: () => api<{ itens: Notificacao[] }>("/mobile/v1/notificacoes"),
    refetchInterval: 10000,
  });
  const ler = useMutation({
    mutationFn: (id?: string) =>
      api(
        id
          ? `/mobile/v1/notificacoes/${id}/leitura`
          : "/mobile/v1/notificacoes/leitura-todas",
        { method: "POST" },
      ),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ["notificacoes"] });
    },
  });
  return (
    <Protegido>
      <Tela titulo="Seus avisos">
        <Erro error={lista.error} />
        <Erro error={ler.error} />
        {lista.isLoading && <Carregando />}
        <Botao disabled={ler.isPending} onPress={() => ler.mutate(undefined)}>
          Marcar todas como lidas
        </Botao>
        {lista.data?.itens.length === 0 && (
          <Text style={estilos.texto}>Nenhum aviso por enquanto.</Text>
        )}
        {lista.data?.itens.map((n) => (
          <View
            key={n.id}
            style={[estilos.card, !n.lida && { backgroundColor: cores.suave }]}
          >
            <Text
              style={{ ...estilos.texto, fontWeight: n.lida ? "400" : "700" }}
            >
              {n.titulo}
            </Text>
            <Text style={estilos.texto}>{n.mensagem}</Text>
            <Text>{new Date(n.criadoEm).toLocaleString("pt-BR")}</Text>
            {!n.lida && (
              <Botao disabled={ler.isPending} onPress={() => ler.mutate(n.id)}>
                Marcar como lida
              </Botao>
            )}
          </View>
        ))}
      </Tela>
    </Protegido>
  );
}
