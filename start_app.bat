@echo off
REM Workflow App Launcher for Windows
REM Quick start script for debugging the Electron application

echo Starting Workflow App...
echo ============================

REM Check if we're in the right directory
if not exist "package.json" (
    echo Error: Please run this script from the project root directory
    echo    (where package.json and main.js are located)
    pause
    exit /b 1
)

if not exist "main.js" (
    echo Error: main.js not found in current directory
    pause
    exit /b 1
)

REM Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo Error: Node.js is not installed
    pause
    exit /b 1
)

REM Check if Python is installed
where python >nul 2>nul
if %errorlevel% neq 0 (
    where python3 >nul 2>nul
    if %errorlevel% neq 0 (
        echo Error: Python is not installed
        pause
        exit /b 1
    )
)

REM Check if node_modules exists
if not exist "node_modules" (
    echo Installing dependencies...
    npm install
    if %errorlevel% neq 0 (
        echo Error: Failed to install dependencies
        pause
        exit /b 1
    )
)

echo Environment check passed
echo Starting Electron application...
echo.

REM Start the application
npm start

echo.
echo Application stopped
pause
