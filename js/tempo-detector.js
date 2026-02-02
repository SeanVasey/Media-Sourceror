/**
 * Tempo Detector Module
 * Detects BPM (beats per minute) from audio data using onset detection
 * and autocorrelation algorithms
 *
 * @version 1.1.0
 * @security-fix MS1-[critical] - Replaced O(N²) DFT with O(N log N) FFT
 */

class TempoDetector {
  constructor() {
    this.sampleRate = 44100;
    this.bufferSize = 2048;
    this.minBPM = 60;
    this.maxBPM = 200;
    // Use cached FFT instance for performance
    this.fft = null;
  }

  /**
   * Analyze audio buffer and detect tempo
   * @param {AudioBuffer} audioBuffer - The audio buffer to analyze
   * @returns {Object} - Tempo analysis results
   */
  async analyze(audioBuffer) {
    this.sampleRate = audioBuffer.sampleRate;

    // Get mono channel data
    const channelData = this.getMono(audioBuffer);

    // Detect onsets (beat locations)
    const onsets = this.detectOnsets(channelData);

    // Calculate tempo from onset intervals
    const tempo = this.calculateTempo(onsets);

    // Refine using autocorrelation
    const refinedTempo = this.refineWithAutocorrelation(channelData, tempo);

    return {
      bpm: Math.round(refinedTempo),
      confidence: this.calculateConfidence(onsets, refinedTempo),
      onsets: onsets.length
    };
  }

  /**
   * Convert stereo to mono by averaging channels
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
   * Detect onset points using spectral flux
   */
  detectOnsets(samples) {
    const hopSize = this.bufferSize / 4;
    const onsets = [];
    const spectralFlux = [];

    // Calculate spectral flux
    let prevSpectrum = null;

    for (let i = 0; i < samples.length - this.bufferSize; i += hopSize) {
      const frame = samples.slice(i, i + this.bufferSize);
      const spectrum = this.computeSpectrum(frame);

      if (prevSpectrum) {
        let flux = 0;
        for (let j = 0; j < spectrum.length; j++) {
          const diff = spectrum[j] - prevSpectrum[j];
          flux += diff > 0 ? diff : 0; // Half-wave rectification
        }
        spectralFlux.push({ time: i / this.sampleRate, flux });
      }

      prevSpectrum = spectrum;
    }

    // Peak picking with adaptive threshold
    const threshold = this.calculateAdaptiveThreshold(spectralFlux);

    for (let i = 1; i < spectralFlux.length - 1; i++) {
      const current = spectralFlux[i].flux;
      const prev = spectralFlux[i - 1].flux;
      const next = spectralFlux[i + 1].flux;

      if (current > threshold[i] && current > prev && current > next) {
        onsets.push(spectralFlux[i].time);
      }
    }

    return onsets;
  }

  /**
   * Compute magnitude spectrum using optimized FFT
   * O(N log N) complexity - fixes MS1-[critical] performance issue
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
   * Calculate adaptive threshold for onset detection
   */
  calculateAdaptiveThreshold(spectralFlux) {
    const windowSize = 10;
    const multiplier = 1.5;
    const threshold = [];

    for (let i = 0; i < spectralFlux.length; i++) {
      const start = Math.max(0, i - windowSize);
      const end = Math.min(spectralFlux.length, i + windowSize);

      let sum = 0;
      for (let j = start; j < end; j++) {
        sum += spectralFlux[j].flux;
      }

      const mean = sum / (end - start);
      threshold.push(mean * multiplier);
    }

    return threshold;
  }

  /**
   * Calculate tempo from onset intervals
   */
  calculateTempo(onsets) {
    if (onsets.length < 2) {
      return 120; // Default tempo
    }

    // Calculate inter-onset intervals
    const intervals = [];
    for (let i = 1; i < onsets.length; i++) {
      intervals.push(onsets[i] - onsets[i - 1]);
    }

    // Convert to BPM and create histogram
    const bpmCounts = {};
    const tolerance = 2;

    for (const interval of intervals) {
      const bpm = Math.round(60 / interval);

      if (bpm >= this.minBPM && bpm <= this.maxBPM) {
        // Check for double/half time
        const candidates = [bpm, bpm * 2, bpm / 2].filter(
          b => b >= this.minBPM && b <= this.maxBPM
        );

        for (const candidate of candidates) {
          const rounded = Math.round(candidate / tolerance) * tolerance;
          bpmCounts[rounded] = (bpmCounts[rounded] || 0) + 1;
        }
      }
    }

    // Find most common BPM
    let maxCount = 0;
    let bestBPM = 120;

    for (const [bpm, count] of Object.entries(bpmCounts)) {
      if (count > maxCount) {
        maxCount = count;
        bestBPM = parseInt(bpm);
      }
    }

    return bestBPM;
  }

  /**
   * Refine tempo estimate using autocorrelation
   */
  refineWithAutocorrelation(samples, estimatedBPM) {
    // Downsample for efficiency
    const downsampleFactor = 4;
    const downsampled = [];
    for (let i = 0; i < samples.length; i += downsampleFactor) {
      downsampled.push(Math.abs(samples[i]));
    }

    const downsampledRate = this.sampleRate / downsampleFactor;

    // Calculate autocorrelation around estimated BPM
    const minLag = Math.floor(downsampledRate * 60 / (estimatedBPM + 20));
    const maxLag = Math.ceil(downsampledRate * 60 / (estimatedBPM - 20));

    let maxCorrelation = 0;
    let bestLag = minLag;

    for (let lag = minLag; lag <= maxLag; lag++) {
      let correlation = 0;
      const numSamples = Math.min(downsampled.length - lag, 10000);

      for (let i = 0; i < numSamples; i++) {
        correlation += downsampled[i] * downsampled[i + lag];
      }

      if (correlation > maxCorrelation) {
        maxCorrelation = correlation;
        bestLag = lag;
      }
    }

    const refinedBPM = (downsampledRate * 60) / bestLag;

    // Return refined BPM if it's close to estimate, otherwise return estimate
    if (Math.abs(refinedBPM - estimatedBPM) < 10) {
      return refinedBPM;
    }

    return estimatedBPM;
  }

  /**
   * Calculate confidence score for tempo detection
   */
  calculateConfidence(onsets, bpm) {
    if (onsets.length < 10) {
      return 0.3;
    }

    const expectedInterval = 60 / bpm;
    let matchingIntervals = 0;

    for (let i = 1; i < onsets.length; i++) {
      const interval = onsets[i] - onsets[i - 1];

      // Check if interval matches expected beat interval (or multiples)
      for (let mult = 1; mult <= 4; mult++) {
        const expected = expectedInterval * mult;
        if (Math.abs(interval - expected) < 0.05) {
          matchingIntervals++;
          break;
        }
      }
    }

    return Math.min(0.95, matchingIntervals / (onsets.length - 1));
  }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.TempoDetector = TempoDetector;
}
