import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { ContasController } from './contas.controller';
import { ContasService } from './contas.service';

@Module({ imports: [DatabaseModule, AuthModule], controllers: [ContasController], providers: [ContasService] })
export class ContasModule {}
