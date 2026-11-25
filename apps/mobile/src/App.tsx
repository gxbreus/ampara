import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useSessao } from "@c/sessao";
import type { MinhaConta } from "./api/tipos";
import { Casca } from "./componentes/Casca";
import { AnimalDetalhe } from "./paginas/AnimalDetalhe";
import { Assistente } from "./paginas/Assistente";
import { Busca } from "./paginas/Busca";
import { Cadastro } from "./paginas/Cadastro";
import { Entrar } from "./paginas/Entrar";
import { Notificacoes } from "./paginas/Notificacoes";
import { PedidoDetalhe } from "./paginas/PedidoDetalhe";
import { Pedidos } from "./paginas/Pedidos";
import { Perfil } from "./paginas/Perfil";

// A busca e a ficha do animal são públicas (rota sem JWT no gateway); o resto pede login.
function Logado({ children }: { children: React.ReactNode }) {
  const { conta } = useSessao<MinhaConta>();
  const local = useLocation();
  if (!conta) return <Navigate to="/entrar" replace state={{ de: local.pathname }} />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/entrar" element={<Entrar />} />
      <Route path="/cadastro" element={<Cadastro />} />
      <Route element={<Casca />}>
        <Route path="/" element={<Busca />} />
        <Route path="/animais/:id" element={<AnimalDetalhe />} />
        <Route path="/pedidos" element={<Logado><Pedidos /></Logado>} />
        <Route path="/pedidos/:id" element={<Logado><PedidoDetalhe /></Logado>} />
        <Route path="/assistente" element={<Logado><Assistente /></Logado>} />
        <Route path="/avisos" element={<Logado><Notificacoes /></Logado>} />
        <Route path="/perfil" element={<Logado><Perfil /></Logado>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
