@echo off
title ACTAM Pro Audio Suite Launcher
echo ===================================================
echo 🚀 Checking dependencies for ACTAM Pro...
echo ===================================================

REM Install dependencies quietly from requirements.txt
pip install -r requirements.txt --quiet

REM Run the Python start script
echo 🎵 Launching the Audio Server...
python start.py

pause