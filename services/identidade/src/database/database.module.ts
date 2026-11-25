import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

export const DATABASE_POOL = Symbol('DATABASE_POOL');

@Global()
@Module({
  providers: [{
    provide: DATABASE_POOL,
    inject: [ConfigService],
    useFactory: (config: ConfigService) => new Pool({
      connectionString: config.getOrThrow<string>('IDENTIDADE_DATABASE_URL'),
    }),
  }],
  exports: [DATABASE_POOL],
})
export class DatabaseModule {}
