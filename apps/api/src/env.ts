import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Loads the repo-root `.env` (see `.env.example`) for local development.
// Variables already set in the environment win. Replaced by typed, validated
// config in BOS-007.
const envFile = resolve(__dirname, '../../../.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required env var ${name} — copy .env.example to .env`);
  }
  return value;
}
