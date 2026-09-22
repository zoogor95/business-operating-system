import type { ModuleKey } from './modules';

/** Response of GET /api/health — used by both web apps as a smoke test. */
export interface HealthResponse {
  status: 'ok';
  service: string;
  version: string;
  time: string;
  /** Proves the API can see the shared module catalogue. */
  knownModules: readonly ModuleKey[];
}

export const API_PREFIX = 'api';
