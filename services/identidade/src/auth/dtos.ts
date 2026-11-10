import { IsEmail, IsIn, IsNotEmpty, IsString, MinLength } from 'class-validator';
import { Role } from './auth.types';

export class CriarContaDto {
  @IsString() @IsNotEmpty() nome!: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(8) senha!: string;
  @IsString() @IsNotEmpty() cidade!: string;
  @IsIn(['ADOTANTE', 'PROTETOR', 'ONG']) tipo!: Exclude<Role, 'ADMIN'>;
}

export class CriarSessaoDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(1) senha!: string;
}
