@echo off
rem Runs the CANScope PlatformIO Core (installed by tools\setup-pio.cmd) without it being on PATH.
rem Usage (from the repository root, Command Prompt or PowerShell):
rem   tools\pio.cmd run -d firmware\node1 -e node1
rem   tools\pio.cmd run -d firmware\node1 -e node1 -t upload --upload-port COM5
rem   tools\pio.cmd device list
rem   tools\pio.cmd device monitor -d firmware\node1 --port COM5
setlocal
set "PLATFORMIO_CORE_DIR=C:\canscope-pio"
set "PIO_EXE=C:\canscope-pio\penv\Scripts\pio.exe"
if not exist "%PIO_EXE%" (
  echo PlatformIO Core not found at %PIO_EXE%. Run tools\setup-pio.cmd first.
  exit /b 1
)
"%PIO_EXE%" %*
exit /b %ERRORLEVEL%
