import { test, expect } from '@playwright/test';
const id = '28d299dc-8bad-471b-88e7-4fd84e79ac2c';
test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ id }) => {
    let callback: (state: any) => void;
    (window as any).__selection = null;
    (window as any).__emit = (state: any) => callback(state);
    (window as any).forge = {
      initialize: async () => ({ preferences: { directory: 'E:\\ISOs' }, history: [], state: { phase: 'idle', message: 'Listo', logs: [], progress: 0 }, version: '0.1.1' }),
      builds: async () => [{ uuid: id, title: 'Feature update to Microsoft server operating system', build: '20348.5622', arch: 'amd64', created: 1788887002 }],
      languages: async () => ({ items: [{ code: 'es-es', name: 'Spanish' }, { code: 'en-us', name: 'English' }], info: { ring: 'RETAIL' } }),
      editions: async () => [{ code: 'SERVERSTANDARD', name: 'Windows Server Standard' }, { code: 'SERVERSTANDARDCORE', name: 'Windows Server Standard, Core' }],
      chooseDirectory: async () => 'E:\\Media',
      start: async (selection: any) => { (window as any).__selection = selection; callback({ phase: 'downloading', message: 'Descargando de Microsoft', progress: 31,
        downloadedBytes: 1000, totalBytes: 3000, logs: [], file: 'ServerStandard_es-es.esd', fileIndex: 1, fileCount: 6 }); return true; },
      pause: async () => { callback({ phase: 'paused', message: 'Descarga pausada', logs: [], progress: 31 }); return true; },
      openFolder: async () => {}, copy: async () => {}, openLink: async () => {},
      onState: (fn: any) => { callback = fn; return () => {}; },
    };
  }, { id });
});
test('selection, destination, download progress and pause work together', async ({ page }) => {
  await page.goto('/');
  const start = page.getByRole('button', { name: 'Descargar y crear ISO' });
  await expect(start).toBeEnabled();
  await page.getByRole('button', { name: 'Cambiar', exact: true }).click();
  await page.getByLabel('Idioma', { exact: true }).selectOption('en-us');
  await page.getByLabel('Edición', { exact: true }).selectOption('SERVERSTANDARDCORE');
  await page.getByLabel('Integrar actualizaciones').check();
  await start.click();
  expect(await page.evaluate(() => (window as any).__selection)).toEqual({ id, lang: 'en-us', edition: 'SERVERSTANDARDCORE', directory: 'E:\\Media', updates: true });
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '31');
  await page.getByRole('button', { name: 'Pausar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Descarga pausada' })).toBeVisible();
});
test('library and documentation show real empty states and source links', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Imágenes ISO', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sin imágenes registradas' })).toBeVisible();
  await page.getByRole('button', { name: 'Documentación', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Versiones disponibles' })).toBeVisible();
  await expect(page.locator('.help-links').getByRole('button', { name: 'UUP dump', exact: true })).toBeVisible();
});
for (const width of [375, 768, 1360]) {
  test(`catalog has no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); await page.goto('/');
    await expect(page.getByRole('button', { name: 'Descargar y crear ISO' })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `docs/screenshots/catalog-${width}.png`, fullPage: true });
  });
}
