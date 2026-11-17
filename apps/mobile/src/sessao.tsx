import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import * as SecureStore from "expo-secure-store";
import { useQueryClient } from "@tanstack/react-query";
import { configurarSessao } from "./api";

const Contexto = createContext({
  token: null as string | null,
  pronto: false,
  entrar: async (_token: string) => {},
  sair: async () => {},
});
export const useSessao = () => useContext(Contexto);
export function Sessao({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [pronto, setPronto] = useState(false);
  const cache = useQueryClient();
  const sair = useCallback(async () => {
    configurarSessao(null, () => {});
    setToken(null);
    cache.clear();
    await SecureStore.deleteItemAsync("ampara.sessao");
  }, [cache]);
  async function entrar(valor: string) {
    await SecureStore.setItemAsync("ampara.sessao", valor);
    cache.clear();
    configurarSessao(valor, () => {
      void sair();
    });
    setToken(valor);
  }
  useEffect(() => {
    let ativa = true;
    SecureStore.getItemAsync("ampara.sessao")
      .then((valor) => {
        if (ativa) {
          configurarSessao(valor, () => {
            void sair();
          });
          setToken(valor);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (ativa) setPronto(true);
      });
    return () => {
      ativa = false;
    };
  }, [sair]);
  return (
    <Contexto.Provider value={{ token, pronto, entrar, sair }}>
      {children}
    </Contexto.Provider>
  );
}
