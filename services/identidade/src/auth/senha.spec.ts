import * as bcrypt from 'bcrypt';
import { CUSTO_BCRYPT, conferirSenha, gerarHashSenha } from './senha';

describe('hash de senha', () => {
  it('gera um hash bcrypt com custo 10, sem a senha em claro', async () => {
    const hash = await gerarHashSenha('senha-de-exemplo-segura');
    expect(hash).toMatch(/^\$2[aby]\$10\$/);
    expect(bcrypt.getRounds(hash)).toBe(CUSTO_BCRYPT);
    expect(hash).not.toContain('senha-de-exemplo-segura');
  });

  it('usa sal: a mesma senha gera hashes diferentes', async () => {
    const [a, b] = await Promise.all([gerarHashSenha('mesma-senha-123'), gerarHashSenha('mesma-senha-123')]);
    expect(a).not.toBe(b);
  });

  it('confere a senha certa e recusa a errada', async () => {
    const hash = await gerarHashSenha('senha-de-exemplo-segura');
    await expect(conferirSenha('senha-de-exemplo-segura', hash)).resolves.toBe(true);
    await expect(conferirSenha('senha-errada', hash)).resolves.toBe(false);
  });

  it('sem hash (e-mail inexistente), roda o bcrypt mesmo assim e devolve false', async () => {
    // o módulo cru: senha.ts lê bcrypt.compare dele a cada chamada
    const compare = jest.spyOn(jest.requireActual<typeof bcrypt>('bcrypt'), 'compare');
    await expect(conferirSenha('qualquer-senha', undefined)).resolves.toBe(false);
    expect(compare).toHaveBeenCalledTimes(1);
    compare.mockRestore();
  });
});
