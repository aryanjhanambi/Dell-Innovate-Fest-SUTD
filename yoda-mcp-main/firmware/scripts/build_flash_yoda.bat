@echo off
REM Build (incremental) then flash to COM5 in one shot. Stops if the build fails.
set "VIRTUAL_ENV="
call "C:\Users\Abhis\esp\esp-idf\export.bat"
cd /d "C:\Users\Abhis\Downloads\Yoda\xiaozhi-esp32"
idf.py build
if errorlevel 1 ( echo BUILD_FAILED & exit /b 1 )
idf.py -p COM5 flash
echo DONE_EXIT=%ERRORLEVEL%
