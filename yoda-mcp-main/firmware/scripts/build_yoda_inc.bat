@echo off
REM Incremental build: reconfigure (re-globs new assets like door/checking.ogg) then build.
REM Avoids release.py's "skip if zip exists" short-circuit.
set "VIRTUAL_ENV="
call "C:\Users\Abhis\esp\esp-idf\export.bat"
cd /d "C:\Users\Abhis\Downloads\Yoda\xiaozhi-esp32"
idf.py reconfigure
idf.py build
echo BUILD_EXIT=%ERRORLEVEL%
