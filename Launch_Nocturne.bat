@echo off
setlocal
title Nocturne Launcher

echo [1/4] Checking environment...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed. Please install it from https://nodejs.org/
    pause
    exit /b 1
)

cd client

echo [2/4] Verifying dependencies...
if not exist node_modules (
    echo Dependencies missing. Installing...
    cmd /c npm install
)

echo [3/4] Detecting Rust/Cargo (Required for Tauri)...
where cargo >nul 2>nul
if %errorlevel% == 0 (
    echo [SUCCESS] Rust detected. Starting Tauri Desktop app...
    cmd /c npm run tauri dev
) else (
    echo [WARNING] Rust not found. Falling back to Browser Mode...
    echo.
    echo.
    echo.
    start http://localhost:5173
    cmd /c npm run dev
)

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] The application exited with an error code: %errorlevel%
    pause
)

endlocal
