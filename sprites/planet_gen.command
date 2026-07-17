#!/bin/bash
cd "$(dirname "$0")"
echo "=== Planet Sprite Generator ==="
echo "Working dir: $(pwd)"
python3 planet_gen.py
echo ""
echo "=== Background removal ==="
python3 planet_remove_bg.py
echo ""
echo "=== DONE. Press Enter to close ==="
read
