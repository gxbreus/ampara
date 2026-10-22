import { Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        genReqId: (request) => request.headers['x-correlation-id']?.toString() ?? randomUUID(),
      },
    }),
  ],
  controllers: [HealthController],
})
export class AppModule {}
