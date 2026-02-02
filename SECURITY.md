# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.1.x   | :white_check_mark: |
| 1.0.x   | :x:                |

## Security Fixes

### Version 1.1.0 (2026-02-02)

#### MS1-[critical] - Performance Bottleneck in Tempo Detection
- **Issue**: The `computeSpectrum` function in `tempo-detector.js` used a manual Discrete Fourier Transform (DFT) with O(N²) complexity, causing UI freezing during tempo analysis.
- **Impact**: Main thread blocking, unresponsive UI during audio processing.
- **Fix**: Replaced O(N²) DFT with optimized Cooley-Tukey FFT algorithm achieving O(N log N) complexity.
- **Files Modified**: `js/tempo-detector.js`, `js/fft.js` (new)

#### MS2-[critical] - Performance Bottleneck in Key Detection
- **Issue**: The `computeSpectrum` function in `key-detector.js` used an O(N²) DFT with an 8192-sample FFT size, causing severe performance degradation.
- **Impact**: Extended processing times, potential browser tab crashes on mobile devices.
- **Fix**: Replaced O(N²) DFT with optimized FFT, added FFT caching for repeated operations.
- **Files Modified**: `js/key-detector.js`, `js/fft.js` (new)

#### Additional Mitigations
- **Web Worker Support**: Added `js/analysis-worker.js` to offload audio analysis to a background thread, preventing UI blocking regardless of algorithm complexity.
- **FFT Caching**: Implemented `FFTCache` class to reuse FFT instances and pre-computed twiddle factors, reducing memory allocation overhead.

## Reporting a Vulnerability

This is a personal-use application. If you discover a security vulnerability, please:

1. Do not open a public GitHub issue
2. Contact the maintainer directly
3. Provide detailed reproduction steps

## Security Best Practices

This application follows these security practices:

- **No external data transmission**: All audio processing occurs client-side
- **No persistent storage of media**: Processed audio is held in memory only
- **Content Security Policy ready**: Application can be served with strict CSP headers
- **HTTPS required**: PWA manifest requires secure context for installation
