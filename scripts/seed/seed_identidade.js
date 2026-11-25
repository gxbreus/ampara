// Seed de demonstração da Identidade: as contas da demo, com ids fixos.
//
// Roda dentro do container (ou pod) da Identidade, que já tem `pg` e `bcrypt` e a
// IDENTIDADE_DATABASE_URL no ambiente. A senha das contas chega em SEED_SENHA só durante a
// execução (vem de SEED_SENHA_DEMO no .env, pelo scripts/seed.sh).
//
// Os ids são os mesmos de apps/compartilhado/dev-auth.ts e do seed de Animais
// (scripts/seed/seed_animais.py, ONG_ID): a ONG que entra pelo login real é a mesma dona dos
// animais do seed, e trocar o login de desenvolvimento pelo real não muda nada nos apps.
//
// Rodar de novo não duplica: cada conta é atualizada pelo id (nome, e-mail, papel, cidade,
// status e senha voltam ao valor da demo). A ONG já é registrada como verificada na réplica
// `responsaveis` de Animais pelo seed de Animais, então aqui não se publica conta.verificada.
const { Client } = require("pg");
const bcrypt = require("bcrypt");

const CUSTO_BCRYPT = 10; // o mesmo de services/identidade/src/auth/senha.ts

const CONTAS = [
  { id: "00000000-0000-4000-8000-0000000000a1", nome: "ONG Patinhas de Lavras", email: "ong@ampara.dev", role: "ONG", cidade: "Lavras" },
  { id: "00000000-0000-4000-8000-0000000000b1", nome: "Rita Protetora", email: "protetor@ampara.dev", role: "PROTETOR", cidade: "Lavras" },
  { id: "00000000-0000-4000-8000-0000000000c1", nome: "Admin Ampara", email: "admin@ampara.dev", role: "ADMIN", cidade: "Lavras" },
  { id: "00000000-0000-4000-8000-0000000000d1", nome: "Bruna Silva", email: "adotante@ampara.dev", role: "ADOTANTE", cidade: "Lavras" },
];

// a adotante da demo já tem o perfil completo, para pedir um animal sem passar pelo formulário
const PERFIL_ADOTANTE = { contaId: "00000000-0000-4000-8000-0000000000d1", tipoMoradia: "CASA", temQuintal: true, outrosAnimais: false, horasForaDeCasa: 4 };

async function main() {
  const senha = process.env.SEED_SENHA ?? "";
  if (senha.length < 8) throw new Error("SEED_SENHA precisa de pelo menos 8 caracteres (defina SEED_SENHA_DEMO no .env)");
  const url = process.env.IDENTIDADE_DATABASE_URL;
  if (!url) throw new Error("IDENTIDADE_DATABASE_URL ausente: rode dentro do container da Identidade");

  const banco = new Client({ connectionString: url });
  await banco.connect();
  try {
    const hash = await bcrypt.hash(senha, CUSTO_BCRYPT);
    await banco.query("BEGIN");

    // um e-mail da demo usado por outra conta (cadastro manual antigo) quebraria o login: avisa e para
    const { rows: conflitos } = await banco.query(
      "SELECT id, email FROM contas WHERE email = ANY($1) AND NOT (id = ANY($2))",
      [CONTAS.map((c) => c.email), CONTAS.map((c) => c.id)],
    );
    if (conflitos.length) {
      throw new Error(`e-mail da demo já usado por outra conta: ${conflitos.map((c) => `${c.email} (${c.id})`).join(", ")}`);
    }

    let criadas = 0;
    for (const c of CONTAS) {
      const { rows } = await banco.query(
        `INSERT INTO contas (id, nome, email, senha_hash, cidade, role, status_verificacao)
         VALUES ($1, $2, $3, $4, $5, $6, 'VERIFICADA')
         ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome, email = EXCLUDED.email,
           senha_hash = EXCLUDED.senha_hash, cidade = EXCLUDED.cidade, role = EXCLUDED.role,
           status_verificacao = 'VERIFICADA'
         RETURNING (xmax = 0) AS criada`,
        [c.id, c.nome, c.email, hash, c.cidade, c.role],
      );
      if (rows[0].criada) criadas += 1;
    }

    const p = PERFIL_ADOTANTE;
    await banco.query(
      `INSERT INTO perfis_adocao (conta_id, tipo_moradia, tem_quintal, outros_animais, horas_fora_de_casa, aceite_termo_em)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (conta_id) DO UPDATE SET tipo_moradia = EXCLUDED.tipo_moradia, tem_quintal = EXCLUDED.tem_quintal,
         outros_animais = EXCLUDED.outros_animais, horas_fora_de_casa = EXCLUDED.horas_fora_de_casa,
         aceite_termo_em = COALESCE(perfis_adocao.aceite_termo_em, EXCLUDED.aceite_termo_em)`,
      [p.contaId, p.tipoMoradia, p.temQuintal, p.outrosAnimais, p.horasForaDeCasa],
    );

    await banco.query("COMMIT");
    console.log(`seed identidade: ${criadas} contas criadas, ${CONTAS.length - criadas} atualizadas (${CONTAS.map((c) => c.email).join(", ")})`);
  } catch (erro) {
    await banco.query("ROLLBACK").catch(() => {});
    throw erro;
  } finally {
    await banco.end();
  }
}

main().catch((erro) => {
  console.error(`seed identidade falhou: ${erro.message}`);
  process.exit(1);
});
