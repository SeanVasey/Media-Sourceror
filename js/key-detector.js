/**
 * Key Detector Module
 * Detects musical key using chromagram analysis and key profile matching
 * Based on the Krumhansl-Schmuckler key-finding algorithm
 *
 * @version 1.1.0
 * @security-fix MS2-[critical] - Replaced O(N²) DFT with O(N log N) FFT
 */

class KeyDetector {
  constructor() {
    // Krumhansl-Kessler key profiles
    this.majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
    this.minorProfile = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

    // Note names
    this.noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

    // Alternative note names (flats)
    this.noteNamesFlat = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

    this.sampleRate = 44100;
    this.fftSize = 8192;
    // Use cached FFT instance for performance
    this.fft = null;
  }

  /**
   * Analyze audio buffer and detect key
   * @param {AudioBuffer} audioBuffer - The audio buffer to analyze
   * @returns {Object} - Key detection results
   */
  async analyze(audioBuffer) {
    this.sampleRate = audioBuffer.sampleRate;

    // Get mono channel data
    const channelData = this.getMono(audioBuffer);

    // Compute chromagram
    const chromagram = this.computeChromagram(channelData);

    // Normalize chromagram
    const normalizedChroma = this.normalizeChroma(chromagram);

    // Find best matching key
    const keyResult = this.findKey(normalizedChroma);

    return keyResult;
  }

  /**
   * Convert stereo to mono
   */
  getMono(audioBuffer) {
    if (audioBuffer.numberOfChannels === 1) {
      return audioBuffer.getChannelData(0);
    }

    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.getChannelData(1);
    const mono = new Float32Array(left.length);

    for (let i = 0; i < left.length; i++) {
      mono[i] = (left[i] + right[i]) / 2;
    }

    return mono;
  }

  /**
   * Compute chromagram (pitch class profile)
   */
  computeChromagram(samples) {
    const chromagram = new Float32Array(12).fill(0);
    const hopSize = this.fftSize / 4;
    let numFrames = 0;

    // Process in frames
    for (let i = 0; i < samples.length - this.fftSize; i += hopSize) {
      const frame = samples.slice(i, i + this.fftSize);
      const spectrum = this.computeSpectrum(frame);

      // Map spectrum bins to pitch classes
      const frameChroma = this.spectrumToChroma(spectrum);

      for (let j = 0; j < 12; j++) {
        chromagram[j] += frameChroma[j];
      }

      numFrames++;
    }

    // Average over frames
    if (numFrames > 0) {
      for (let i = 0; i < 12; i++) {
        chromagram[i] /= numFrames;
      }
    }

    return chromagram;
  }

  /**
   * Compute magnitude spectrum using optimized FFT
   * O(N log N) complexity - fixes MS2-[critical] performance issue
   */
  computeSpectrum(frame) {
    const n = frame.length;

    // Initialize or get cached FFT instance
    if (!this.fft || this.fft.size !== n) {
      this.fft = window.fftCache ? window.fftCache.get(n) : new FFT(n);
    }

    // Copy frame and apply Hanning window
    const windowed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      windowed[i] = frame[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / n));
    }

    // Use optimized FFT (O(N log N) instead of O(N²) DFT)
    return this.fft.getMagnitudeSpectrum(windowed);
  }

  /**
   * Convert spectrum to chroma features
   */
  spectrumToChroma(spectrum) {
    const chroma = new Float32Array(12).fill(0);
    const binToFreq = this.sampleRate / (spectrum.length * 2);

    // Focus on musically relevant frequency range (80Hz - 5000Hz)
    const minBin = Math.floor(80 / binToFreq);
    const maxBin = Math.min(spectrum.length, Math.ceil(5000 / binToFreq));

    for (let bin = minBin; bin < maxBin; bin++) {
      const freq = bin * binToFreq;
      const pitchClass = this.freqToPitchClass(freq);

      if (pitchClass >= 0 && pitchClass < 12) {
        // Weight by magnitude squared (energy)
        chroma[pitchClass] += spectrum[bin] * spectrum[bin];
      }
    }

    return chroma;
  }

  /**
   * Convert frequency to pitch class (0-11)
   */
  freqToPitchClass(freq) {
    if (freq <= 0) return -1;

    // A4 = 440Hz, MIDI note 69
    const midiNote = 69 + 12 * Math.log2(freq / 440);
    const pitchClass = Math.round(midiNote) % 12;

    return pitchClass < 0 ? pitchClass + 12 : pitchClass;
  }

  /**
   * Normalize chroma vector
   */
  normalizeChroma(chroma) {
    const sum = chroma.reduce((a, b) => a + b, 0);

    if (sum === 0) {
      return new Float32Array(12).fill(1 / 12);
    }

    const normalized = new Float32Array(12);
    for (let i = 0; i < 12; i++) {
      normalized[i] = chroma[i] / sum;
    }

    return normalized;
  }

  /**
   * Find the best matching key using correlation with key profiles
   */
  findKey(chroma) {
    let bestKey = { note: 'C', mode: 'major', correlation: -1 };

    // Test all 24 keys (12 major + 12 minor)
    for (let shift = 0; shift < 12; shift++) {
      // Rotate chroma to match key
      const rotatedChroma = this.rotateChroma(chroma, shift);

      // Correlate with major profile
      const majorCorr = this.pearsonCorrelation(rotatedChroma, this.majorProfile);

      if (majorCorr > bestKey.correlation) {
        bestKey = {
          note: this.noteNames[shift],
          noteFlat: this.noteNamesFlat[shift],
          mode: 'major',
          correlation: majorCorr
        };
      }

      // Correlate with minor profile
      const minorCorr = this.pearsonCorrelation(rotatedChroma, this.minorProfile);

      if (minorCorr > bestKey.correlation) {
        bestKey = {
          note: this.noteNames[shift],
          noteFlat: this.noteNamesFlat[shift],
          mode: 'minor',
          correlation: minorCorr
        };
      }
    }

    // Format output
    const useFlat = ['Db', 'Eb', 'Gb', 'Ab', 'Bb'].includes(bestKey.noteFlat) &&
                    bestKey.mode === 'minor';

    return {
      key: useFlat ? bestKey.noteFlat : bestKey.note,
      mode: bestKey.mode,
      fullKey: `${useFlat ? bestKey.noteFlat : bestKey.note} ${bestKey.mode}`,
      confidence: Math.max(0, Math.min(1, (bestKey.correlation + 1) / 2)),
      camelotKey: this.getCamelotKey(bestKey.note, bestKey.mode)
    };
  }

  /**
   * Rotate chroma vector by n semitones
   */
  rotateChroma(chroma, n) {
    const rotated = new Float32Array(12);
    for (let i = 0; i < 12; i++) {
      rotated[i] = chroma[(i + n) % 12];
    }
    return rotated;
  }

  /**
   * Calculate Pearson correlation coefficient
   */
  pearsonCorrelation(x, y) {
    const n = x.length;

    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;

    for (let i = 0; i < n; i++) {
      sumX += x[i];
      sumY += y[i];
      sumXY += x[i] * y[i];
      sumX2 += x[i] * x[i];
      sumY2 += y[i] * y[i];
    }

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

    if (denominator === 0) return 0;

    return numerator / denominator;
  }

  /**
   * Get Camelot wheel notation for DJs
   */
  getCamelotKey(note, mode) {
    const camelotMajor = {
      'C': '8B', 'G': '9B', 'D': '10B', 'A': '11B', 'E': '12B', 'B': '1B',
      'F#': '2B', 'Gb': '2B', 'Db': '3B', 'C#': '3B', 'Ab': '4B', 'G#': '4B',
      'Eb': '5B', 'D#': '5B', 'Bb': '6B', 'A#': '6B', 'F': '7B'
    };

    const camelotMinor = {
      'A': '8A', 'E': '9A', 'B': '10A', 'F#': '11A', 'Gb': '11A', 'Db': '12A',
      'C#': '12A', 'Ab': '1A', 'G#': '1A', 'Eb': '2A', 'D#': '2A', 'Bb': '3A',
      'A#': '3A', 'F': '4A', 'C': '5A', 'G': '6A', 'D': '7A'
    };

    if (mode === 'major') {
      return camelotMajor[note] || '';
    } else {
      return camelotMinor[note] || '';
    }
  }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.KeyDetector = KeyDetector;
}
