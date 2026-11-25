import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useSessao } from "@c/sessao";
import type { MinhaConta } from "./api/tipos";
import { Layout } from "./componentes/Layout";
import { AdminContas } from "./paginas/AdminContas";
import { AnimalDetalhe } from "./paginas/AnimalDetalhe";
import { AnimalForm } from "./paginas/AnimalForm";
import { Animais } from "./paginas/Animais";
import { Cadastro } from "./paginas/Cadastro";
import { Entrar } from "./paginas/Entrar";
import { Painel } from "./paginas/Painel";
import { SolicitacaoDetalhe } from "./paginas/SolicitacaoDetalhe";
import { Solicitacoes } from "./paginas/Solicitacoes";

function Protegida({ children, soAdmin }: { children: React.ReactNode; soAdmin?: boolean }) {
  const { conta } = useSessao<MinhaConta>();
  const local = useLocation();
  if (!conta) return <Navigate to="/entrar" replace state={{ de: local.pathname }} />;
  if (soAdmin && conta.role !== "ADMIN") return <Navigate to="/" replace />;
  return <Layout>{children}</Layout>;
}

export function App() {
  return (
    <Routes>
      <Route path="/entrar" element={<Entrar />} />
      <Route path="/cadastro" element={<Cadastro />} />
      <Route path="/" element={<Protegida><Painel /></Protegida>} />
      <Route path="/animais" element={<Protegida><Animais /></Protegida>} />
      <Route path="/animais/novo" element={<Protegida><AnimalForm /></Protegida>} />
      <Route path="/animais/:id" element={<Protegida><AnimalDetalhe /></Protegida>} />
      <Route path="/animais/:id/editar" element={<Protegida><AnimalForm /></Protegida>} />
      <Route path="/solicitacoes" element={<Protegida><Solicitacoes /></Protegida>} />
      <Route path="/solicitacoes/:id" element={<Protegida><SolicitacaoDetalhe /></Protegida>} />
      <Route path="/admin/contas" element={<Protegida soAdmin><AdminContas /></Protegida>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
