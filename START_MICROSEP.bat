@echo off
title MICROSEP Control Panel
color 0A
echo.
echo  ========================================
echo   MICROSEP - Starting Control Panel...
echo  ========================================
echo.

:: Try Python first
where python >nul 2>&1
if %errorlevel%==0 (
    echo  [OK] Python found. Starting server...
    echo  Opening browser in 2 seconds...
    echo.
    start /b cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3000"
    python -m http.server 3000
    if %errorlevel% neq 0 (
        echo.
        echo  ERROR: Server failed to start. Port 3000 may be in use.
        echo  Close any other MICROSEP windows and try again.
        echo.
        pause
    )
    goto :eof
)

:: Try Python3
where python3 >nul 2>&1
if %errorlevel%==0 (
    echo  [OK] Python3 found. Starting server...
    start /b cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3000"
    python3 -m http.server 3000
    goto :eof
)

:: Fallback: PowerShell server
echo  [INFO] Python not found. Starting PowerShell server...
echo.
echo  If you see a security warning, click "Run Anyway" or "Allow".
echo.
start /b cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3000"
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0server.ps1"

if %errorlevel% neq 0 (
    echo.
    echo  ========================================
    echo   ERROR: Could not start the server!
    echo  ========================================
    echo.
    echo  Possible fixes:
    echo    1. Right-click START_MICROSEP.bat and
    echo       choose "Run as administrator"
    echo.
    echo    2. If antivirus blocked it, add an
    echo       exception for this folder
    echo.
    echo    3. Install Python from python.org
    echo       then try again
    echo.
    pause
)
