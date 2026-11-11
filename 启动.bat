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

if not defined PY (
  echo.
  echo   Python 3.9+ not found.
  echo   Install Python from python.org, or put a "python" folder next to this file.
  echo.
  pause
  exit /b 1
)

start "" "%PY%" "%~dp0server.py" --port 8765 --kill --open
exit /b 0