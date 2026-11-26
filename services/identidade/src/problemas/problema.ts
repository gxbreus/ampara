import { HttpException, HttpStatus } from '@nestjs/common';
import { ValidationError } from 'class-validator';

/** Corpo `Problema` de `docs/contratos/identidade.v1.yaml` (RFC 9457). */
export interface Problema {
  type: string;
  title: string;
  status: number;
  detail: string;
}

const BASE = 'https://ampara.dev/problemas/';

/** Tipos de problema usados pela Identidade, com o título do contrato. */
export const TIPOS = {
  validacao: { slug: 'validacao', title: 'Dados inválidos', status: HttpStatus.UNPROCESSABLE_ENTITY },
  emailJaCadastrado: { slug: 'email-ja-cadastrado', title: 'E-mail já cadastrado', status: HttpStatus.CONFLICT },
  contaNaoVerificavel: { slug: 'conta-nao-verificavel', title: 'Conta não verificável', status: HttpStatus.CONFLICT },
  credenciaisInvalidas: { slug: 'credenciais-invalidas', title: 'Credenciais inválidas', status: HttpStatus.UNAUTHORIZED },
  naoAutenticado: { slug: 'nao-autenticado', title: 'Não autenticado', status: HttpStatus.UNAUTHORIZED },
  semPermissao: { slug: 'sem-permissao', title: 'Sem permissão', status: HttpStatus.FORBIDDEN },
  contaNaoEncontrada: { slug: 'conta-nao-encontrada', title: 'Conta não encontrada', status: HttpStatus.NOT_FOUND },
  recursoNaoEncontrado: { slug: 'recurso-nao-encontrado', title: 'Recurso não encontrado', status: HttpStatus.NOT_FOUND },
  erroInterno: { slug: 'erro-interno', title: 'Erro interno', status: HttpStatus.INTERNAL_SERVER_ERROR },
} as const;

export type TipoProblema = keyof typeof TIPOS;

export class ProblemaException extends HttpException {
  readonly problema: Problema;

  constructor(tipo: TipoProblema, detail: string) {
    const { slug, title, status } = TIPOS[tipo];
    const problema = { type: `${BASE}${slug}`, title, status, detail };
    super(problema, status);
    this.problema = problema;
  }
}

/** Problema padrão para uma HttpException que não foi lançada como ProblemaException. */
export function problemaPorStatus(status: number, detail?: string): Problema {
  // 400 (JSON malformado, por exemplo) sai como 422: o contrato só prevê 422 para entrada inválida
  if (status === 400 || status === 422) return problema('validacao', detail ?? 'Dados inválidos.');
  if (status === 401) return problema('naoAutenticado', detail ?? 'Envie um token Bearer válido.');
  if (status === 403) return problema('semPermissao', detail ?? 'A conta autenticada não possui a permissão necessária.');
  if (status === 404) return problema('recursoNaoEncontrado', detail ?? 'Recurso não encontrado.');
  if (status >= 500) {
    return { ...problema('erroInterno', status === 500 ? 'Erro inesperado ao processar a requisição.' : detail ?? 'Serviço indisponível.'), status };
  }
  return { type: `${BASE}requisicao-invalida`, title: 'Requisição inválida', status, detail: detail ?? 'Requisição inválida.' };
}

function problema(tipo: TipoProblema, detail: string): Problema {
  const { slug, title, status } = TIPOS[tipo];
  return { type: `${BASE}${slug}`, title, status, detail };
}

/** Converte os erros do class-validator num 422 com a lista dos campos inválidos. */
export function problemaDeValidacao(erros: ValidationError[]): ProblemaException {
  const campos = achatar(erros);
  const detail = campos.length
    ? `Campos inválidos: ${campos.map(({ campo, mensagens }) => `${campo} (${mensagens.join('; ')})`).join(', ')}.`
    : 'Dados inválidos.';
  return new ProblemaException('validacao', detail);
}

function achatar(erros: ValidationError[], prefixo = ''): { campo: string; mensagens: string[] }[] {
  return erros.flatMap((erro) => {
    const campo = prefixo ? `${prefixo}.${erro.property}` : erro.property;
    const proprios = erro.constraints ? [{ campo, mensagens: Object.values(erro.constraints) }] : [];
    return [...proprios, ...achatar(erro.children ?? [], campo)];
  });
}
