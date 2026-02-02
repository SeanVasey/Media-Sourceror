# Media Sourceror

> AI-powered audio extraction and analysis tool

[![Version](https://img.shields.io/badge/version-1.1.0-blue.svg)](CHANGELOG.md)
[![Security](https://img.shields.io/badge/security-fixes%20applied-green.svg)](SECURITY.md)

Media Sourceror is a personal-use Progressive Web App (PWA) for extracting high-quality audio from multimedia sources. It runs entirely in the browser using WebAssembly-based audio processing.

## Features

### Audio Extraction
- Extract audio from video files (MP4, MOV, AVI, MKV, WEBM)
- Process audio files (MP3, WAV, M4A, FLAC, etc.)
- Fetch media directly from URLs
- Drag & drop or click-to-browse file selection

### Export Formats (Highest Quality Only)
- **FLAC** - Lossless compression
- **WAV** - 24-bit PCM uncompressed
- **MP3** - 320 kbps CBR
- **AAC** - 256 kbps in M4A container

### Audio Analysis
- **Tempo Detection** - BPM estimation using onset detection and autocorrelation
- **Key Detection** - Musical key using Krumhansl-Schmuckler algorithm
- **Camelot Wheel** - DJ-friendly key notation
- **Waveform Visualization** - Real-time amplitude display

### Technical Features
- Sample rate preservation (44.1kHz / 48kHz)
- Bit depth handling (16/24/32-bit)
- Optimized FFT processing (O(N log N))
- Web Worker support for non-blocking analysis
- Offline-capable PWA

## Installation

### As PWA (Recommended)
1. Visit the hosted application in a modern browser
2. Click "Add to Home Screen" or install prompt
3. Launch from your device's home screen

### Local Development
```bash
# Clone the repository
git clone https://github.com/SeanVasey/Media-Sourceror.git
cd Media-Sourceror

# Serve with any static file server
npx serve .
# or
python -m http.server 8080
```

**Note**: The application requires HTTPS or localhost for full PWA functionality.

## Architecture

```
Media-Sourceror/
├── index.html              # Main PWA interface
├── manifest.json           # PWA manifest
├── sw.js                   # Service worker (v1.1.0)
├── css/
│   └── styles.css          # Glassmorphism styling
├── js/
│   ├── app.js              # Main application
│   ├── audio-processor.js  # FFmpeg.wasm integration
│   ├── fft.js              # Optimized FFT (v1.1.0)
│   ├── tempo-detector.js   # BPM detection
│   ├── key-detector.js     # Key detection
│   └── analysis-worker.js  # Web Worker (v1.1.0)
└── icons/
    ├── app-icon.svg        # App icon
    ├── favicon.svg         # Favicon
    └── icon-512.svg        # PWA icon
```

## Security

See [SECURITY.md](SECURITY.md) for:
- Security policy
- Fixed vulnerabilities (MS1, MS2)
- Reporting guidelines

### Recent Security Fixes (v1.1.0)
- **MS1-[critical]**: Fixed O(N²) DFT in tempo detection
- **MS2-[critical]**: Fixed O(N²) DFT in key detection

## Version History

See [CHANGELOG.md](CHANGELOG.md) for detailed version history.

## Technology Stack

- **FFmpeg.wasm** - Browser-based media processing
- **Web Audio API** - Audio decoding and analysis
- **Web Workers** - Background processing
- **Service Workers** - Offline caching
- **Canvas API** - Waveform visualization

## Design

- **Theme**: Charcoal/monochrome with turquoise/cyan accents
- **Typography**: Bebas Neue (headers), Reddit Sans (body)
- **Style**: Glassmorphism with metallic textures
- **Mobile-first**: Optimized for iOS Safari PWA

## Branding

Created by **VASEY/AI**

Associated ventures:
- Vasey Multimedia
- VASEY.AUDIO

## License

Personal use only. See [LICENSE](LICENSE) for details.

---

*Media Sourceror - Extract the magic from your media*
