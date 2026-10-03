import './env';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { API_PREFIX } from '@bos/shared';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix(API_PREFIX);
  // Close DB/Redis connections cleanly on Ctrl+C and watch-mode restarts.
  app.enableShutdownHooks();
  // Dev only: the web apps call through the Vite proxy, but allow direct calls too.
  // Tightened in BOS-081 (security hardening).
  app.enableCors({ origin: [/^http:\/\/localhost:\d+$/] });

  const port = Number(process.env['PORT'] ?? 3000);
  await app.listen(port);
  Logger.log(`BOS API listening on http://localhost:${port}/${API_PREFIX}`);
}

void bootstrap();
