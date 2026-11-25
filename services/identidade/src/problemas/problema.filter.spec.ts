import { ArgumentsHost, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProblemaFilter } from './problema.filter';
import { ProblemaException } from './problema';

function host() {
  const response = { status: jest.fn(), type: jest.fn(), send: jest.fn() };
  response.status.mockReturnValue(response);
  response.type.mockReturnValue(response);
  const argumentos = { switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({ id: 'c-1' }) }) } as unknown as ArgumentsHost;
  return { argumentos, response, corpo: () => JSON.parse(response.send.mock.calls[0][0] as string) as Record<string, unknown> };
}

describe('ProblemaFilter', () => {
  it('devolve a ProblemaException como application/problem+json', () => {
    const { argumentos, response, corpo } = host();
    new ProblemaFilter().catch(new ProblemaException('emailJaCadastrado', 'Já existe uma conta para este e-mail.'), argumentos);
    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.type).toHaveBeenCalledWith('application/problem+json');
    expect(corpo()).toEqual({ type: 'https://ampara.dev/problemas/email-ja-cadastrado', title: 'E-mail já cadastrado', status: 409, detail: 'Já existe uma conta para este e-mail.' });
  });

  it('converte HttpException comum para o formato Problema', () => {
    const { argumentos, corpo } = host();
    new ProblemaFilter().catch(new ForbiddenException(), argumentos);
    expect(corpo()).toMatchObject({ type: 'https://ampara.dev/problemas/sem-permissao', status: 403 });

    const outro = host();
    new ProblemaFilter().catch(new NotFoundException('Cannot GET /x'), outro.argumentos);
    expect(outro.corpo()).toMatchObject({ status: 404, detail: 'Cannot GET /x' });
  });

  it('erro inesperado vira 500 sem vazar a mensagem interna', () => {
    const { argumentos, response, corpo } = host();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    new ProblemaFilter().catch(new Error('invalid input syntax for type uuid'), argumentos);
    expect(response.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(corpo())).not.toContain('uuid');
    expect(Object.keys(corpo()).sort()).toEqual(['detail', 'status', 'title', 'type']);
  });
});
