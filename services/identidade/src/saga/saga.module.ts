import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SagaConsumer } from './saga.consumer';

@Module({ imports: [DatabaseModule], providers: [SagaConsumer] })
export class SagaModule {}
