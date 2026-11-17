import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { AuthenticatedUser } from './auth.types';

export interface AuthenticatedRequest extends Request { user: AuthenticatedUser }

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = request.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) throw new UnauthorizedException('Envie um token Bearer válido.');
    try {
      request.user = await this.jwt.verifyAsync<AuthenticatedUser>(token, { algorithms: ['RS256'] });
      return true;
    } catch {
      throw new UnauthorizedException('Envie um token Bearer válido.');
    }
  }
}
