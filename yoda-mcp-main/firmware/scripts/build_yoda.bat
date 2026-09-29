@echo off
REM Build the Yoda pendant firmware from source (xiaozhi-esp32, board = yoda-pendant).
REM Clears any auto-activated virtualenv, sets up the ESP-IDF env, then builds via release.py.
set "VIRTUAL_ENV="
call "C:\Users\Abhis\esp\esp-idf\export.bat"
cd /d "C:\Users\Abhis\Downloads\Yoda\xiaozhi-esp32"
python scripts\release.py yoda-pendant
echo BUILD_EXIT=%ERRORLEVEL%
