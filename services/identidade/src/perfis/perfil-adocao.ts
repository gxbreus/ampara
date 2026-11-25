/** Linha da tabela `perfis_adocao` (sem a chave `conta_id`). */
export interface PerfilAdocaoRow {
  tipo_moradia: string | null;
  tem_quintal: boolean | null;
  outros_animais: boolean | null;
  horas_fora_de_casa: number | null;
  aceite_termo_em: Date | null;
}

/** Campos obrigatórios para o perfil contar como completo, com o nome usado na API. */
export const CAMPOS_OBRIGATORIOS = ['tipoMoradia', 'temQuintal', 'horasForaDeCasa', 'aceiteTermo'] as const;
export type CampoObrigatorio = (typeof CAMPOS_OBRIGATORIOS)[number];

/** O que falta preencher no perfil; sem perfil, faltam todos os campos obrigatórios. */
export function camposFaltando(perfil?: PerfilAdocaoRow | null): CampoObrigatorio[] {
  if (!perfil) return [...CAMPOS_OBRIGATORIOS];
  const preenchido: Record<CampoObrigatorio, boolean> = {
    tipoMoradia: Boolean(perfil.tipo_moradia),
    temQuintal: perfil.tem_quintal !== null && perfil.tem_quintal !== undefined,
    horasForaDeCasa: perfil.horas_fora_de_casa !== null && perfil.horas_fora_de_casa !== undefined,
    aceiteTermo: Boolean(perfil.aceite_termo_em),
  };
  return CAMPOS_OBRIGATORIOS.filter((campo) => !preenchido[campo]);
}

/** O perfil está completo quando nenhum campo obrigatório falta. */
export function perfilCompleto(perfil?: PerfilAdocaoRow | null): boolean {
  return camposFaltando(perfil).length === 0;
}

/** `PerfilAdocao` do contrato: o perfil da própria conta, com o aceite e o que falta. */
export function serializarPerfil(perfil?: PerfilAdocaoRow | null) {
  const faltando = camposFaltando(perfil);
  return {
    tipoMoradia: perfil?.tipo_moradia ?? null,
    temQuintal: perfil?.tem_quintal ?? null,
    outrosAnimais: perfil?.outros_animais ?? null,
    horasForaDeCasa: perfil?.horas_fora_de_casa ?? null,
    aceiteTermo: Boolean(perfil?.aceite_termo_em),
    completo: faltando.length === 0,
    camposFaltando: faltando,
  };
}

/** `PerfilResumo` do contrato: sem aceite do termo; null quando a conta não tem perfil. */
export function serializarPerfilResumo(perfil: PerfilAdocaoRow) {
  if (!perfil.tipo_moradia) return null;
  return {
    tipoMoradia: perfil.tipo_moradia,
    ...(perfil.tem_quintal === null ? {} : { temQuintal: perfil.tem_quintal }),
    ...(perfil.outros_animais === null ? {} : { outrosAnimais: perfil.outros_animais }),
    ...(perfil.horas_fora_de_casa === null ? {} : { horasForaDeCasa: perfil.horas_fora_de_casa }),
    completo: perfilCompleto(perfil),
  };
}
