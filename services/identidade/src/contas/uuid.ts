const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Confere o formato antes de mandar ao PostgreSQL, que responde 22P02 para um uuid inválido. */
export function ehUuid(valor: unknown): valor is string {
  return typeof valor === 'string' && UUID.test(valor);
}
