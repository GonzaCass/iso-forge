import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { downloadFile } from '../core/download.mjs';
import { normalizeBuilds, validateMicrosoftUrl, validateFile } from '../core/catalog.mjs';
import { assertEdition, parseImages, installImageInListing } from '../core/job.mjs';
import { psQuote } from '../core/tools.mjs';
import { fetchJson } from '../core/http.mjs';

const payload = Buffer.from('Microsoft test payload: complete and hashed.');
const hash = createHash('sha256').update(payload).digest('hex');
const fixture = { name: 'test.esd', size: payload.length, sha256: hash, url: 'https://fixture.invalid/file' };
const checkUrl = url => new URL(url);
async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(), 'iso-forge-test-'));
  t.after(async () => {
    const absolute = resolve(root);
    assert.ok(absolute.startsWith(resolve(tmpdir()) + '\\') || absolute.startsWith(resolve(tmpdir()) + '/'));
    assert.ok(basename(absolute).startsWith('iso-forge-test-'));
    await rm(absolute, { recursive: true, force: true });
  });
  return join(root, fixture.name);
}
test('only complete x64 product builds remain in the catalog', () => {
  const uuid = '28d299dc-8bad-471b-88e7-4fd84e79ac2c';
  const title = 'Feature update to Microsoft server operating system, version 21H2';
  const base = { uuid, title, arch: 'amd64', created: 10, build: '20348.1' };
  const result = normalizeBuilds({ a: base, b: { ...base, title: 'Cumulative Update ' + title },
    c: { ...base, arch: 'arm64' }, d: { ...base, title: 'Preview ' + title },
    e: { ...base, title: 'Feature update to Azure Stack HCI' },
    f: { ...base, title: 'Security Update for Microsoft server operating system (Hotpatch capable)' } }, 'server2022');
  assert.equal(result.length, 1); assert.equal(result[0].title, title);
  assert.equal(normalizeBuilds({ a: { ...base, title: 'Windows Server 2025 (26100.33438)' } }, 'server2025').length, 1);
});
test('Microsoft host validation rejects deceptive domains, credentials and non-http schemes', () => {
  assert.equal(validateMicrosoftUrl('http://tlu.dl.delivery.mp.microsoft.com/file').protocol, 'http:');
  for (const url of ['https://tlu.dl.delivery.mp.microsoft.com.evil.test/file', 'file:///C:/Windows',
    'https://evil.test/file', 'https://user:password@download.microsoft.com/file']) assert.throws(() => validateMicrosoftUrl(url));
});
test('file metadata requires SHA-256, valid sizes and safe names', () => {
  const file = { ...fixture, url: 'http://tlu.dl.delivery.mp.microsoft.com/file' };
  assert.equal(validateFile('ServerStandard_es-es.esd', file).size, payload.length);
  assert.throws(() => validateFile('../file', file));
  assert.throws(() => validateFile('file', { ...file, sha256: '' }));
  assert.throws(() => validateFile('file', { ...file, size: 'NaN' }));
});
test('fresh download validates before final rename', async t => {
  const path = await temporary(t);
  await downloadFile(fixture, path, { checkUrl, fetcher: async () => new Response(payload) });
  assert.deepEqual(await readFile(path), payload);
  await assert.rejects(stat(path + '.part'));
});
test('range resume requests correct offset and reconstructs verified file', async t => {
  const path = await temporary(t); await writeFile(path + '.part', payload.subarray(0, 8));
  await downloadFile(fixture, path, { checkUrl, fetcher: async (_url, options) => {
    assert.equal(options.headers.Range, 'bytes=8-');
    return new Response(payload.subarray(8), { status: 206, headers: { 'Content-Range': `bytes 8-${payload.length - 1}/${payload.length}` } });
  } });
  assert.deepEqual(await readFile(path), payload);
});
test('a server ignoring Range restarts instead of appending duplicate data', async t => {
  const path = await temporary(t); await writeFile(path + '.part', payload.subarray(0, 8));
  await downloadFile(fixture, path, { checkUrl, fetcher: async () => new Response(payload) });
  assert.deepEqual(await readFile(path), payload);
});
test('wrong resume offset fails before writing the partial file', async t => {
  const path = await temporary(t); const initial = payload.subarray(0, 8); await writeFile(path + '.part', initial);
  await assert.rejects(downloadFile(fixture, path, { checkUrl, fetcher: async () => new Response(payload.subarray(8),
    { status: 206, headers: { 'Content-Range': `bytes 4-${payload.length - 1}/${payload.length}` } }) }), /rango incorrecto/);
  assert.deepEqual(await readFile(path + '.part'), initial);
});
test('hash mismatch never leaves a ready file', async t => {
  const path = await temporary(t);
  await assert.rejects(downloadFile({ ...fixture, sha256: '0'.repeat(64) }, path,
    { checkUrl, fetcher: async () => new Response(payload) }), /SHA-256 incorrecto/);
  await assert.rejects(stat(path)); await assert.rejects(stat(path + '.part'));
});
test('incomplete transfer preserves its partial data to resume', async t => {
  const path = await temporary(t);
  await assert.rejects(downloadFile(fixture, path, { checkUrl, fetcher: async () => new Response(payload.subarray(0, 10)) }), /incompleta/);
  assert.equal((await stat(path + '.part')).size, 10); await assert.rejects(stat(path));
});
test('already verified files do not need another network request', async t => {
  const path = await temporary(t); await writeFile(path, payload);
  await downloadFile(fixture, path, { checkUrl, fetcher: async () => { throw new Error('Should not download'); } });
});
test('ESD XML encoding and Evaluation/edition checks are enforced', () => {
  const xml = '<WIM><IMAGE INDEX="1"><NAME>Windows Server Standard</NAME><WINDOWS><EDITIONID>ServerStandard</EDITIONID><INSTALLATIONTYPE>Server</INSTALLATIONTYPE></WINDOWS></IMAGE></WIM>';
  const images = parseImages(Buffer.from('\uFEFF' + xml, 'utf16le'));
  assert.equal(assertEdition(images, 'SERVERSTANDARD', { single: true }).length, 1);
  assert.throws(() => assertEdition(images, 'SERVERDATACENTER'));
  assert.throws(() => assertEdition([{ ...images[0], NAME: 'Windows Server Standard Evaluation' }], 'SERVERSTANDARD'));
});
test('PowerShell literals escape apostrophes without command evaluation', () => {
  assert.equal(psQuote("E:\\Gonza's files\\media"), "'E:\\Gonza''s files\\media'");
});
test('ISO image detection handles Windows separators and uppercase media paths', () => {
  assert.equal(installImageInListing('Path = sources\\install.wim\r\n'), 'install.wim');
  assert.equal(installImageInListing('Path = SOURCES/INSTALL.ESD\n'), 'install.esd');
  assert.throws(() => installImageInListing('Path = sources/install.swm'));
});
test('temporary catalog failures retry but invalid requests fail immediately', async () => {
  let calls = 0;
  const value = await fetchJson('https://api.uupdump.net/test', { delay: async () => {}, fetcher: async () =>
    ++calls < 3 ? new Response('', { status: 522 }) : Response.json({ response: { ok: true } }) });
  assert.equal(calls, 3); assert.equal(value.response.ok, true);
  calls = 0;
  await assert.rejects(fetchJson('https://api.uupdump.net/test', { delay: async () => {}, fetcher: async () => {
    calls++; return new Response('', { status: 400 });
  } }), /HTTP 400/);
  assert.equal(calls, 1);
});
