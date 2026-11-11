@echo off
rem KK Card Organizer - launcher.  Double click this file.
setlocal
cd /d "%~dp0"

set "PY=%~dp0python\pythonw.exe"
if not exist "%PY%" set "PY=C:\Users\Lenovo\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\pythonw.exe"
if not exist "%PY%" (
  echo.
  echo   Python runtime not found.
  echo   Install Python 3.9+ or put a "python" folder next to this file.
  echo.
  pause
  exit /b 1
)

start "" "%PY%" "%~dp0server.py" --port 8765 --kill --open
exit /b 0
