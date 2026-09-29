@echo off
REM Flash the freshly-built Yoda firmware to the XIAO on COM5.
REM Uses idf.py flash (individual bins from the latest incremental build), not the merged image.
set "VIRTUAL_ENV="
call "C:\Users\Abhis\esp\esp-idf\export.bat"
cd /d "C:\Users\Abhis\Downloads\Yoda\xiaozhi-esp32"
idf.py -p COM5 flash
echo FLASH_EXIT=%ERRORLEVEL%
