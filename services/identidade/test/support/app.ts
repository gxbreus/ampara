import { generateKeyPairSync } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configurarApp } from '../../src/app.setup';
import { DATABASE_POOL } from '../../src/database/database.module';
import { OutboxRelay } from '../../src/outbox/outbox.relay';
import { BancoDeTeste, criarBanco } from './banco';

export interface AppDeTeste {
  app: INestApplication;
  banco: BancoDeTeste;
  encerrar(): Promise<void>;
}

/** Sobe o AppModule com o banco de teste, um par de chaves RS256 descartável e sem o relay da outbox. */
export async function criarApp(): Promise<AppDeTeste> {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  process.env.JWT_PRIVATE_KEY = privateKey;
  process.env.JWT_PUBLIC_KEY = publicKey;
  process.env.IDENTIDADE_DATABASE_URL ??= 'postgresql://nao-usado/identidade';

  const banco = await criarBanco();
  const modulo = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE_POOL).useValue(banco.pool)
    .overrideProvider(OutboxRelay).useValue({})
    .compile();
  const app = modulo.createNestApplication({ logger: false });
  configurarApp(app);
  await app.init();
  return {
    app,
    banco,
    async encerrar() {
      await app.close();
      await banco.encerrar();
    },
  };
}
