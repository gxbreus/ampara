import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { NextFunction, Request, Response } from 'express';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ProblemaFilter } from './problemas/problema.filter';
import { problemaDeValidacao } from './problemas/problema';

/** Configuração HTTP comum ao main.ts e aos testes e2e. */
export function configurarApp(app: INestApplication): void {
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: problemaDeValidacao,
  }));
  app.useGlobalFilters(new ProblemaFilter());
  app.use((request: Request, response: Response, next: NextFunction) => {
    const correlationId = request.id ? String(request.id) : request.header('x-correlation-id') ?? randomUUID();
    request.id = correlationId;
    response.setHeader('X-Correlation-Id', correlationId);
    response.setHeader('X-Served-By', hostname());
    next();
  });
}
