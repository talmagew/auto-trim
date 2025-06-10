# Waveform Analyzer with Speech-to-Text

This project provides a comprehensive web interface to load audio or video files, analyze their waveforms, and transcribe speech content using Speech-to-Text (STT) technology. All processing runs completely in the browser—no files are uploaded to any server.

## Features

### Audio Analysis
- Load audio or video files from your computer
- Display high-quality waveforms using [WaveSurfer.js](https://wavesurfer.xyz/)
- Detect peaks, valleys, transients, and estimate the noise floor
- Show visual indicators for these events on an analysis canvas
- Zoom controls for detailed waveform inspection

### Speech-to-Text (STT)
- **Web Speech API Integration**: Real-time speech recognition using Chrome/Edge's built-in capabilities
- **Live Transcription**: Transcribe speech in real-time while audio plays or from microphone input
- **Transcript Management**: 
  - Copy transcript to clipboard
  - Download transcript as a text file
  - Clear and reset transcripts
- **Confidence Tracking**: Monitor transcription confidence levels
- **Timestamp Correlation**: Associate transcript segments with audio timeline positions

## Usage

1. Open `web/index.html` in a modern browser (Chrome or Edge recommended for STT features)
2. Select an audio or video file using the file picker
3. The waveform will render along with analysis markers
4. **For Speech-to-Text**:
   - Choose "Web Speech API" method (default)
   - Click "Start Transcription" 
   - Speak into your microphone or play the audio file
   - View real-time transcription results
   - Use transcript controls to copy, download, or clear results

## Browser Compatibility

- **Waveform Analysis**: Works in all modern browsers
- **Speech-to-Text**: Requires Chrome, Edge, or other Chromium-based browsers with Web Speech API support
- **File Support**: Audio formats (MP3, WAV, M4A, etc.) and Video formats (MP4, WebM, etc.)

## Technical Details

### STT Implementation
- Uses Web Speech API (`SpeechRecognition`) for real-time transcription
- Supports continuous recognition with interim results
- Configurable language settings (default: en-US)
- Error handling and recovery mechanisms
- Placeholder for future offline STT processing

### Security & Privacy
- All processing happens locally in your browser
- No audio data is sent to external servers
- Speech recognition uses browser's built-in capabilities
- Files remain on your device at all times

## Future Enhancements

- Offline STT processing using WebAssembly models
- Multiple language support
- Advanced transcript editing capabilities
- Audio-transcript synchronization and seeking
- Export options (SRT, VTT subtitle formats)

## Installation

No build step is required; all dependencies are loaded via CDN. Simply serve the files from a web server or open `index.html` directly in your browser.

## Requirements

- Modern web browser with ES6+ support
- Chrome/Edge for full STT functionality
- Microphone access for live transcription

## UX Improvement Ideas

See [UX_IMPROVEMENTS.md](./UX_IMPROVEMENTS.md) for a list of suggestions to modernize the interface and enhance usability.
