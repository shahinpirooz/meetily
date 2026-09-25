@echo off
rem Windows counterpart of scripts/fork/app.sh: run or build the fork.
rem Uses upstream's frontend\dev-gpu.bat / build-gpu.bat, which set up the
rem Visual Studio and LLVM environment, pick GPU features and build the
rem llama-helper sidecar. The fork's updater settings are in
rem frontend\src-tauri\tauri.windows.conf.json, which Tauri merges automatically.
rem
rem   scripts\fork\app.cmd dev      run in development mode
rem   scripts\fork\app.cmd build    installer (.msi and setup .exe)
setlocal
set "MODE=%~1"
if "%MODE%"=="" set "MODE=dev"
cd /d "%~dp0..\..\frontend" || exit /b 1

if not exist "C:\Program Files\LLVM\bin\libclang.dll" (
  echo LLVM not found at C:\Program Files\LLVM. Install it: winget install LLVM.LLVM
  exit /b 1
)
if not exist node_modules (
  call pnpm install --frozen-lockfile || exit /b 1
)

if /i "%MODE%"=="dev" (
  call dev-gpu.bat
) else if /i "%MODE%"=="build" (
  call build-gpu.bat
  if not errorlevel 1 (
    echo.
    echo Installers are in: %~dp0..\..\target\release\bundle\msi and ...\bundle\nsis
  )
) else (
  echo usage: scripts\fork\app.cmd dev^|build
  exit /b 1
)
