import { Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { HealthController } from './health.controller';
import { AuthModule } from './auth/auth.module';
import { ContasModule } from './contas/contas.module';
import { OutboxModule } from './outbox/outbox.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        genReqId: (request) => request.headers['x-correlation-id']?.toString() ?? randomUUID(),
      },
    }),
    AuthModule,
    ContasModule,
    OutboxModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
