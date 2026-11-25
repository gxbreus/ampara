import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SagaConsumer } from './saga.consumer';
import { SagaService } from './saga.service';

@Module({ imports: [DatabaseModule], providers: [SagaService, SagaConsumer] })
export class SagaModule {}
