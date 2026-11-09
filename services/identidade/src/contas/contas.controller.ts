import { Body, Controller, ForbiddenException, Get, NotFoundException, Param, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { Request } from 'express';
import { ContasService } from './contas.service';
import { AtualizarPerfilDto, AtualizarVerificacaoDto } from './dtos';
import { Req } from '@nestjs/common';

@Controller('v1/contas')
@UseGuards(JwtAuthGuard)
export class ContasController {
  constructor(private readonly contas: ContasService) {}

  @Get('eu') async eu(@Req() request: AuthenticatedRequest) { return this.contas.eu(request.user.sub); }

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
  async listar(@Req() request: AuthenticatedRequest, @Query('ids') ids?: string, @Query('incluir') incluir?: string, @Query('statusVerificacao') status?: string, @Query('role') role?: string) {
    if (ids) {
      if (!['PROTETOR', 'ONG', 'ADMIN'].includes(request.user.role)) throw new ForbiddenException();
      const valores = ids.split(',').filter(Boolean);
      if (valores.length > 100) return this.contas.idsDemais();
      return this.contas.listarPorIds(valores, incluir === 'perfil');
    }
    if (request.user.role !== 'ADMIN') throw new ForbiddenException();
    return this.contas.listarPendentes(status, role);
  }

  @Get(':id')
  async porId(@Param('id') id: string) {
    const conta = await this.contas.resumo(id);
    if (!conta) throw new NotFoundException('Não existe conta com este identificador.');
    return conta;
  }

  @Put(':id/verificacao')
  async verificar(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() dto: AtualizarVerificacaoDto) {
    if (request.user.role !== 'ADMIN') throw new ForbiddenException();
    const conta = await this.contas.verificar(id, dto.status);
    if (!conta) throw new NotFoundException('Não existe conta com este identificador.');
    return conta;
  }

  private somenteAdotante(request: AuthenticatedRequest) { if (request.user.role !== 'ADOTANTE') throw new ForbiddenException(); }
}
