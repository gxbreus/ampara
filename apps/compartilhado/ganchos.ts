import { useEffect } from "react";

// Título da aba por tela: leitores de tela anunciam a página nova e o histórico fica legível.
export function useTituloPagina(titulo: string | undefined, app: string) {
  useEffect(() => {
    document.title = titulo ? `${titulo} · ${app}` : app;
  }, [titulo, app]);
}

// Avisa antes de fechar ou recarregar a aba com um formulário alterado e não salvo.
export function useAvisoSaida(sujo: boolean) {
  useEffect(() => {
    if (!sujo) return;
    const avisar = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [sujo]);
}
