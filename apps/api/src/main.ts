import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { API_PREFIX } from '@bos/shared';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix(API_PREFIX);
  // Dev only: the web apps call through the Vite proxy, but allow direct calls too.
  // Tightened in BOS-081 (security hardening).
  app.enableCors({ origin: [/^http:\/\/localhost:\d+$/] });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`BOS API listening on http://localhost:${port}/${API_PREFIX}`);
}

void bootstrap();
