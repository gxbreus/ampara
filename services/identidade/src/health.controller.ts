import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'pg';

@Controller()
export class HealthController {
  constructor(private readonly config: ConfigService) {}

  @Get('health')
  healthcheck(): { status: string } {
    return { status: 'ok' };
  }

  @Get('ready')
  async readiness(): Promise<{ status: string }> {
    const client = new Client({
      connectionString: this.config.getOrThrow<string>('IDENTIDADE_DATABASE_URL'),
      connectionTimeoutMillis: 300,
    });

    try {
      await client.connect();
      await client.query('SELECT 1');
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'unavailable' });
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}
