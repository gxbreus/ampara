import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { Problema, ProblemaException, problemaPorStatus } from './problema';

/**
 * Toda resposta de erro sai em `application/problem+json`, no formato `Problema`
 * do contrato. Exceções que não são HttpException viram 500 sem detalhes internos.
 */
@Catch()
export class ProblemaFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemaFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const contexto = host.switchToHttp();
    const response = contexto.getResponse<Response>();
    const request = contexto.getRequest<Request>();
    const problema = this.problema(exception);

    if (problema.status >= 500) {
      this.logger.error({ err: exception, correlationId: request.id }, 'Erro inesperado ao processar a requisição.');
    }

    response.status(problema.status).type('application/problem+json').send(JSON.stringify(problema));
  }

  private problema(exception: unknown): Problema {
    if (exception instanceof ProblemaException) return exception.problema;
    if (exception instanceof HttpException) return problemaPorStatus(exception.getStatus(), detalhe(exception));
    return problemaPorStatus(500);
  }
}

function detalhe(exception: HttpException): string | undefined {
  const corpo = exception.getResponse();
  if (typeof corpo === 'string') return corpo;
  const message = (corpo as { message?: unknown }).message;
  if (Array.isArray(message)) return message.join('; ');
  return typeof message === 'string' ? message : undefined;
}
