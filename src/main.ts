import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors(); // Allows the frontend (localhost:3001) to call this API
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();