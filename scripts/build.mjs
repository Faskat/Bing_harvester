// Портативная сборка для Windows: dist/Bing Harvester/ с «Bing Harvester.exe» и встроенным Node.js,
// плюс zip для релиза на GitHub. Ставить Node.js пользователю не нужно, Edge уже есть в Windows.
//   node scripts/build.mjs

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const DIST = path.join(ROOT, 'dist');
const APP = path.join(DIST, 'Bing Harvester');
const ZIP = path.join(DIST, `BingHarvester-${version}-win-x64.zip`);
const WINDIR = process.env.WINDIR ?? 'C:\\Windows';

const step = text => console.log(`• ${text}`);
const sizeMb = p => {
  const stat = fs.statSync(p);
  const bytes = stat.isDirectory()
    ? fs.readdirSync(p, { recursive: true }).reduce((sum, f) => {
      const s = fs.statSync(path.join(p, f));
      return s.isFile() ? sum + s.size : sum;
    }, 0)
    : stat.size;
  return (bytes / 1024 / 1024).toFixed(1);
};

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Собирать нужно на Windows x64');
const csc = path.join(WINDIR, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
if (!fs.existsSync(csc)) throw new Error(`Не найден компилятор C#: ${csc}`);
const playwright = path.join(ROOT, 'node_modules', 'playwright-core');
if (!fs.existsSync(playwright)) throw new Error('Сначала выполните npm install');

step('очищаю dist/');
fs.rmSync(APP, { recursive: true, force: true });
fs.rmSync(ZIP, { force: true });
fs.mkdirSync(APP, { recursive: true });

step('копирую приложение');
for (const item of ['src', 'ui', 'package.json', 'LICENSE', 'README.md']) {
  fs.cpSync(path.join(ROOT, item), path.join(APP, item), { recursive: true });
}
// Ярлык на рабочий стол делает install.cmd для версии из исходников; в сборке он не нужен
fs.rmSync(path.join(APP, 'src', 'setup.mjs'), { force: true });
fs.cpSync(playwright, path.join(APP, 'node_modules', 'playwright-core'), { recursive: true });

step(`встраиваю Node.js ${process.version}`);
const runtime = path.join(APP, 'runtime');
fs.mkdirSync(runtime);
fs.copyFileSync(process.execPath, path.join(runtime, 'node.exe'));
const nodeLicense = path.join(path.dirname(process.execPath), 'LICENSE');
if (fs.existsSync(nodeLicense)) {
  fs.copyFileSync(nodeLicense, path.join(runtime, 'LICENSE'));
} else {
  // Установщик Node.js кладёт лицензию не всегда — без неё распространять node.exe нельзя, поэтому пишем MIT-текст сами
  fs.writeFileSync(path.join(runtime, 'LICENSE'), `Node.js ${process.version}
Full license, including bundled third-party components: https://github.com/nodejs/node/blob/${process.version}/LICENSE

Copyright Node.js contributors. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to
deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
IN THE SOFTWARE.
`);
}

step('собираю Bing Harvester.exe');
const info = path.join(DIST, 'AssemblyInfo.cs');
fs.writeFileSync(info, [
  'using System.Reflection;',
  '[assembly: AssemblyTitle("Bing Harvester")]',
  '[assembly: AssemblyProduct("Bing Harvester")]',
  '[assembly: AssemblyDescription("Microsoft Rewards helper")]',
  `[assembly: AssemblyVersion("${version}.0")]`,
  `[assembly: AssemblyFileVersion("${version}.0")]`,
].join('\n'));
try {
  execFileSync(csc, [
    '/nologo', '/target:winexe', '/optimize+', '/codepage:65001',
    `/win32icon:${path.join(ROOT, 'ui', 'icon.ico')}`,
    '/r:System.Windows.Forms.dll',
    `/out:${path.join(APP, 'Bing Harvester.exe')}`,
    path.join(ROOT, 'launcher', 'BingHarvester.cs'),
    info,
  ], { stdio: 'inherit' });
} finally {
  fs.rmSync(info, { force: true });
}

step('упаковываю zip');
execFileSync(path.join(WINDIR, 'System32', 'tar.exe'), ['-a', '-c', '-f', ZIP, '-C', DIST, 'Bing Harvester'], { stdio: 'inherit' });

console.log(`\nГотово:\n  ${APP} (${sizeMb(APP)} МБ)\n  ${ZIP} (${sizeMb(ZIP)} МБ)`);
