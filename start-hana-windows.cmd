@echo off
setlocal
pushd "%~dp0"

where node >nul 2>&1
if errorlevel 1 goto :missing_node

where npm >nul 2>&1
if errorlevel 1 goto :missing_node

if not exist "node_modules\electron\dist\electron.exe" (
  echo Installing Hana dependencies...
  call npm install
  if errorlevel 1 goto :failed
)

echo Starting Hana...
call npm start
set "hana_exit_code=%errorlevel%"
if not "%hana_exit_code%"=="0" pause
popd
exit /b %hana_exit_code%

:missing_node
echo Node.js is required. Install it from https://nodejs.org/ and try again.
pause
popd
exit /b 1

:failed
echo Hana could not be started.
pause
popd
exit /b 1
