@echo off
rem KKS Card Organizer - launcher.  Double click this file.
setlocal
cd /d "%~dp0"

set "PY="
if exist "%~dp0python\pythonw.exe" set "PY=%~dp0python\pythonw.exe"
if not defined PY if exist "%~dp0python\python.exe" set "PY=%~dp0python\python.exe"
if not defined PY for /f "delims=" %%p in ('where pythonw 2^>nul ^| findstr /v /i WindowsApps') do if not defined PY set "PY=%%p"
if not defined PY for /f "delims=" %%p in ('where python 2^>nul ^| findstr /v /i WindowsApps') do if not defined PY set "PY=%%p"
if not defined PY if exist "C:\Users\Lenovo\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\pythonw.exe" set "PY=C:\Users\Lenovo\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\pythonw.exe"

if not defined PY goto :nopython

echo.
echo   Starting KKS Card Organizer...
start "" "%PY%" "%~dp0server.py" --port 8765 --kill --open --browser auto >nul 2>&1

rem wait up to ~15s for the local server to accept a connection
for /l %%i in (1,1,15) do (
  ping -n 2 127.0.0.1 >nul
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try{$c=New-Object Net.Sockets.TcpClient;$c.Connect('127.0.0.1',8765);$c.Close();exit 0}catch{exit 1}" >nul 2>&1 && goto :ok
)

echo.
echo   The local server did not start within 15 seconds.
echo   Last lines of the log:
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "if(Test-Path '%~dp0logs\kkcard.log'){Get-Content '%~dp0logs\kkcard.log' -Tail 15}"
echo.
echo   Log file: %~dp0logs\kkcard.log
echo.
timeout /t 30
exit /b 1

:ok
exit /b 0

:nopython
echo.
echo   Python 3.9+ not found.
echo   Install Python from python.org, or put a "python" folder next to this file.
echo.
timeout /t 30
exit /b 1