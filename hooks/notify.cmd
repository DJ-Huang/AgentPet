@echo off
setlocal
set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"
"%NODE%" "%~dp0notify.mjs" %*
if errorlevel 1 echo {}
exit /b 0
