@echo off
title Earth Explorer - Start Server

echo ============================================
echo   Earth Explorer - Start Local Server
echo ============================================
echo.

cd /d "%~dp0"

:: Try Python first
where python >nul 2>nul
if %ERRORLEVEL%==0 (
    echo [OK] Found Python, starting server...
    echo.
    echo Server URL: http://localhost:8080/src/earth.html
    echo.
    echo Press Ctrl+C to stop the server
    echo.
    start http://localhost:8080/src/earth.html
    python -m http.server 8080
    goto :eof
)

:: Try Node.js
where node >nul 2>nul
if %ERRORLEVEL%==0 (
    echo [OK] Found Node.js, starting server...
    echo.
    echo Server URL: http://localhost:8080/src/earth.html
    echo.
    echo Press Ctrl+C to stop the server
    echo.
    start http://localhost:8080/src/earth.html
    node web-server.js
    goto :eof
)

:: Try npx http-server
where npx >nul 2>nul
if %ERRORLEVEL%==0 (
    echo [OK] Found npx, starting http-server...
    echo.
    echo Server URL: http://localhost:8080/src/earth.html
    echo.
    echo Press Ctrl+C to stop the server
    echo.
    start http://localhost:8080/src/earth.html
    npx --yes http-server -p 8080 -c-1
    goto :eof
)

echo [ERROR] Python or Node.js not found!
echo.
echo Please install one of them:
echo.
echo   Python: https://www.python.org/downloads/
echo   Node.js: https://nodejs.org/
echo.
pause
