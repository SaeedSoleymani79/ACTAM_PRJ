#!/bin/bash
echo "==================================================="
echo "🚀 Checking dependencies for ACTAM Pro..."
echo "==================================================="

# Install dependencies quietly
pip3 install -r requirements.txt --quiet

# Run the Python start script
echo "🎵 Launching the Audio Server..."
python3 start.py