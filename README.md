# Waveform Analyzer

This project provides a simple web interface to load a local audio or video file and analyze its waveform. The analysis runs completely in the browser—no files are uploaded to any server.

## Features

- Load audio or video files from your computer.
- Display a high-quality waveform using [WaveSurfer.js](https://wavesurfer.xyz/).
- Detect peaks, valleys, transients, and estimate the noise floor.
- Show visual indicators for these events on an analysis canvas.

## Usage

Open `web/index.html` in a modern browser. Then select an audio or video file using the file picker. The waveform will render along with graphical markers for the analysis results.

No build step is required; all dependencies are loaded via CDN.
