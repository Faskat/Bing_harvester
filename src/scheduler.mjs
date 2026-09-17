// Ежедневный запуск через Планировщик заданий Windows.
// Задача вызывает «Bing Harvester.vbs --scheduled» — бот работает без окна консоли,
// от текущего пользователя и только пока он вошёл в Windows (пароль не нужен).

import path from 'node:path';
import { ROOT } from './lib.mjs';
import { isWindows, powershell, psQuote } from './win.mjs';

export const TASK_NAME = 'BingHarvester';
const RANDOM_DELAY_MIN = 30;

export async function scheduleStatus() {
  if (!isWindows) return { supported: false, installed: false };
  const out = await powershell(`
$t = Get-ScheduledTask -TaskName ${psQuote(TASK_NAME)} -ErrorAction SilentlyContinue
if (-not $t) { '{"installed":false}'; return }
$i = $t | Get-ScheduledTaskInfo
function Stamp($d) { if ($d -and $d.Year -gt 2000) { $d.ToString('o') } else { $null } }
[pscustomobject]@{
  installed = $true
  state = "$($t.State)"
  next = Stamp $i.NextRunTime
  last = Stamp $i.LastRunTime
  time = ([datetime]$t.Triggers[0].StartBoundary).ToString('HH:mm')
} | ConvertTo-Json -Compress`);
  return { supported: true, randomDelay: RANDOM_DELAY_MIN, ...JSON.parse(out) };
}

export async function installSchedule(time) {
  if (!/^\d{2}:\d{2}$/.test(time)) throw new Error(`Неверное время: ${time}`);
  // Из сборки Bing Harvester.exe передаёт свой путь; из исходников запускаем через VBS
  const exe = process.env.BH_LAUNCHER;
  const execute = exe ?? 'wscript.exe';
  const argument = exe ? '--scheduled' : `"${path.join(ROOT, 'Bing Harvester.vbs')}" --scheduled`;
  const workdir = exe ? path.dirname(exe) : ROOT;
  await powershell(`
$action = New-ScheduledTaskAction -Execute ${psQuote(execute)} -Argument ${psQuote(argument)} -WorkingDirectory ${psQuote(workdir)}
$trigger = New-ScheduledTaskTrigger -Daily -At ${psQuote(time)} -RandomDelay (New-TimeSpan -Minutes ${RANDOM_DELAY_MIN})
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2)
Register-ScheduledTask -TaskName ${psQuote(TASK_NAME)} -Action $action -Trigger $trigger -Settings $settings -Description ${psQuote(`Bing Harvester: ежедневные баллы Microsoft Rewards (${ROOT})`)} -Force | Out-Null`);
}

export async function removeSchedule() {
  await powershell(`Unregister-ScheduledTask -TaskName ${psQuote(TASK_NAME)} -Confirm:$false -ErrorAction SilentlyContinue`);
}
