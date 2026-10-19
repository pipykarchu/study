@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0local\bridge-start.ps1"
if errorlevel 1 (
  echo 云端会员连接启动失败，请回到 Codex 检查配置。
  pause
) else (
  echo 会员连接已在后台运行。使用网页时，请保持本机开机、联网并登录你自己的 Codex。
  timeout /t 5 >nul
)
