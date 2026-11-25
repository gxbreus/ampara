import { lerComando } from './saga.mensagens';

const base = {
  messageId: '0b8f6c2e-91d4-4a7b-8e13-5c2f9a0d4e61',
  type: 'ValidarPerfil',
  version: 1,
  correlationId: 'c-91a3f2',
  sagaId: '7f1c2a9e-4b3d-4e8a-9c61-2d5f8e0b3a17',
  occurredAt: '2026-11-17T15:00:00Z',
  payload: { adotanteId: '5aa91cf0-3811-4fe5-bb4f-4fdbef3e1d55' },
};
const ler = (valor: unknown) => lerComando(Buffer.from(typeof valor === 'string' ? valor : JSON.stringify(valor)));

describe('lerComando', () => {
  it('aceita o envelope do catálogo e ignora campos desconhecidos', () => {
    const leitura = ler({ ...base, extra: true, payload: { ...base.payload, outro: 1 } });
    expect(leitura).toEqual({ ok: true, comando: { ...base, payload: { adotanteId: base.payload.adotanteId } } });
  });

  it('aceita RegistrarAdocao com animalId de 24 hex', () => {
    const leitura = ler({ ...base, type: 'RegistrarAdocao', payload: { ...base.payload, animalId: '65a2f1c4e8b9d3a7f0c1b2d4' } });
    expect(leitura.ok).toBe(true);
  });

  it.each([
    ['JSON quebrado', '{"messageId":', 'JSON inválido'],
    ['adotanteId que não é UUID', { ...base, payload: { adotanteId: 'abc' } }, 'adotanteId'],
    ['messageId que não é UUID', { ...base, messageId: 'm-1' }, 'messageId'],
    ['sagaId ausente', { ...base, sagaId: null }, 'sagaId'],
    ['version desconhecida', { ...base, version: 2 }, 'version'],
    ['type desconhecido', { ...base, type: 'ApagarTudo' }, 'type'],
    ['animalId fora do padrão', { ...base, type: 'RegistrarAdocao', payload: { ...base.payload, animalId: 'xyz' } }, 'animalId'],
    ['payload ausente', { ...base, payload: undefined }, 'payload'],
    ['envelope que não é objeto', '[1,2]', 'objeto'],
  ])('recusa %s', (_caso, valor, trecho) => {
    const leitura = ler(valor);
    expect(leitura.ok).toBe(false);
    if (!leitura.ok) expect(leitura.motivo).toContain(trecho);
  });
});
