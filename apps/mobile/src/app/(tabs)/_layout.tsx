import { Tabs } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api, type Notificacao } from "../../api";
import { useSessao } from "../../sessao";
import { cores } from "../../ui";
export default function Abas() {
  const { token, pronto } = useSessao();
  const notificacoes = useQuery({
    queryKey: ["notificacoes"],
    enabled: pronto && !!token,
    queryFn: () => api<{ itens: Notificacao[] }>("/mobile/v1/notificacoes"),
    refetchInterval: 10000,
  });
  const naoLidas = notificacoes.data?.itens.filter((n) => !n.lida).length;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: cores.primaria,
        tabBarStyle: { backgroundColor: "white" },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Buscar" }} />
      <Tabs.Screen name="solicitacoes" options={{ title: "Solicitações" }} />
      <Tabs.Screen
        name="notificacoes"
        options={{ title: "Avisos", tabBarBadge: naoLidas || undefined }}
      />
      <Tabs.Screen name="perfil" options={{ title: "Perfil" }} />
      <Tabs.Screen name="assistente" options={{ title: "Assistente" }} />
    </Tabs>
  );
}
