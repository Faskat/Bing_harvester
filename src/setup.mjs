// Ярлык «Bing Harvester» на рабочем столе — открывает окно без консоли.

import path from 'node:path';
import { ROOT } from './lib.mjs';
import { isWindows, findEdge, powershell, psQuote } from './win.mjs';

if (!isWindows) {
  console.log('Ярлык создаётся только в Windows. Запуск: npm start');
  process.exit(0);
}

if (!findEdge()) console.log('⚠ Не найден Microsoft Edge — без него бот не работает: https://www.microsoft.com/edge');

const lnk = await powershell(`
$desktop = [Environment]::GetFolderPath('Desktop')
$s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desktop 'Bing Harvester.lnk'))
$s.TargetPath = Join-Path $env:SystemRoot 'System32\\wscript.exe'
$s.Arguments = '"' + ${psQuote(path.join(ROOT, 'Bing Harvester.vbs'))} + '"'
$s.WorkingDirectory = ${psQuote(ROOT)}
$s.IconLocation = ${psQuote(path.join(ROOT, 'ui', 'icon.ico'))}
$s.Description = 'Bing Harvester — баллы Microsoft Rewards'
$s.Save()
$s.FullName`);

console.log(`Ярлык готов: ${lnk}`);
console.log('Откройте его, нажмите «Войти в Microsoft», а потом «Собрать баллы».');
