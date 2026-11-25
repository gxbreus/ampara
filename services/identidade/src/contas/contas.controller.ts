import { Body, Controller, Get, Param, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { ProblemaException } from '../problemas/problema';
import { ContasService } from './contas.service';
import { AtualizarPerfilDto, AtualizarVerificacaoDto } from './dtos';
import { ehUuid } from './uuid';

export const MAXIMO_IDS = 100;
const STATUS_VERIFICACAO = ['PENDENTE_VERIFICACAO', 'VERIFICADA'];
const ROLES = ['ADOTANTE', 'PROTETOR', 'ONG', 'ADMIN'];

@Controller('v1/contas')
@UseGuards(JwtAuthGuard)
export class ContasController {
  constructor(private readonly contas: ContasService) {}

  @Get('eu')
  async eu(@Req() request: AuthenticatedRequest) {
    const conta = await this.contas.eu(request.user.sub);
    if (!conta) throw contaNaoEncontrada();
    return conta;
  }

  @Get('eu/perfil-adocao')
  async meuPerfil(@Req() request: AuthenticatedRequest) {
    this.somenteAdotante(request);
    return this.contas.obterPerfil(request.user.sub);
  }

  @Put('eu/perfil-adocao')
  async atualizarMeuPerfil(@Req() request: AuthenticatedRequest, @Body() dto: AtualizarPerfilDto) {
    this.somenteAdotante(request);
    return this.contas.atualizarPerfil(request.user.sub, dto);
  }

  @Get()
  async listar(
    @Req() request: AuthenticatedRequest,
    @Query('ids') ids?: string,
    @Query('incluir') incluir?: string,
    @Query('statusVerificacao') status?: string,
    @Query('role') role?: string,
  ) {
    if (ids !== undefined) {
      if (!['PROTETOR', 'ONG', 'ADMIN'].includes(request.user.role)) {
        throw new ProblemaException('semPermissao', 'A consulta por ids exige a role PROTETOR, ONG ou ADMIN.');
      }
      if (incluir !== undefined && incluir !== 'perfil') throw invalido('incluir aceita somente o valor perfil.');
      const valores = validarIds(ids);
      return valores.length ? this.contas.listarPorIds(valores, incluir === 'perfil') : [];
    }
    if (request.user.role !== 'ADMIN') throw new ProblemaException('semPermissao', 'Esta operação exige a role ADMIN.');
    if (status !== undefined && !STATUS_VERIFICACAO.includes(status)) {
      throw invalido(`statusVerificacao deve ser ${STATUS_VERIFICACAO.join(' ou ')}.`);
    }
    if (role !== undefined && !ROLES.includes(role)) throw invalido(`role deve ser ${ROLES.join(', ')}.`);
    return this.contas.listarPendentes(status, role);
  }

  @Get(':id')
  async porId(@Param('id') id: string) {
    // id que não é UUID não identifica nenhuma conta: 404 sem consultar o banco
    const conta = ehUuid(id) ? await this.contas.resumo(id) : undefined;
    if (!conta) throw contaNaoEncontrada();
    return conta;
  }

  @Put(':id/verificacao')
  async verificar(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() dto: AtualizarVerificacaoDto) {
    if (request.user.role !== 'ADMIN') throw new ProblemaException('semPermissao', 'Esta operação exige a role ADMIN.');
    const conta = ehUuid(id) ? await this.contas.verificar(id, dto.status, String(request.id ?? '')) : null;
    if (!conta) throw contaNaoEncontrada();
    return conta;
  }

  private somenteAdotante(request: AuthenticatedRequest) {
    if (request.user.role !== 'ADOTANTE') {
      throw new ProblemaException('semPermissao', 'O perfil de adoção é exclusivo de contas ADOTANTE.');
    }
  }
}

/** Valida a lista de `?ids=`: até 100 identificadores, todos UUID. Erro → 422. */
export function validarIds(ids: string): string[] {
  const valores = [...new Set(ids.split(',').map((id) => id.trim()).filter(Boolean))];
  if (valores.length > MAXIMO_IDS) throw invalido(`A consulta aceita no máximo ${MAXIMO_IDS} identificadores.`);
  const invalidos = valores.filter((id) => !ehUuid(id));
  if (invalidos.length) throw invalido(`ids deve conter somente UUIDs; inválidos: ${invalidos.slice(0, 5).join(', ')}.`);
  return valores;
}

const invalido = (detail: string) => new ProblemaException('validacao', detail);
const contaNaoEncontrada = () => new ProblemaException('contaNaoEncontrada', 'Não existe conta com este identificador.');
