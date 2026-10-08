import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { NextFunction, Request, Response } from 'express';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.use((request: Request, response: Response, next: NextFunction) => {
    const correlationId = request.id ? String(request.id) : request.header('x-correlation-id') ?? randomUUID();
    request.id = correlationId;
    response.setHeader('X-Correlation-Id', correlationId);
    response.setHeader('X-Served-By', hostname());
    next();
  });

  await app.listen(Number(process.env.PORT ?? 3001), '0.0.0.0');
}

void bootstrap();
