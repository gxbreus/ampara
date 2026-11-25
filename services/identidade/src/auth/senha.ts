import * as bcrypt from 'bcrypt';

/** Custo do bcrypt definido na #53. */
export const CUSTO_BCRYPT = 10;

export function gerarHashSenha(senha: string): Promise<string> {
  return bcrypt.hash(senha, CUSTO_BCRYPT);
}

let hashFicticio: Promise<string> | undefined;

/**
 * Confere a senha contra o hash guardado. Sem conta (hash ausente), compara com um
 * hash fictício do mesmo custo e devolve false: o tempo de resposta é o mesmo e não
 * revela se o e-mail está cadastrado.
 */
export async function conferirSenha(senha: string, hash: string | undefined | null): Promise<boolean> {
  if (hash) return bcrypt.compare(senha, hash);
  hashFicticio ??= bcrypt.hash('senha-ficticia-para-tempo-constante', CUSTO_BCRYPT);
  await bcrypt.compare(senha, await hashFicticio);
  return false;
}
