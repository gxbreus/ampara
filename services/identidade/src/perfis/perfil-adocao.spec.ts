import { PerfilAdocaoRow, camposFaltando, perfilCompleto, serializarPerfil, serializarPerfilResumo } from './perfil-adocao';

const completo: PerfilAdocaoRow = {
  tipo_moradia: 'CASA', tem_quintal: false, outros_animais: null, horas_fora_de_casa: 0, aceite_termo_em: new Date('2026-11-01T12:00:00Z'),
};

describe('perfilCompleto()', () => {
  it('sem perfil, faltam todos os campos obrigatórios', () => {
    expect(perfilCompleto(undefined)).toBe(false);
    expect(perfilCompleto(null)).toBe(false);
    expect(camposFaltando(undefined)).toEqual(['tipoMoradia', 'temQuintal', 'horasForaDeCasa', 'aceiteTermo']);
  });

  it('perfil com os obrigatórios preenchidos é completo, mesmo sem outrosAnimais', () => {
    expect(perfilCompleto(completo)).toBe(true);
    expect(camposFaltando(completo)).toEqual([]);
  });

  it('false e 0 contam como preenchidos', () => {
    expect(camposFaltando({ ...completo, tem_quintal: false, horas_fora_de_casa: 0 })).toEqual([]);
  });

  it.each([
    ['tipoMoradia', { tipo_moradia: null }],
    ['temQuintal', { tem_quintal: null }],
    ['horasForaDeCasa', { horas_fora_de_casa: null }],
    ['aceiteTermo', { aceite_termo_em: null }],
  ])('sem %s, o perfil fica incompleto e aponta o campo', (campo, faltando) => {
    const perfil = { ...completo, ...faltando };
    expect(perfilCompleto(perfil)).toBe(false);
    expect(camposFaltando(perfil)).toEqual([campo]);
  });

  it('lista os campos na ordem do contrato', () => {
    expect(camposFaltando({ ...completo, aceite_termo_em: null, tipo_moradia: null })).toEqual(['tipoMoradia', 'aceiteTermo']);
  });
});

describe('serialização', () => {
  it('PerfilAdocao traz completo e camposFaltando', () => {
    expect(serializarPerfil(undefined)).toEqual({
      tipoMoradia: null, temQuintal: null, outrosAnimais: null, horasForaDeCasa: null, aceiteTermo: false,
      completo: false, camposFaltando: ['tipoMoradia', 'temQuintal', 'horasForaDeCasa', 'aceiteTermo'],
    });
    expect(serializarPerfil(completo)).toEqual({
      tipoMoradia: 'CASA', temQuintal: false, outrosAnimais: null, horasForaDeCasa: 0, aceiteTermo: true, completo: true, camposFaltando: [],
    });
  });

  it('PerfilResumo não traz o aceite e omite campos vazios', () => {
    expect(serializarPerfilResumo(completo)).toEqual({ tipoMoradia: 'CASA', temQuintal: false, horasForaDeCasa: 0, completo: true });
    expect(serializarPerfilResumo({ ...completo, tipo_moradia: null })).toBeNull();
  });
});
