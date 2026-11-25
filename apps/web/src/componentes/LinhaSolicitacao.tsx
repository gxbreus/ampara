import { Link } from "react-router-dom";
import { relativo } from "@c/api";
import { Retrato, SeloEstado } from "@c/ui";
import type { SolicitacaoPainel } from "../api/tipos";

export function LinhaSolicitacao({ s, atraso = 0 }: { s: SolicitacaoPainel; atraso?: number }) {
  return (
    <Link to={`/solicitacoes/${s.id}`} className="linha-solicitacao" style={{ animationDelay: `${atraso}s` }}>
      <Retrato className="foto mini" nome={s.animal?.nome ?? "?"} src={s.animal?.fotoCapa} />
      <div>
        <strong>{s.animal?.nome ?? "Animal ainda sem reserva"}</strong>
        <small>
          pedido de {s.adotante?.nome ?? "adotante (Identidade fora do ar)"} · {relativo(s.criadoEm)}
        </small>
      </div>
      <div>
        <small>
          {s.adotante?.perfil
            ? s.adotante.perfil.completo
              ? "perfil completo"
              : "perfil incompleto"
            : "sem perfil"}
          {s.expiraEm && s.estado === "AGUARDANDO_APROVACAO" && ` · expira ${relativo(s.expiraEm)}`}
        </small>
      </div>
      <SeloEstado estado={s.estado} />
    </Link>
  );
}
