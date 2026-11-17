import { Stack } from "expo-router";
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
} from "@tanstack/react-query";
import { AppState } from "react-native";
import { useEffect } from "react";
import { Sessao } from "../sessao";
import { cores } from "../ui";
const cache = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });
export default function Layout() {
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) =>
      focusManager.setFocused(state === "active"),
    );
    return () => sub.remove();
  }, []);
  return (
    <QueryClientProvider client={cache}>
      <Sessao>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: cores.fundo },
            headerTintColor: cores.texto,
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="entrar" options={{ title: "Sua conta" }} />
          <Stack.Screen
            name="animal/[id]"
            options={{ title: "Conheça seu companheiro" }}
          />
          <Stack.Screen
            name="solicitacao/[id]"
            options={{ title: "Sua solicitação" }}
          />
        </Stack>
      </Sessao>
    </QueryClientProvider>
  );
}
