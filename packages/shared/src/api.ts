import type { ModuleKey } from './modules';

/** Backing services the API checks on every health call. */
export type HealthDependency = 'postgres' | 'redis' | 'mail';

export type DependencyHealth =
  { status: 'up'; latencyMs: number } | { status: 'down'; error: string };

/** Response of GET /api/health — used by both web apps as a smoke test. */
export interface HealthResponse {
  /** `degraded` when any dependency is down; the API itself is still serving. */
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  time: string;
  dependencies: Record<HealthDependency, DependencyHealth>;
  /** Proves the API can see the shared module catalogue. */
  knownModules: readonly ModuleKey[];
}

export const API_PREFIX = 'api';
