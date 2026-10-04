import { fetchJson } from './http.mjs';
export const PRODUCTS = [
  { id: 'server2022', name: 'Windows Server 2022', query: '20348', match: /server operating system|Windows Server 2022/i },
  { id: 'server2025', name: 'Windows Server 2025', query: '26100', match: /server operating system|Windows Server 2025/i },
  { id: 'windows11', name: 'Windows 11', query: 'Windows 11', match: /Windows 11/i },
  { id: 'windows10', name: 'Windows 10', query: '19045', match: /Windows 10/i },
  { id: 'server2019', name: 'Windows Server 2019', query: '17763', match: /server|Windows Server/i },
];
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const isEvaluation = value => /eval|evaluation|trial/i.test(value);
export function product(id) {
  const result = PRODUCTS.find(p => p.id === id);
  if (!result) throw new Error('Producto desconocido.');
  return result;
}
export function normalizeBuilds(data, id) {
  const p = product(id);
  return Object.values(data ?? {}).filter(b => UUID.test(b.uuid) && b.arch === 'amd64'
    && p.match.test(b.title) && !/cumulative|preview|insider|canary|beta|\bdev\b|azure|HCI|security update|hotpatch|dynamic update|servicing stack|safe os|update for/i.test(b.title))
    .sort((a, b) => b.created - a.created).slice(0, 60);
}
async function api(endpoint, params) {
  const url = new URL('https://api.uupdump.net/' + endpoint + '.php');
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const json = await fetchJson(url);
  if (json.error || json.response?.error || !json.response) {
    throw new Error('El catalogo no pudo resolver esta seleccion: ' + (json.error ?? json.response?.error ?? 'respuesta invalida'));
  }
  return json.response;
}
export async function builds(id) {
  const response = await api('listid', { search: product(id).query, sortByDate: '1' });
  return normalizeBuilds(response.builds, id);
}
export async function languages(id) {
  if (!UUID.test(id)) throw new Error('ID de compilacion invalido.');
  const r = await api('listlangs', { id });
  if (r.updateInfo?.ring?.toUpperCase() !== 'RETAIL') throw new Error('Esta compilacion no pertenece al canal Retail.');
  return { items: r.langList.map(code => ({ code, name: r.langFancyNames[code] ?? code })), info: r.updateInfo };
}
export async function editions(id, lang) {
  if (!UUID.test(id) || !/^[a-z]{2}-[a-z]{2}$/i.test(lang)) throw new Error('Idioma o compilacion invalida.');
  const r = await api('listeditions', { id, lang });
  return r.editionList.filter(code => !isEvaluation(code) && !isEvaluation(r.editionFancyNames[code] ?? ''))
    .map(code => ({ code, name: r.editionFancyNames[code] ?? code }));
}
export function validateFile(name, file) {
  if (!/^[a-z0-9_., ()+~\-]+$/i.test(name) || name === '.' || name === '..' || name.endsWith('.')) throw new Error('Nombre de paquete invalido.');
  const size = Number(file.size);
  if (!Number.isSafeInteger(size) || size < 1 || !/^[a-f0-9]{64}$/i.test(file.sha256 ?? '')) {
    throw new Error(`Falta un SHA-256 o tamano valido para ${name}.`);
  }
  const url = validateMicrosoftUrl(file.url);
  return { name, size, sha256: file.sha256.toLowerCase(), url: url.href };
}
export function validateMicrosoftUrl(value) {
  const u = new URL(value);
  const h = u.hostname.toLowerCase();
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.port
      || !(h.endsWith('.dl.delivery.mp.microsoft.com') || h === 'download.windowsupdate.com'
        || h.endsWith('.download.windowsupdate.com') || h === 'download.microsoft.com')) {
    throw new Error('El paquete no apunta a un servidor autorizado de Microsoft.');
  }
  return u;
}
export async function plan(id, lang, edition) {
  if (!UUID.test(id) || !/^[a-z]{2}-[a-z]{2}$/i.test(lang) || !/^[a-z0-9]+$/i.test(edition) || isEvaluation(edition)) {
    throw new Error('Seleccion invalida o edicion Evaluation.');
  }
  await languages(id); // Revalidate Retail in the privileged process, not just the UI.
  const available = await editions(id, lang);
  if (!available.some(e => e.code === edition)) throw new Error('La edicion ya no esta disponible.');
  const r = await api('get', { id, lang, edition });
  let sources = { ...r.files };
  if (r.appxPresent) {
    // Modern Windows separates neutral Store packages from the selected OS edition.
    const apps = await api('get', { id, lang: 'neutral', edition: 'APP' });
    for (const [name, file] of Object.entries(apps.files ?? {})) {
      if (sources[name] && sources[name].sha256 !== file.sha256) throw new Error('Catalogo de apps inconsistente.');
      sources[name] = file;
    }
  }
  const files = Object.entries(sources).map(([name, file]) => validateFile(name, file));
  const names = files.map(f => f.name.toLowerCase());
  if (!files.length || new Set(names).size !== files.length || !files.some(f => /\.esd$/i.test(f.name))) {
    throw new Error('El catalogo no contiene un conjunto completo de paquetes UUP.');
  }
  return { id, lang, edition, title: r.updateName, build: r.build, arch: r.arch,
    appxPresent: !!r.appxPresent, totalBytes: files.reduce((sum, f) => sum + f.size, 0), files };
}
