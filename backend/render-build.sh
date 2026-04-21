#!/usr/bin/env bash
set -e

# Install system-level audio libraries used by the Piper TTS fallback.
# On Render's native Python environment this runs as root; the || true
# prevents a build failure if the package manager is unavailable.
apt-get update -qq && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
  2>/dev/null || echo "[render-build] apt-get unavailable — skipping system packages"

pip install --upgrade pip
pip install -r requirements.txt
