export type Role = 'ADOTANTE' | 'PROTETOR' | 'ONG' | 'ADMIN';
export type StatusVerificacao = 'PENDENTE_VERIFICACAO' | 'VERIFICADA';

export interface AuthenticatedUser {
  sub: string;
  role: Role;
}
