import { mkdir, readFile, writeFile, cp, readdir, stat, open, unlink } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { plan, isEvaluation, UUID } from './catalog.mjs';
import { downloadFile, sha256 } from './download.mjs';
import { prepareTools, exec, powershell, psQuote, CONVERTER_COMMIT } from './tools.mjs';

export function parseImages(buffer) {
  const text = buffer[0] === 0xff || buffer[1] === 0 ? buffer.toString('utf16le') : buffer.toString('utf8');
  const xml = new XMLParser({ ignoreAttributes: false, parseTagValue: false }).parse(text.replace(/^\uFEFF/, ''));
  const images = xml.WIM?.IMAGE;
  return Array.isArray(images) ? images : images ? [images] : [];
}
export function assertEdition(images, requested, { single = false } = {}) {
  const operatingSystems = images.filter(i => i.WINDOWS?.EDITIONID && i.WINDOWS.EDITIONID !== 'WindowsPE');
  if (!operatingSystems.length || operatingSystems.some(i => isEvaluation(i.NAME ?? '') || isEvaluation(i.WINDOWS.EDITIONID))) {
    throw new Error('La imagen contiene una edicion Evaluation o no tiene metadatos verificables.');
  }
  if (!operatingSystems.some(i => i.WINDOWS.EDITIONID.toUpperCase() === requested.toUpperCase())
    || (single && operatingSystems.some(i => i.WINDOWS.EDITIONID.toUpperCase() !== requested.toUpperCase()))) {
    throw new Error('La edicion de la imagen no coincide con tu seleccion.');
  }
  return operatingSystems;
}
export async function verifyBoot(path) {
  const file = await open(path, 'r');
  try {
    let catalogLba;
    for (let sector = 16; sector < 64; sector++) {
      const data = Buffer.alloc(2048); await file.read(data, 0, 2048, sector * 2048);
      if (data.toString('ascii', 1, 6) !== 'CD001') continue;
      if (data[0] === 0 && data.toString('ascii', 7, 30).startsWith('EL TORITO SPECIFICATION')) {
        catalogLba = data.readUInt32LE(71); break;
      }
    }
    if (!catalogLba) throw new Error('La ISO no contiene un catalogo de arranque El Torito.');
    const boot = Buffer.alloc(2048); await file.read(boot, 0, 2048, catalogLba * 2048);
    let checksum = 0; for (let i = 0; i < 32; i += 2) checksum += boot.readUInt16LE(i);
    if (boot[0] !== 1 || boot[30] !== 0x55 || boot[31] !== 0xaa || (checksum & 0xffff) !== 0 || boot[32] !== 0x88) {
      throw new Error('Catalogo de arranque invalido.');
    }
    let uefi = false;
    for (let pos = 64; pos < 2048; pos += 32) {
      if ([0x90, 0x91].includes(boot[pos]) && boot[pos + 1] === 0xef && boot[pos + 32] === 0x88) uefi = true;
    }
    if (!uefi) throw new Error('La ISO no contiene una entrada de arranque UEFI.');
    return { bios: true, uefi: true };
  } finally { await file.close(); }
}

export function installImageInListing(listing) {
  const paths = listing.split(/\r?\n/).filter(line => line.startsWith('Path = '))
    .map(line => line.slice(7).replaceAll('\\', '/').toLowerCase());
  if (paths.includes('sources/install.wim')) return 'install.wim';
  if (paths.includes('sources/install.esd')) return 'install.esd';
  throw new Error('La ISO no contiene una imagen de instalacion reconocida.');
}

export class JobManager {
  constructor({ cache, emit, saveHistory }) {
    this.cache = cache; this.emit = emit; this.saveHistory = saveHistory;
    this.state = { phase: 'idle', message: 'Listo para empezar', progress: 0, logs: [] };
  }
  update(patch) { this.state = { ...this.state, ...patch }; this.emit(this.state); }
  log(message) { this.update({ message, logs: [...this.state.logs.slice(-149), { time: new Date().toISOString(), message }] }); }
  pause() {
    if (!['planning', 'tools', 'downloading', 'checking'].includes(this.state.phase)) return false;
    this.controller?.abort(); return true;
  }
  async start(selection) {
    if (this.busy) throw new Error('Ya hay una tarea en curso.');
    if (process.platform !== 'win32') throw new Error('La conversion requiere Windows 10/11 o Server compatible.');
    if (!UUID.test(selection.id) || !/^[a-z]{2}-[a-z]{2}$/i.test(selection.lang)
      || !/^[a-z0-9]+$/i.test(selection.edition) || isEvaluation(selection.edition)) throw new Error('Seleccion invalida.');
    if (!selection.directory || /[!%&|<>^\r\n]/.test(selection.directory)) {
      throw new Error('Elegi una carpeta sin caracteres ! % & | < > ^ para las herramientas de Windows.');
    }
    this.busy = true; this.controller = new AbortController();
    const signal = this.controller.signal;
    this.update({ phase: 'planning', progress: 0, logs: [], selection, error: undefined, result: undefined });
    try {
      this.log('Consultando enlaces actualizados del catalogo Retail...');
      const catalog = await plan(selection.id, selection.lang, selection.edition);
      signal.throwIfAborted();
      const folder = resolve(selection.directory, `ISOForge-${selection.id}-${selection.lang}-${selection.edition}`);
      const uups = join(folder, 'UUPs');
      await mkdir(folder, { recursive: true });
      const marker = join(folder, 'iso-forge-project.json');
      const existing = await readFile(marker, 'utf8').catch(() => null);
      if (!existing && (await readdir(folder)).length) throw new Error('La carpeta de trabajo ya contiene archivos ajenos a ISO Forge.');
      if (existing && JSON.parse(existing).id !== selection.id) throw new Error('Carpeta de trabajo incompatible.');
      await writeFile(marker, JSON.stringify({ id: selection.id, lang: selection.lang, edition: selection.edition, converter: CONVERTER_COMMIT }, null, 2));
      await mkdir(uups, { recursive: true });
      // Signed Microsoft URLs expire and must never be committed to a repository or history.
      await writeFile(join(folder, 'paquetes-verificados.json'), JSON.stringify({ ...catalog, files: catalog.files.map(({ url, ...file }) => file) }, null, 2));
      this.update({ phase: 'tools', folder, totalBytes: catalog.totalBytes });
      const tools = await prepareTools(this.cache, message => this.log(message), signal);
      let completed = 0, lastTick = 0;
      this.update({ phase: 'downloading', progress: 0, downloadedBytes: 0 });
      this.log(`Descargando ${catalog.files.length} paquetes desde Microsoft...`);
      for (let index = 0; index < catalog.files.length; index++) {
        const file = catalog.files[index];
        this.update({ file: file.name, fileIndex: index + 1, fileCount: catalog.files.length });
        await downloadFile(file, join(uups, file.name), { signal, onProgress: count => {
          if (Date.now() - lastTick > 200 || count === file.size) {
            lastTick = Date.now(); const downloadedBytes = completed + count;
            this.update({ downloadedBytes, progress: downloadedBytes / catalog.totalBytes * 100 });
          }
        } });
        completed += file.size;
        this.log(`SHA-256 verificado: ${file.name}`);
      }
      this.update({ phase: 'checking', progress: 100 });
      const metadataFile = catalog.files.find(f => f.name.toLowerCase() === `${selection.edition}_${selection.lang}.esd`.toLowerCase());
      if (!metadataFile) throw new Error('Este conjunto no tiene una imagen de edicion reconocida; se conservaron los paquetes sin convertir.');
      const wimlib = join(tools, 'bin', 'bin64', 'wimlib-imagex.exe');
      const sourceXml = join(folder, 'imagen-origen.xml');
      await exec(wimlib, ['info', join(uups, metadataFile.name), '--extract-xml', sourceXml], { signal });
      assertEdition(parseImages(await readFile(sourceXml)), selection.edition);
      signal.throwIfAborted();
      await cp(tools, folder, { recursive: true, force: true });
      await writeFile(join(folder, 'ConvertConfig.ini'),
        `[convert-UUP]\nAutoStart=1\nAutoExit=1\nAddUpdates=${selection.updates ? 1 : 0}\nCleanup=0\nResetBase=0\nNetFx3=0\nStartVirtual=0\nSkipApps=0\nAppsLevel=0\nSkipWinRE=0\nForceDism=0\nvDeleteSource=0\n`);
      const instructions = `ISO Forge: ${catalog.title}\nEdicion: ${selection.edition}; idioma: ${selection.lang}; x64.\n` +
        `Paquetes de Microsoft con SHA-256 verificados. No se incluyen activadores ni claves.\n` +
        `Integrar actualizaciones: ${selection.updates ? 'si' : 'no (imagen base; Windows Update despues de instalar)'}\n` +
        `Para repetir: ejecutar convert-UUP.cmd como administrador en esta carpeta.\n` +
        `No borrar UUPs si queres reanudar o repetir. El conversor trabaja en esta carpeta.\n`;
      await writeFile(join(folder, 'LEEME.txt'), instructions, 'utf8');
      const previousIsos = new Map(await Promise.all((await readdir(folder)).filter(n => /\.iso$/i.test(n)).map(async name => [name, (await stat(join(folder, name))).mtimeMs])));
      this.update({ phase: 'converting', progress: undefined });
      this.log('Paquetes verificados. Preparando la conversion...');
      const converter = join(folder, 'convert-UUP.cmd');
      // A pinned mature UUP converter handles reference ESDs, enablement packages and Store apps.
      // UAC stays with Windows; this process never requests or stores an administrator password.
      if (selection.edition === 'SERVERSTANDARD' && String(catalog.build).startsWith('20348.') && !selection.updates && !catalog.appxPresent) {
        const { createServer2022 } = await import('./server2022.mjs');
        await createServer2022({ esd: join(uups, metadataFile.name), tools, folder, lang: selection.lang, log: message => this.log(message) });
      } else {
        this.log('Acepta la solicitud de administrador de Windows para crear la ISO.');
        await powershell(`$ErrorActionPreference='Stop'; $p=Start-Process -FilePath ${psQuote(converter)} -WorkingDirectory ${psQuote(folder)} -Verb RunAs -WindowStyle Hidden -Wait -PassThru; if($p.ExitCode -ne 0){throw ('Conversion fallo: '+$p.ExitCode)}`);
      }
      this.update({ phase: 'verifying', progress: undefined });
      this.log('Comprobando la ISO generada, su edicion y las entradas de arranque...');
      const candidates = [];
      for (const name of await readdir(folder)) {
        if (/\.iso$/i.test(name)) { const s = await stat(join(folder, name));
          if (s.size > 100 * 1024 * 1024 && s.mtimeMs !== previousIsos.get(name)) candidates.push({ name, mtime: s.mtimeMs }); }
      }
      candidates.sort((a, b) => b.mtime - a.mtime);
      if (!candidates.length) throw new Error('El conversor no produjo una ISO nueva. Revisa el log en la carpeta de trabajo.');
      const iso = join(folder, candidates[0].name);
      const boot = await verifyBoot(iso);
      const sevenZip = join(folder, 'bin', '7z.exe');
      const listing = await exec(sevenZip, ['l', '-slt', iso]);
      const embedded = installImageInListing(listing);
      const verifyDir = join(folder, 'verificacion-' + Date.now());
      await exec(sevenZip, ['e', iso, `sources/${embedded}`, `-o${verifyDir}`, '-y']);
      const install = join(verifyDir, embedded);
      if (!await stat(install).catch(() => null)) throw new Error('La ISO no contiene una imagen de instalacion verificable.');
      await exec(wimlib, ['verify', install]);
      const installXml = join(folder, 'imagen-final.xml');
      await exec(wimlib, ['info', install, '--extract-xml', installXml]);
      const images = assertEdition(parseImages(await readFile(installXml)), selection.edition, { single: true });
      await unlink(install); // Only the known temporary extracted WIM is removed, never the downloaded sources.
      const digest = await sha256(iso);
      const result = { iso, sha256: digest, bytes: (await stat(iso)).size, edition: selection.edition,
        lang: selection.lang, catalogBuild: catalog.build, images: images.map(i => ({ name: i.NAME,
          edition: i.WINDOWS.EDITIONID, type: i.WINDOWS.INSTALLATIONTYPE, version: i.WINDOWS.VERSION })),
        updatesRequested: !!selection.updates, boot, created: new Date().toISOString(),
        bootTest: 'No se realizo un arranque en VM.' };
      await writeFile(iso + '.sha256.txt', `${digest}  ${candidates[0].name}\n`);
      await writeFile(join(folder, 'resultado.json'), JSON.stringify(result, null, 2));
      await this.saveHistory(result);
      this.update({ phase: 'complete', progress: 100, result });
      this.log('ISO lista. SHA-256 e imagen de instalacion verificados.');
    } catch (error) {
      const paused = signal.aborted;
      this.update({ phase: paused ? 'paused' : 'error', error: paused ? undefined : error.message });
      this.log(paused ? 'Descarga pausada. Se conservan los paquetes para reanudar.' : error.message);
    } finally { this.busy = false; }
  }
}
