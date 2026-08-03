@echo off
title Earth Explorer - Start All
echo ============================================
echo   Earth Explorer - Start All Services
echo ============================================
echo.

cd /d "%~dp0"

:: Check Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js not found!
    echo Please install Node.js: https://nodejs.org/
    pause
    exit /b 1
)

echo [OK] Node.js found
echo.

:: Start doubao proxy in background
echo [1/2] Starting Doubao Proxy on port 3001...
start "Doubao Proxy" /min node doubao-proxy.js
timeout /t 2 /nobreak >nul

:: Start web server
echo [2/2] Starting Web Server on port 8080...
start "Web Server" /min node web-server.js
timeout /t 2 /nobreak >nul

echo.
echo ============================================
echo   All services started!
echo ============================================
echo.
echo   Doubao Proxy: http://localhost:3001
echo   Web Server:   http://localhost:8080/src/earth.html
echo.
echo Opening browser...
start http://localhost:8080/src/earth.html

echo.
echo Press any key to stop all services...
pause >nul

:: Kill all node processes started by this script
taskkill /FI "WINDOWTITLE eq Doubao Proxy*" /F >nul 2>nul
taskkill /FI "WINDOWTITLE eq Web Server*" /F >nul 2>nul

echo All services stopped.
pause
