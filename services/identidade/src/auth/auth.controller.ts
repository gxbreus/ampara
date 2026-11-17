import { Body, ConflictException, Controller, HttpCode, HttpStatus, Post, Res, UnauthorizedException } from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { CriarContaDto, CriarSessaoDto } from './dtos';

@Controller('v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('contas')
  async criarConta(@Body() dto: CriarContaDto, @Res({ passthrough: true }) response: Response) {
    try {
      const conta = await this.auth.criarConta(dto);
      response.status(HttpStatus.CREATED).setHeader('Location', `/v1/contas/${conta.id}`);
      return conta;
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException('Já existe uma conta para este e-mail.');
      }
      throw error;
    }
  }

  @Post('sessoes')
  @HttpCode(HttpStatus.OK)
  async criarSessao(@Body() dto: CriarSessaoDto) {
    const sessao = await this.auth.criarSessao(dto);
    if (!sessao) throw new UnauthorizedException('E-mail ou senha inválidos.');
    return sessao;
  }
}
