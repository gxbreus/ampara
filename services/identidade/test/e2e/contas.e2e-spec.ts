import request from 'supertest';
import { App } from 'supertest/types';
import { AppDeTeste, criarApp } from '../support/app';

const PROBLEMA = /^application\/problem\+json/;

describe('Identidade (e2e): cadastro → sessão → eu', () => {
  let ctx: AppDeTeste;
  let http: App;

  beforeAll(async () => {
    ctx = await criarApp();
    http = ctx.app.getHttpServer() as App;
  });

  afterAll(async () => { await ctx?.encerrar(); });

  async function cadastrar(email: string, tipo = 'ADOTANTE') {
    return request(http).post('/v1/auth/contas').send({ nome: 'Bruna Silva', email, senha: 'senha-de-exemplo-segura', cidade: 'Lavras', tipo });
  }

  async function entrar(email: string, senha = 'senha-de-exemplo-segura') {
    return request(http).post('/v1/auth/sessoes').send({ email, senha });
  }

  it('cadastra, cria a sessão e consulta a conta autenticada', async () => {
    const cadastro = await cadastrar('bruna@example.com');
    expect(cadastro.status).toBe(201);
    expect(cadastro.headers.location).toBe(`/v1/contas/${cadastro.body.id}`);
    expect(cadastro.body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/), nome: 'Bruna Silva', email: 'bruna@example.com',
      role: 'ADOTANTE', cidade: 'Lavras', statusVerificacao: 'VERIFICADA',
    });
    expect(JSON.stringify(cadastro.body)).not.toContain('senha');

    const sessao = await entrar('BRUNA@example.com');
    expect(sessao.status).toBe(200);
    expect(sessao.body.tokenType).toBe('Bearer');
    expect(sessao.body.claims).toEqual({ iss: 'ampara-identidade', sub: cadastro.body.id, role: 'ADOTANTE', exp: expect.any(Number) });
    const [cabecalho] = (sessao.body.accessToken as string).split('.');
    expect(JSON.parse(Buffer.from(cabecalho, 'base64url').toString())).toMatchObject({ alg: 'RS256' });

    const eu = await request(http).get('/v1/contas/eu').set('Authorization', `Bearer ${sessao.body.accessToken}`);
    expect(eu.status).toBe(200);
    expect(eu.body).toEqual(cadastro.body);
  });

  it('e-mail repetido responde 409 em problem+json', async () => {
    await cadastrar('repetido@example.com');
    const resposta = await cadastrar('repetido@example.com');
    expect(resposta.status).toBe(409);
    expect(resposta.headers['content-type']).toMatch(PROBLEMA);
    expect(resposta.body).toEqual({
      type: 'https://ampara.dev/problemas/email-ja-cadastrado', title: 'E-mail já cadastrado', status: 409,
      detail: 'Já existe uma conta para este e-mail.',
    });
  });

  it('tipo ADMIN e campos inválidos respondem 422 com a lista dos campos', async () => {
    const resposta = await request(http).post('/v1/auth/contas').send({ nome: '', email: 'x', senha: '123', cidade: 'Lavras', tipo: 'ADMIN' });
    expect(resposta.status).toBe(422);
    expect(resposta.headers['content-type']).toMatch(PROBLEMA);
    expect(resposta.body).toMatchObject({ type: 'https://ampara.dev/problemas/validacao', title: 'Dados inválidos', status: 422 });
    for (const campo of ['nome', 'email', 'senha', 'tipo']) expect(resposta.body.detail).toContain(campo);
    expect(Object.keys(resposta.body).sort()).toEqual(['detail', 'status', 'title', 'type']);
  });

  it('JSON malformado responde 422 em problem+json', async () => {
    const resposta = await request(http).post('/v1/auth/contas').set('Content-Type', 'application/json').send('{"nome":');
    expect(resposta.status).toBe(422);
    expect(resposta.headers['content-type']).toMatch(PROBLEMA);
  });

  it('senha errada e e-mail inexistente respondem o mesmo 401', async () => {
    await cadastrar('senha@example.com');
    const errada = await entrar('senha@example.com', 'outra-senha-qualquer');
    const inexistente = await entrar('ninguem@example.com', 'outra-senha-qualquer');
    for (const resposta of [errada, inexistente]) {
      expect(resposta.status).toBe(401);
      expect(resposta.headers['content-type']).toMatch(PROBLEMA);
      expect(resposta.body).toEqual({
        type: 'https://ampara.dev/problemas/credenciais-invalidas', title: 'Credenciais inválidas', status: 401,
        detail: 'E-mail ou senha inválidos.',
      });
    }
  });

  it('sem token, rotas internas respondem 401 em problem+json', async () => {
    const resposta = await request(http).get('/v1/contas/eu');
    expect(resposta.status).toBe(401);
    expect(resposta.headers['content-type']).toMatch(PROBLEMA);
    expect(resposta.body.type).toBe('https://ampara.dev/problemas/nao-autenticado');
  });

  describe('com sessão', () => {
    let adotante: { id: string; token: string };
    let ong: { id: string; token: string };

    beforeAll(async () => {
      const a = await cadastrar('adotante@example.com');
      adotante = { id: a.body.id, token: (await entrar('adotante@example.com')).body.accessToken };
      const o = await cadastrar('ong@example.com', 'ONG');
      ong = { id: o.body.id, token: (await entrar('ong@example.com')).body.accessToken };
    });

    const comToken = (token: string) => ({ Authorization: `Bearer ${token}` });

    it('id que não é UUID responde 404, não 500', async () => {
      const resposta = await request(http).get('/v1/contas/nao-e-uuid').set(comToken(ong.token));
      expect(resposta.status).toBe(404);
      expect(resposta.headers['content-type']).toMatch(PROBLEMA);
      expect(resposta.body.type).toBe('https://ampara.dev/problemas/conta-nao-encontrada');
    });

    it('UUID inexistente responde 404', async () => {
      const resposta = await request(http).get('/v1/contas/5aa91cf0-3811-4fe5-bb4f-4fdbef3e1d55').set(comToken(ong.token));
      expect(resposta.status).toBe(404);
    });

    it('?ids= com id que não é UUID responde 422', async () => {
      const resposta = await request(http).get(`/v1/contas?ids=${adotante.id},abc`).set(comToken(ong.token));
      expect(resposta.status).toBe(422);
      expect(resposta.headers['content-type']).toMatch(PROBLEMA);
      expect(resposta.body.detail).toContain('abc');
    });

    it('?ids= com 101 ids responde 422', async () => {
      const ids = Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
      const resposta = await request(http).get(`/v1/contas?ids=${ids.join(',')}`).set(comToken(ong.token));
      expect(resposta.status).toBe(422);
      expect(resposta.body.type).toBe('https://ampara.dev/problemas/validacao');
    });

    // o pg-mem não resolve `= ANY($1::uuid[])` com parâmetro; só roda com PostgreSQL real
    const comPostgres = process.env.IDENTIDADE_TEST_DATABASE_URL ? it : it.skip;

    comPostgres('?ids= com incluir=perfil devolve o resumo sem e-mail', async () => {
      const resposta = await request(http).get(`/v1/contas?ids=${adotante.id}&incluir=perfil`).set(comToken(ong.token));
      expect(resposta.status).toBe(200);
      expect(resposta.body).toEqual([{ id: adotante.id, nome: 'Bruna Silva', role: 'ADOTANTE', cidade: 'Lavras', statusVerificacao: 'VERIFICADA', perfil: null }]);
    });

    it('ADOTANTE não consulta por ids (403 em problem+json)', async () => {
      const resposta = await request(http).get(`/v1/contas?ids=${adotante.id}`).set(comToken(adotante.token));
      expect(resposta.status).toBe(403);
      expect(resposta.headers['content-type']).toMatch(PROBLEMA);
      expect(resposta.body.type).toBe('https://ampara.dev/problemas/sem-permissao');
    });

    it('perfil de adoção mostra camposFaltando até ficar completo', async () => {
      const vazio = await request(http).get('/v1/contas/eu/perfil-adocao').set(comToken(adotante.token));
      expect(vazio.status).toBe(200);
      expect(vazio.body).toMatchObject({ completo: false, camposFaltando: ['tipoMoradia', 'temQuintal', 'horasForaDeCasa', 'aceiteTermo'] });

      const parcial = await request(http).put('/v1/contas/eu/perfil-adocao').set(comToken(adotante.token)).send({ tipoMoradia: 'CASA', aceiteTermo: false });
      expect(parcial.status).toBe(200);
      expect(parcial.body).toMatchObject({ completo: false, camposFaltando: ['temQuintal', 'horasForaDeCasa', 'aceiteTermo'] });

      const completo = await request(http).put('/v1/contas/eu/perfil-adocao').set(comToken(adotante.token))
        .send({ tipoMoradia: 'CASA', temQuintal: true, outrosAnimais: false, horasForaDeCasa: 4, aceiteTermo: true });
      expect(completo.body).toEqual({ tipoMoradia: 'CASA', temQuintal: true, outrosAnimais: false, horasForaDeCasa: 4, aceiteTermo: true, completo: true, camposFaltando: [] });
    });

    it('perfil de adoção é exclusivo de ADOTANTE', async () => {
      const resposta = await request(http).get('/v1/contas/eu/perfil-adocao').set(comToken(ong.token));
      expect(resposta.status).toBe(403);
    });
  });
});
