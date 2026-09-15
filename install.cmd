@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Bing Harvester — установка

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Нужен Node.js 20 или новее. Скачайте LTS-версию: https://nodejs.org/
  echo После установки запустите install.cmd ещё раз.
  echo.
  pause
  exit /b 1
)

echo Устанавливаю зависимости...
call npm install --omit=dev
if errorlevel 1 (
  echo Не получилось установить зависимости — ошибка выше.
  pause
  exit /b 1
)

node src\setup.mjs
echo.
pause
