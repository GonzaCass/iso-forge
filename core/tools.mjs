import { mkdir, stat, cp, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { downloadFile, sha256 } from './download.mjs';

export const CONVERTER_COMMIT = '2c05458f5962fa7b12b5e3cb84a5349660727ea7';
const TOOL_HASH = '1af6887157a23627b0155674386c094daf902df0e8ada7bb143bc69d6809f56f';
export function psQuote(value) { return "'" + String(value).replaceAll("'", "''") + "'"; }
export async function exec(exe, args, { cwd, signal, onOutput = () => {}, log } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd, windowsHide: true, shell: false, signal });
    let output = '';
    const receive = data => { const text = data.toString(); output = (output + text).slice(-100000);
      log?.write(data); onOutput(text); };
    child.stdout.on('data', receive); child.stderr.on('data', receive);
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error(`La herramienta termino con codigo ${code}. ${output.slice(-1500)}`)));
  });
}
export async function powershell(script, options) {
  return exec('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64')], options);
}
export async function prepareTools(cache, notify, signal) {
  const bundle = join(cache, CONVERTER_COMMIT);
  const ready = join(bundle, 'verified.json');
  try {
    const manifest = JSON.parse(await readFile(ready, 'utf8'));
    for (const [relative, expected] of Object.entries(manifest)) {
      if (await sha256(join(bundle, relative), signal) !== expected) throw new Error('Herramienta modificada.');
    }
    return bundle;
  } catch { /* A missing or changed cache is rebuilt from the pinned archive. */ }
  await mkdir(cache, { recursive: true });
  notify('Preparando herramientas de conversion...');
  const zip = join(cache, 'converter-' + CONVERTER_COMMIT + '.zip');
  const url = `https://codeload.github.com/abbodi1406/BatUtil/zip/${CONVERTER_COMMIT}`;
  const head = await fetch(url, { signal, method: 'HEAD', redirect: 'error' });
  if (!head.ok) throw new Error('No se pudieron obtener las herramientas de conversion.');
  // Codeload often omits Content-Length; download the small archive directly then pin its digest.
  if (!await stat(zip).catch(() => null) || await sha256(zip, signal) !== TOOL_HASH) {
    const response = await fetch(url, { signal, redirect: 'error' });
    if (!response.ok) throw new Error('No se pudieron descargar las herramientas.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 100 * 1024 * 1024) throw new Error('Archivo de herramientas demasiado grande.');
    const temp = zip + '.new'; await writeFile(temp, bytes);
    if (await sha256(temp, signal) !== TOOL_HASH) throw new Error('El paquete de herramientas no coincide con su SHA-256 fijado.');
    const { rename, rm } = await import('node:fs/promises');
    await rm(zip, { force: true }); await rename(temp, zip);
  }
  const extracted = join(cache, 'extract-' + Date.now());
  await powershell(`$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath ${psQuote(zip)} -DestinationPath ${psQuote(extracted)}`, { signal });
  await cp(join(extracted, 'BatUtil-' + CONVERTER_COMMIT, 'uup-converter-wimlib'), bundle, { recursive: true, force: true });
  // Avoid recursive deletion of downloaded trees; all extraction stays inside the tools cache.
  const { readdir } = await import('node:fs/promises');
  const manifest = {};
  async function scan(path, prefix = '') {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const rel = prefix + entry.name;
      if (entry.isDirectory()) await scan(join(path, entry.name), rel + '/');
      else if (rel !== 'verified.json') manifest[rel] = await sha256(join(path, entry.name), signal);
    }
  }
  await scan(bundle); await writeFile(ready, JSON.stringify(manifest, null, 2));
  return bundle;
}
