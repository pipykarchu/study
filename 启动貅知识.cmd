@echo off
chcp 65001 >nul
cd /d "%~dp0"
node local\server.mjs
if errorlevel 1 pause
