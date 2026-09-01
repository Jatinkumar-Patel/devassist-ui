import { bridgeApi } from './bridge-url';

export interface SecretStatus {
  hasAdoPat: boolean;
  hasGithubPat: boolean;
}

export async function fetchSecretStatus(): Promise<SecretStatus> {
  const res = await fetch(bridgeApi('/api/status'), { signal: AbortSignal.timeout(2500) });
  if (!res.ok) {
    return { hasAdoPat: false, hasGithubPat: false };
  }

  const data = await res.json() as { adoAuth?: string; githubAuth?: string };
  return {
    hasAdoPat: data.adoAuth === 'ok',
    hasGithubPat: data.githubAuth === 'ok',
  };
}

export async function saveBridgeSecrets(secrets: { adoPat?: string; githubPat?: string }): Promise<SecretStatus> {
  const res = await fetch(bridgeApi('/api/secrets'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(secrets),
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) {
    throw new Error(`Unable to save bridge secrets (HTTP ${res.status})`);
  }

  return res.json() as Promise<SecretStatus>;
}

export async function clearBridgeSecrets(): Promise<void> {
  const res = await fetch(bridgeApi('/api/secrets'), {
    method: 'DELETE',
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) {
    throw new Error(`Unable to clear bridge secrets (HTTP ${res.status})`);
  }
}