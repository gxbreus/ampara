import { Pool } from 'pg';
import { PerfilAdocaoRow } from '../../src/perfis/perfil-adocao';

type Estado = {
  contas: Map<string, PerfilAdocaoRow & { role: string }>;
  inbox: Map<string, unknown>;
  vagas: Map<string, string>; // adotante_id → saga_id
  compensadas: Set<string>;
  historico: Map<string, { adotanteId: string; animalId: string }>; // saga_id → adoção
};

const clonar = (e: Estado): Estado => ({
  contas: new Map(e.contas),
  inbox: new Map(e.inbox),
  vagas: new Map(e.vagas),
  compensadas: new Set(e.compensadas),
  historico: new Map(e.historico),
});

/**
 * Dublê do PostgreSQL só para as consultas do SagaService, com transação de verdade:
 * as escritas ficam numa cópia do estado até o COMMIT e somem no ROLLBACK. Serve para
 * os testes unitários de idempotência e de falha entre commit e publish rodarem na CI,
 * já que o pg-mem não entende `FOR UPDATE OF c`. O teste contra o PostgreSQL real fica
 * em test/e2e/saga.e2e-spec.ts.
 */
export class BancoSagaFalso {
  estado: Estado = { contas: new Map(), inbox: new Map(), vagas: new Map(), compensadas: new Set(), historico: new Map() };
  consultas: string[] = [];
  /** Erro a lançar na próxima consulta que contiver o trecho. */
  falharEm?: { trecho: string; erro: Error };

  adotante(id: string, perfil: Partial<PerfilAdocaoRow> = {}, role = 'ADOTANTE'): void {
    this.estado.contas.set(id, {
      role, tipo_moradia: 'CASA', tem_quintal: true, outros_animais: false, horas_fora_de_casa: 4, aceite_termo_em: new Date(), ...perfil,
    });
  }

  get pool(): Pool {
    return { connect: () => Promise.resolve(this.cliente()) } as unknown as Pool;
  }

  private cliente() {
    let tx: Estado | undefined;
    const atual = () => tx ?? this.estado;
    const query = (sql: string, params: unknown[] = []) => {
      const texto = sql.replace(/\s+/g, ' ').trim();
      this.consultas.push(texto);
      if (this.falharEm && texto.includes(this.falharEm.trecho)) {
        const { erro } = this.falharEm;
        this.falharEm = undefined;
        return Promise.reject(erro);
      }
      return Promise.resolve(this.executar(texto, params, atual(), {
        begin: () => { tx = clonar(this.estado); },
        commit: () => { if (tx) this.estado = tx; tx = undefined; },
        rollback: () => { tx = undefined; },
      }));
    };
    return { query, release: () => undefined };
  }

  private executar(sql: string, p: unknown[], e: Estado, tx: { begin(): void; commit(): void; rollback(): void }) {
    const linhas = (rows: unknown[], rowCount = rows.length) => ({ rows, rowCount });
    if (sql === 'BEGIN') { tx.begin(); return linhas([]); }
    if (sql === 'COMMIT') { tx.commit(); return linhas([]); }
    if (sql === 'ROLLBACK') { tx.rollback(); return linhas([]); }
    if (sql.startsWith('SELECT resposta FROM inbox')) {
      const r = e.inbox.get(p[0] as string);
      return linhas(r ? [{ resposta: JSON.parse(JSON.stringify(r)) }] : []);
    }
    if (sql.startsWith('INSERT INTO inbox')) {
      if (e.inbox.has(p[0] as string)) throw Object.assign(new Error('duplicate key'), { code: '23505' });
      e.inbox.set(p[0] as string, JSON.parse(p[2] as string));
      return linhas([], 1);
    }
    if (sql.startsWith('SELECT c.role')) {
      if (!sql.includes('FOR UPDATE OF c')) throw new Error('FOR UPDATE cannot be applied to the nullable side of an outer join');
      const conta = e.contas.get(p[0] as string);
      return linhas(conta ? [conta] : []);
    }
    if (sql.startsWith('SELECT 1 FROM contas')) return linhas(e.contas.has(p[0] as string) ? [{ '?column?': 1 }] : []);
    if (sql.startsWith('SELECT 1 FROM sagas_compensadas')) return linhas(e.compensadas.has(p[0] as string) ? [{ '?column?': 1 }] : []);
    if (sql.startsWith('SELECT saga_id FROM vagas_solicitacao')) {
      const saga = e.vagas.get(p[0] as string);
      return linhas(saga ? [{ saga_id: saga }] : []);
    }
    if (sql.startsWith('INSERT INTO vagas_solicitacao')) {
      const [adotante, saga] = p as string[];
      if (e.vagas.has(adotante) || [...e.vagas.values()].includes(saga)) return linhas([], 0);
      e.vagas.set(adotante, saga);
      return linhas([{ adotante_id: adotante }]);
    }
    if (sql.startsWith('DELETE FROM vagas_solicitacao')) {
      const [adotante, saga] = p as string[];
      if (e.vagas.get(adotante) !== saga) return linhas([], 0);
      e.vagas.delete(adotante);
      return linhas([], 1);
    }
    if (sql.startsWith('INSERT INTO sagas_compensadas')) { e.compensadas.add(p[0] as string); return linhas([], 1); }
    if (sql.startsWith('INSERT INTO adocoes_historico')) {
      const [adotanteId, animalId, saga] = p as string[];
      if (!e.historico.has(saga)) e.historico.set(saga, { adotanteId, animalId });
      return linhas([], 1);
    }
    throw new Error(`consulta não prevista no dublê: ${sql}`);
  }
}
