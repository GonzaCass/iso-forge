import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const env = { ...process.env, ISOFORGE_SMOKE: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.argv[2];
const application = await electron.launch({ executablePath, args: executablePath ? [] : ['.'], env });
try {
  const page = await application.firstWindow();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.waitForURL('isoforge://app/index.html');
  await page.getByRole('button', { name: 'Descargar y crear ISO' }).waitFor({ state: 'visible' });
  const initial = await page.evaluate(() => window.forge.initialize());
  assert.equal(initial.version, '0.1.0');
  assert.equal(await page.evaluate(() => typeof require), 'undefined');
  const editions = await page.evaluate(() => window.forge.editions('28d299dc-8bad-471b-88e7-4fd84e79ac2c', 'es-es'));
  assert.ok(editions.some(e => e.code === 'SERVERSTANDARD'));
  assert.ok(editions.every(e => !/eval/i.test(e.code)));
  await page.getByRole('button', { name: 'Descargar y crear ISO' }).waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('.summary .primary').disabled, undefined, { timeout: 160000 });
  await mkdir('.cache', { recursive: true });
  if (!executablePath) await page.screenshot({ path: '.cache/live-desktop.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ desktop: 'OK', packaged: !!executablePath, isolatedRenderer: true, liveCatalog: true, fullStandardEdition: true }));
} finally { await application.close(); }
