import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { OutboxRelay } from './outbox.relay';

@Module({ imports: [DatabaseModule], providers: [OutboxRelay] })
export class OutboxModule {}
