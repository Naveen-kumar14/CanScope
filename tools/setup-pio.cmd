@echo off
rem One-time setup of PlatformIO Core for CANScope on Windows (no admin, no PATH change).
rem Installs PlatformIO Core 6.2.0 into C:\canscope-pio\penv and keeps its packages in
rem C:\canscope-pio (a short path: the ESP32 toolchain fails to unpack under long paths).
rem Safe to run again: it only installs what is missing. Needs Python 3 ("py" or "python").
setlocal
set "PIO_HOME=C:\canscope-pio"
set "PIO_EXE=%PIO_HOME%\penv\Scripts\pio.exe"

if exist "%PIO_EXE%" (
  echo PlatformIO already installed: %PIO_EXE%
  goto :version
)

set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY where python >nul 2>nul && set "PY=python"
if not defined PY (
  echo ERROR: Python 3 not found. Install it from https://www.python.org/downloads/ ^(tick "Add python.exe to PATH"^), then run this again.
  exit /b 1
)

echo Creating %PIO_HOME%\penv ...
%PY% -m venv "%PIO_HOME%\penv" || exit /b 1
"%PIO_HOME%\penv\Scripts\python.exe" -m pip install --disable-pip-version-check platformio==6.2.0 || exit /b 1

:version
"%PIO_EXE%" --version || exit /b 1
echo.
echo Next: tools\pio.cmd run -d firmware\node1 -e node1
echo (The first build downloads espressif32@6.12.0 / Arduino-ESP32 2.0.17, about 500 MB.)
endlocal
