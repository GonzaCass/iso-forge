import { createReadStream, createWriteStream } from 'node:fs';
import { stat, rename, rm, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { validateMicrosoftUrl } from './catalog.mjs';

export async function sha256(path, signal) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    signal?.throwIfAborted();
    hash.update(chunk);
  }
  return hash.digest('hex');
}
const sizeOf = async path => (await stat(path).catch(() => ({ size: 0 }))).size;

export async function downloadFile(file, destination, { signal, onProgress = () => {},
  fetcher = fetch, checkUrl = validateMicrosoftUrl } = {}) {
  if (!/^[a-f0-9]{64}$/i.test(file.sha256)) throw new Error('Se requiere SHA-256.');
  const expected = file.sha256.toLowerCase();
  await mkdir(dirname(destination), { recursive: true });
  if (await sizeOf(destination) === file.size && await sha256(destination, signal) === expected) {
    onProgress(file.size); return;
  }
  if (await sizeOf(destination)) throw new Error('Existe un archivo diferente en el destino: ' + destination);
  const part = destination + '.part';
  let offset = await sizeOf(part);
  if (offset > file.size) { await rm(part); offset = 0; }
  if (offset === file.size) {
    if (await sha256(part, signal) === expected) { await rename(part, destination); onProgress(offset); return; }
    await rm(part); offset = 0;
  }
  let current = checkUrl(file.url).href;
  let response;
  const network = new AbortController();
  const combinedSignal = signal ? AbortSignal.any([signal, network.signal]) : network.signal;
  let timer;
  const watchdog = () => { clearTimeout(timer); timer = setTimeout(() => network.abort(new Error('La descarga dejo de responder; reintenta para reanudar.')), 120000); timer.unref?.(); };
  try {
  for (let redirects = 0; redirects <= 5; redirects++) {
    signal?.throwIfAborted();
    watchdog();
    response = await fetcher(current, { signal: combinedSignal,
      redirect: 'manual', headers: offset ? { Range: `bytes=${offset}-` } : {} });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      current = checkUrl(new URL(response.headers.get('location'), current).href).href;
      await response.body?.cancel(); continue;
    }
    break;
  }
  if (![200, 206].includes(response.status) || !response.body) throw new Error(`Descarga HTTP ${response.status}. Reintenta para renovar los enlaces.`);
  if (response.status === 206) {
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
    if (!range || Number(range[1]) !== offset || Number(range[3]) !== file.size) {
      await response.body.cancel(); throw new Error('El servidor devolvio un rango incorrecto.');
    }
  } else offset = 0;
  const output = createWriteStream(part, { flags: offset ? 'a' : 'w' });
  // Keep errors observed even when they happen between writes.
  let writeError; output.on('error', e => { writeError = e; });
  let count = offset;
  try {
    onProgress(count);
    for await (const chunk of response.body) {
      watchdog();
      signal?.throwIfAborted();
      if (writeError) throw writeError;
      count += chunk.length;
      if (count > file.size) throw new Error('El paquete excede el tamano del catalogo.');
      if (!output.write(chunk)) await once(output, 'drain');
      onProgress(count);
    }
    output.end(); await once(output, 'finish');
  } catch (error) { output.destroy(); throw error; }
  if (count !== file.size) throw new Error('Descarga incompleta; se conserva para reanudar.');
  if (await sha256(part, signal) !== expected) {
    await rm(part); throw new Error('SHA-256 incorrecto. Se descarto el paquete incompleto o alterado.');
  }
  await rename(part, destination);
  } finally { clearTimeout(timer); }
}
