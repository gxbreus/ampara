import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { ProblemaException } from '../problemas/problema';
import { AuthenticatedUser } from './auth.types';

export interface AuthenticatedRequest extends Request { user: AuthenticatedUser }

const ROLES = ['ADOTANTE', 'PROTETOR', 'ONG', 'ADMIN'];

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly issuer: string;

  constructor(private readonly jwt: JwtService, config: ConfigService) {
    this.issuer = config.get<string>('JWT_ISSUER', 'ampara-identidade');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = request.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) throw naoAutenticado();
    let claims: Partial<AuthenticatedUser>;
    try {
      claims = await this.jwt.verifyAsync<AuthenticatedUser>(token, { algorithms: ['RS256'], issuer: this.issuer });
    } catch {
      throw naoAutenticado();
    }
    if (typeof claims.sub !== 'string' || !ROLES.includes(claims.role as string)) throw naoAutenticado();
    request.user = { sub: claims.sub, role: claims.role as AuthenticatedUser['role'] };
    return true;
  }
}

const naoAutenticado = () => new ProblemaException('naoAutenticado', 'Envie um token Bearer válido.');
