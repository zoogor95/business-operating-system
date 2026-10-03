import { useEffect, useState } from 'react';
import { API_PREFIX, CORE_MODULES, type HealthResponse } from '@bos/shared';

// Placeholder screen for BOS-001: proves the app builds, imports @bos/shared,
// and can reach the API. Replaced by the real shell in BOS-032.
export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/${API_PREFIX}/health`)
      .then((r) =>
        r.ok
          ? (r.json() as Promise<HealthResponse>)
          : Promise.reject(new Error(`HTTP ${r.status}`)),
      )
      .then(setHealth)
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      });
  }, []);

  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 640,
        margin: '48px auto',
        padding: '0 16px',
      }}
    >
      <h1 style={{ color: '#7c3aed' }}>BOS — Platform Admin</h1>
      <p>Internal app for managing tenants, plans and modules.</p>

      <h2>API</h2>
      {health && (
        <>
          <p>
            {health.status === 'ok' ? '✅' : '⚠️'} {health.service} is up —{' '}
            {health.knownModules.length} modules known
          </p>
          <ul>
            {Object.entries(health.dependencies).map(([name, dep]) => (
              <li key={name}>
                {dep.status === 'up'
                  ? `✅ ${name} (${dep.latencyMs} ms)`
                  : `❌ ${name}: ${dep.error}`}
              </li>
            ))}
          </ul>
        </>
      )}
      {error && (
        <p>
          ⚠️ API unreachable ({error}). Is <code>@bos/api</code> running?
        </p>
      )}
      {!health && !error && <p>Checking…</p>}

      <h2>Core modules (from @bos/shared)</h2>
      <ul>
        {CORE_MODULES.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
    </main>
  );
}
