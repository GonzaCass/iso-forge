// File-only conversion for the complete Server 2022 Standard ESD layout.
// Other layouts use the pinned upstream UUP converter instead.
import { mkdir, copyFile, cp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exec } from './tools.mjs';
import { parseImages, assertEdition } from './job.mjs';
export async function createServer2022({ esd, tools, folder, lang, log = () => {} }) {
  const id = Date.now();
  const work = join(folder, 'medio-server2022-' + id);
  const media = join(work, 'media'), sources = join(media, 'sources');
  await mkdir(work, { recursive: true });
  const wimlib = join(tools, 'bin', 'bin64', 'wimlib-imagex.exe');
  const reg = join(tools, 'bin', 'offlinereg.exe');
  const run = (...args) => exec(wimlib, args);
  const xmlPath = join(work, 'source.xml');
  await run('info', esd, '--extract-xml', xmlPath);
  const images = parseImages(await readFile(xmlPath));
  const os = assertEdition(images, 'SERVERSTANDARD', { single: true })[0];
  const layout = images.find(i => /Setup Media/i.test(i.NAME));
  const pe = images.find(i => i.WINDOWS?.EDITIONID === 'WindowsPE');
  if (images.length !== 3 || !layout || !pe || os.WINDOWS.VERSION.BUILD !== '20348'
      || os.WINDOWS.INSTALLATIONTYPE !== 'Server') throw new Error('Layout de Server 2022 no compatible con conversion sin administrador.');
  log('Extrayendo el medio de Server 2022 (sin administrador)...');
  await mkdir(media); await run('apply', esd, layout['@_INDEX'], media, '--no-acls', '--no-attributes');
  const winre = join(work, 'winre.wim'), boot = join(sources, 'boot.wim');
  await run('export', esd, pe['@_INDEX'], winre, '--compress=LZX', '--threads=4', '--check', '--boot');
  await copyFile(winre, boot);
  await run('info', boot, '1', 'Microsoft Windows PE (x64)', 'Microsoft Windows PE (x64)', '--image-property', 'FLAGS=9');
  async function update(index, commands) {
    for (const command of commands) await run('update', boot, String(index), '--command=' + command);
  }
  async function hive(index, setup) {
    const dest = join(work, 'hive-' + index); await mkdir(dest);
    await run('extract', boot, String(index), 'Windows/System32/config/SOFTWARE', '--dest-dir=' + dest, '--no-acls', '--no-attributes');
    const original = join(dest, 'SOFTWARE'), modified = original + '.new';
    const key = 'Microsoft\\Windows NT\\CurrentVersion\\WinPE';
    const change = (path, key, verb, ...args) => exec(reg, [path, key, verb, ...args]);
    if (setup) await copyFile(original, modified);
    else {
      await change(original, 'Microsoft\\Windows NT\\CurrentVersion', 'setvalue', 'SystemRoot', 'X:\\$windows.~bt\\Windows');
      await change(modified, key, 'setvalue', 'InstRoot', 'X:\\$windows.~bt\\');
    }
    await change(modified, key, 'setvalue', 'CustomBackground', '%SystemRoot%\\System32\\' + (setup ? 'setup.bmp' : 'winre.jpg'), '2');
    await change(modified, key, 'deletevalue', 'CustomShell');
    return modified;
  }
  await update(1, ["delete '\\Windows\\system32\\winpeshl.ini'",
    `add '${await hive(1, false)}' '\\Windows\\System32\\config\\SOFTWARE'`]);
  await run('export', winre, '1', boot, 'Microsoft Windows Setup (x64)', 'Microsoft Windows Setup (x64)', '--boot', '--check');
  const commands = ["delete '\\Windows\\system32\\winpeshl.ini'",
    `add '${join(media, 'setup.exe')}' '\\setup.exe'`,
    `add '${join(sources, 'inf', 'setup.cfg')}' '\\sources\\inf\\setup.cfg'`,
    `add '${await hive(2, true)}' '\\Windows\\System32\\config\\SOFTWARE'`];
  await run('extract', esd, os['@_INDEX'], 'Windows/system32/xmllite.dll', '--dest-dir=' + sources, '--no-acls', '--no-attributes');
  for (const [list, prefix] of [['bootwim.txt', ''], ['bootmui.txt', lang + '\\']]) {
    for (const name of (await readFile(join(tools, 'bin', list), 'utf8')).trim().split(/\r?\n/)) {
      const source = join(sources, prefix, name);
      if (await readFile(source).then(() => true).catch(() => false)) commands.push(`add '${source}' '\\sources\\${prefix}${name}'`);
    }
  }
  for (const name of ['background_svr.bmp', 'background_svr.png', 'background_cli.bmp']) {
    const source = join(sources, name);
    if (await readFile(source).then(() => true).catch(() => false)) {
      for (const target of ['\\sources\\background.bmp', '\\Windows\\system32\\setup.bmp', '\\Windows\\system32\\winpe.jpg', '\\Windows\\system32\\winre.jpg']) commands.push(`add '${source}' '${target}'`);
      await update(1, [`add '${source}' '\\Windows\\system32\\winpe.jpg'`, `add '${source}' '\\Windows\\system32\\winre.jpg'`]); break;
    }
  }
  await update(2, commands); await run('info', boot, '2', '--image-property', 'FLAGS=2', '--boot');
  await run('extract', esd, os['@_INDEX'], 'Windows/Boot/Fonts/*', '--dest-dir=' + join(media, 'boot', 'fonts'), '--no-acls', '--no-attributes');
  await cp(join(media, 'boot', 'fonts'), join(media, 'efi', 'microsoft', 'boot', 'fonts'), { recursive: true });
  log('Comprimiendo Windows Server 2022 Standard con escritorio...');
  const install = join(sources, 'install.wim');
  await run('export', esd, os['@_INDEX'], install, '--compress=LZX', '--threads=4', '--check');
  await run('update', install, '1', `--command=add '${winre}' '\\Windows\\System32\\Recovery\\winre.wim'`);
  await run('verify', boot); await run('verify', install);
  const iso = join(folder, `Windows_Server_2022_Standard_Desktop_x64_${lang}-${id}.iso`);
  log('Creando el archivo ISO con arranque BIOS y UEFI...');
  await exec(join(tools, 'bin', 'cdimage.exe'), ['-m', '-o', '-u2', '-udfver102', '-lSERVER2022_STANDARD',
    `-bootdata:2#p0,e,b${join(media, 'boot', 'etfsboot.com')}#pEF,e,b${join(media, 'efi', 'microsoft', 'boot', 'efisys.bin')}`, media, iso]);
  await writeFile(join(work, 'conversion-completa.json'), JSON.stringify({ iso, name: os.NAME, version: os.WINDOWS.VERSION }, null, 2));
  return iso;
}
