// Windows: поиск Edge и запуск PowerShell без окна и без проблем с кавычками.

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

export const isWindows = process.platform === 'win32';

export function findEdge() {
  const bases = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
  return bases.map(b => path.join(b, 'Microsoft', 'Edge', 'Application', 'msedge.exe')).find(p => fs.existsSync(p)) ?? null;
}

export const psQuote = s => `'${String(s).replace(/'/g, "''")}'`;

// Ошибки PowerShell при перенаправлении приходят в CLIXML — достаём из него текст
function psError(stderr = '') {
  const xml = [...stderr.matchAll(/<S S="Error">([^<]*)<\/S>/g)]
    .map(m => m[1].replace(/_x000D__x000A_/g, ' ')).join('').trim();
  return (xml || stderr.replace(/^#< CLIXML.*$/gm, '')).trim().split(/\r?\n/)[0];
}

// Скрипт уходит через -EncodedCommand: пути с пробелами и кириллицей не ломаются
export function powershell(script, { timeout = 30_000 } = {}) {
  const full = `$ErrorActionPreference = 'Stop'\n$ProgressPreference = 'SilentlyContinue'\n` +
    `[Console]::OutputEncoding = [Text.Encoding]::UTF8\n${script}`;
  const encoded = Buffer.from(full, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout, encoding: 'utf8' },
      (err, stdout, stderr) => (err ? reject(new Error(psError(stderr) || err.message)) : resolve(stdout.trim())));
  });
}
