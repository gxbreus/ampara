import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class AtualizarPerfilDto {
  @IsIn(['CASA', 'APARTAMENTO', 'SITIO']) tipoMoradia!: 'CASA' | 'APARTAMENTO' | 'SITIO';
  @IsOptional() @IsBoolean() temQuintal?: boolean;
  @IsOptional() @IsBoolean() outrosAnimais?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(24) horasForaDeCasa?: number;
  @IsBoolean() aceiteTermo!: boolean;
}

export class AtualizarVerificacaoDto { @IsIn(['VERIFICADA']) status!: 'VERIFICADA'; }
