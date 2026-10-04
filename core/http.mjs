import { setTimeout as wait } from 'node:timers/promises';

export async function fetchJson(url, { fetcher = fetch, delay = wait } = {}) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(45000), redirect: 'error' });
      if (!response.ok) {
        const error = new Error(`El catalogo respondio HTTP ${response.status}.`);
        error.retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        await response.body?.cancel();
        throw error;
      }
      return await response.json();
    } catch (error) {
      last = error;
      if (error.retryable === false || attempt === 2) throw error;
      await delay(attempt === 0 ? 1000 : 3000);
    }
  }
  throw last;
}
