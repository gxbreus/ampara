import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { StringValue } from 'ms';
import { DatabaseModule } from '../database/database.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

const pem = (value: string) => value.replace(/\\n/g, '\n');

@Module({
  imports: [
    DatabaseModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        privateKey: pem(config.getOrThrow<string>('JWT_PRIVATE_KEY')),
        publicKey: pem(config.getOrThrow<string>('JWT_PUBLIC_KEY')),
        signOptions: {
          algorithm: 'RS256',
          issuer: config.get<string>('JWT_ISSUER', 'ampara-identidade'),
          expiresIn: config.get<string>('JWT_EXPIRACAO', '1h') as StringValue,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
