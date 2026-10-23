@echo off
cd /d "%~dp0"
where pythonw.exe >nul 2>nul
if errorlevel 1 (
    echo.
    echo StudyBuddy could not start. Install Python 3 with pythonw.exe available on PATH.
    pause
    exit /b 1
)
start "" pythonw.exe "%~dp0server.py"
