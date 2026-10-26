@echo off
chcp 65001 >nul
title Trade Gunlugu - Guncelle
setlocal

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-app.ps1" -SourceRoot "%~dp0.."
if errorlevel 1 (
  echo HATA: Guncelleme tamamlanamadi. Onceki surum korundu.
  pause
  exit /b 1
)
echo Trade Gunlugu guncellendi. Exe dosyasi degismedi.
pause
exit /b 0
