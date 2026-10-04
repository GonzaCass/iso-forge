const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, session, protocol, net } = require('electron');
const path = require('node:path');
const { readFile, writeFile, mkdir } = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
protocol.registerSchemesAsPrivileged([{ scheme: 'isoforge', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let window, manager, preferences, history = [], allowedDirectories = new Set();
let prefsFile, historyFile;
const LINKS = {
  microsoft: 'https://www.microsoft.com/software-download/',
  catalog: 'https://uupdump.net/',
  design: 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill',
};
const localHost = 'isoforge://app';
function validSender(event) {
  if (event.sender !== window?.webContents || !event.senderFrame?.url.startsWith(localHost + '/')) throw new Error('Origen de solicitud invalido.');
}
function handle(name, action) { ipcMain.handle('forge:' + name, async (event, ...args) => { validSender(event); return action(...args); }); }
const load = async (file, fallback) => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; } };
app.whenReady().then(async () => {
  const data = app.getPath('userData'); await mkdir(data, { recursive: true });
  prefsFile = path.join(data, 'preferences.json'); historyFile = path.join(data, 'history.json');
  preferences = await load(prefsFile, { directory: app.getPath('downloads') });
  history = await load(historyFile, []);
  if (!Array.isArray(history)) history = [];
  allowedDirectories.add(preferences.directory);
  const catalog = await import('../core/catalog.mjs');
  const { JobManager } = await import('../core/job.mjs');
  manager = new JobManager({ cache: path.join(data, 'tools'), emit: state => window?.webContents.send('forge:state', state),
    saveHistory: async result => { history = [result, ...history.filter(h => h.iso !== result.iso)].slice(0, 100);
      await writeFile(historyFile, JSON.stringify(history, null, 2)); } });
  const rendererRoot = path.resolve(__dirname, '../dist');
  protocol.handle('isoforge', request => {
    const u = new URL(request.url);
    const resource = path.resolve(rendererRoot, '.' + decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
    if (u.host !== 'app' || !(resource === rendererRoot || resource.startsWith(rendererRoot + path.sep))) return new Response('', { status: 403 });
    return net.fetch(pathToFileURL(resource).href);
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  window = new BrowserWindow({ width: 1360, height: 920, minWidth: 860, minHeight: 700, show: process.env.ISOFORGE_SMOKE !== '1',
    backgroundColor: '#0f172a', title: 'ISO Forge', icon: path.join(__dirname, '../assets/icon.png'), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(localHost + '/')) event.preventDefault(); });
  window.on('close', event => {
    if (!manager.busy) return;
    event.preventDefault();
    if (['converting', 'verifying'].includes(manager.state.phase)) {
      dialog.showMessageBoxSync(window, { type: 'info', message: 'La ISO se esta creando.', detail: 'Espera a que termine la conversion antes de cerrar la app.' }); return;
    }
    const answer = dialog.showMessageBoxSync(window, { type: 'question', buttons: ['Seguir descargando', 'Pausar y cerrar'], defaultId: 0, cancelId: 0,
      message: 'Hay una descarga en curso.', detail: 'Si la pausas se conservaran los paquetes para reanudar.' });
    if (answer === 1) { manager.pause(); setTimeout(() => { if (!manager.busy) window.destroy(); }, 1500); }
  });
  handle('initialize', () => ({ preferences, history, state: manager.state, version: app.getVersion(), products: catalog.PRODUCTS.map(({ match, ...p }) => p) }));
  handle('builds', id => catalog.builds(id));
  handle('languages', id => catalog.languages(id));
  handle('editions', (id, lang) => catalog.editions(id, lang));
  handle('directory', async () => {
    const result = await dialog.showOpenDialog(window, { title: 'Donde guardar las ISOs', defaultPath: preferences.directory, properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled) return null;
    const directory = result.filePaths[0];
    if (/[!%&|<>^\r\n]/.test(directory)) throw new Error('La carpeta no puede contener ! % & | < > ^.');
    preferences.directory = directory; allowedDirectories.add(directory); await writeFile(prefsFile, JSON.stringify(preferences));
    return directory;
  });
  handle('start', selection => {
    if (!selection || !allowedDirectories.has(selection.directory) || typeof selection.updates !== 'boolean') throw new Error('Elegi primero una carpeta de destino.');
    if (manager.busy) throw new Error('Ya hay una descarga en curso.');
    void manager.start(selection).catch(error => manager.update({ phase: 'error', error: error.message })); return true;
  });
  handle('pause', () => manager.pause());
  handle('open-folder', async folder => {
    const valid = folder === manager.state.folder || history.some(h => path.dirname(h.iso) === folder) || allowedDirectories.has(folder);
    if (!valid) throw new Error('Carpeta desconocida.');
    const error = await shell.openPath(folder); if (error) throw new Error(error);
  });
  handle('copy', value => { if (typeof value !== 'string' || value.length > 4096) throw new Error('Texto invalido.'); clipboard.writeText(value); });
  handle('link', name => { if (!LINKS[name]) throw new Error('Enlace desconocido.'); return shell.openExternal(LINKS[name]); });
  await window.loadURL(localHost + '/index.html');
});
app.on('window-all-closed', () => app.quit());
