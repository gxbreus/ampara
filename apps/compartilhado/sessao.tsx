import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { claimsDoToken, EVENTO_SESSAO_EXPIRADA, sessaoGuardada } from "./api";

interface ContaBase {
  id: string;
  nome: string;
  role: string;
}

interface Sessao<C extends ContaBase> {
  conta: C | null;
  token: string | null;
  expirou: boolean;
  entrar: (token: string, conta: C) => void;
  sair: () => void;
  atualizarConta: (conta: C) => void;
}

const Contexto = createContext<Sessao<ContaBase> | null>(null);

function tokenValido(token: string | null) {
  if (!token) return false;
  if (token === "simulado") return true;
  const c = claimsDoToken(token);
  return !!c && c.exp * 1000 > Date.now();
}

export function SessaoProvider<C extends ContaBase>({ children, rolesPermitidas }: { children: ReactNode; rolesPermitidas: string[] }) {
  const [token, setToken] = useState(() => (tokenValido(sessaoGuardada.token()) ? sessaoGuardada.token() : null));
  const [conta, setConta] = useState<C | null>(() => (token ? sessaoGuardada.conta<C>() : null));
  const [expirou, setExpirou] = useState(false);

  const sair = useCallback(() => {
    sessaoGuardada.limpar();
    setToken(null);
    setConta(null);
  }, []);

  useEffect(() => {
    const aoExpirar = () => {
      setExpirou(true);
      sair();
    };
    window.addEventListener(EVENTO_SESSAO_EXPIRADA, aoExpirar);
    return () => window.removeEventListener(EVENTO_SESSAO_EXPIRADA, aoExpirar);
  }, [sair]);

  const valor = useMemo<Sessao<C>>(
    () => ({
      conta: conta && rolesPermitidas.includes(conta.role) ? conta : null,
      token,
      expirou,
      entrar: (t, c) => {
        sessaoGuardada.salvar(t, c);
        setToken(t);
        setConta(c);
        setExpirou(false);
      },
      sair,
      atualizarConta: (c) => {
        sessaoGuardada.salvar(token ?? "", c);
        setConta(c);
      },
    }),
    [conta, token, expirou, sair, rolesPermitidas],
  );

  return <Contexto.Provider value={valor as unknown as Sessao<ContaBase>}>{children}</Contexto.Provider>;
}

export function useSessao<C extends ContaBase>() {
  const s = useContext(Contexto);
  if (!s) throw new Error("useSessao fora do SessaoProvider");
  return s as unknown as Sessao<C>;
}
