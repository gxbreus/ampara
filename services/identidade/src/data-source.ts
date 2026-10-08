import 'reflect-metadata';
import { DataSource } from 'typeorm';

export default new DataSource({
  type: 'postgres',
  url: process.env.IDENTIDADE_DATABASE_URL,
  migrations: ['dist/migrations/*.js'],
  synchronize: false,
});
