/**
 * Audio Analysis Web Worker
 * Runs tempo and key detection in a background thread to prevent UI blocking
 *
 * @version 1.1.0
 * @security-fix MS1-[critical], MS2-[critical] - Offload processing to Web Worker
 */

// Import FFT module
importScripts('fft.js');

// FFT cache for worker
const workerFFTCache = new FFTCache();

/**
 * Tempo Detection (Worker Version)
 */
class WorkerTempoDetector {
  constructor() {
    this.sampleRate = 44100;
    this.bufferSize = 2048;
    this.minBPM = 60;
    this.maxBPM = 200;
    this.fft = null;
  }

  analyze(channelData, sampleRate) {
    this.sampleRate = sampleRate;
    const onsets = this.detectOnsets(channelData);
    const tempo = this.calculateTempo(onsets);
    const refinedTempo = this.refineWithAutocorrelation(channelData, tempo);

    return {
      bpm: Math.round(refinedTempo),
      confidence: this.calculateConfidence(onsets, refinedTempo),
      onsets: onsets.length
    };
  }

  detectOnsets(samples) {
    const hopSize = this.bufferSize / 4;
    const onsets = [];
    const spectralFlux = [];
    let prevSpectrum = null;

    for (let i = 0; i < samples.length - this.bufferSize; i += hopSize) {
      const frame = samples.slice(i, i + this.bufferSize);
      const spectrum = this.computeSpectrum(frame);

      if (prevSpectrum) {
        let flux = 0;
        for (let j = 0; j < spectrum.length; j++) {
          const diff = spectrum[j] - prevSpectrum[j];
          flux += diff > 0 ? diff : 0;
        }
        spectralFlux.push({ time: i / this.sampleRate, flux });
      }
      prevSpectrum = spectrum;
    }

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

  computeSpectrum(frame) {
    const n = frame.length;
    if (!this.fft || this.fft.size !== n) {
      this.fft = workerFFTCache.get(n);
    }

    const windowed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      windowed[i] = frame[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / n));
    }

    return this.fft.getMagnitudeSpectrum(windowed);
  }

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
      threshold.push((sum / (end - start)) * multiplier);
    }

    return threshold;
  }

  calculateTempo(onsets) {
    if (onsets.length < 2) return 120;

    const intervals = [];
    for (let i = 1; i < onsets.length; i++) {
      intervals.push(onsets[i] - onsets[i - 1]);
    }

    const bpmCounts = {};
    const tolerance = 2;

    for (const interval of intervals) {
      const bpm = Math.round(60 / interval);
      if (bpm >= this.minBPM && bpm <= this.maxBPM) {
        const candidates = [bpm, bpm * 2, bpm / 2].filter(b => b >= this.minBPM && b <= this.maxBPM);
        for (const candidate of candidates) {
          const rounded = Math.round(candidate / tolerance) * tolerance;
          bpmCounts[rounded] = (bpmCounts[rounded] || 0) + 1;
        }
      }
    }

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

  refineWithAutocorrelation(samples, estimatedBPM) {
    const downsampleFactor = 4;
    const downsampled = [];
    for (let i = 0; i < samples.length; i += downsampleFactor) {
      downsampled.push(Math.abs(samples[i]));
    }

    const downsampledRate = this.sampleRate / downsampleFactor;
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
    return Math.abs(refinedBPM - estimatedBPM) < 10 ? refinedBPM : estimatedBPM;
  }

  calculateConfidence(onsets, bpm) {
    if (onsets.length < 10) return 0.3;

    const expectedInterval = 60 / bpm;
    let matchingIntervals = 0;

    for (let i = 1; i < onsets.length; i++) {
      const interval = onsets[i] - onsets[i - 1];
      for (let mult = 1; mult <= 4; mult++) {
        if (Math.abs(interval - expectedInterval * mult) < 0.05) {
          matchingIntervals++;
          break;
        }
      }
    }

    return Math.min(0.95, matchingIntervals / (onsets.length - 1));
  }
}

/**
 * Key Detection (Worker Version)
 */
class WorkerKeyDetector {
  constructor() {
    this.majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
    this.minorProfile = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
    this.noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    this.noteNamesFlat = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
    this.sampleRate = 44100;
    this.fftSize = 8192;
    this.fft = null;
  }

  analyze(channelData, sampleRate) {
    this.sampleRate = sampleRate;
    const chromagram = this.computeChromagram(channelData);
    const normalizedChroma = this.normalizeChroma(chromagram);
    return this.findKey(normalizedChroma);
  }

  computeChromagram(samples) {
    const chromagram = new Float32Array(12).fill(0);
    const hopSize = this.fftSize / 4;
    let numFrames = 0;

    for (let i = 0; i < samples.length - this.fftSize; i += hopSize) {
      const frame = samples.slice(i, i + this.fftSize);
      const spectrum = this.computeSpectrum(frame);
      const frameChroma = this.spectrumToChroma(spectrum);

      for (let j = 0; j < 12; j++) {
        chromagram[j] += frameChroma[j];
      }
      numFrames++;
    }

    if (numFrames > 0) {
      for (let i = 0; i < 12; i++) {
        chromagram[i] /= numFrames;
      }
    }

    return chromagram;
  }

  computeSpectrum(frame) {
    const n = frame.length;
    if (!this.fft || this.fft.size !== n) {
      this.fft = workerFFTCache.get(n);
    }

    const windowed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      windowed[i] = frame[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / n));
    }

    return this.fft.getMagnitudeSpectrum(windowed);
  }

  spectrumToChroma(spectrum) {
    const chroma = new Float32Array(12).fill(0);
    const binToFreq = this.sampleRate / (spectrum.length * 2);
    const minBin = Math.floor(80 / binToFreq);
    const maxBin = Math.min(spectrum.length, Math.ceil(5000 / binToFreq));

    for (let bin = minBin; bin < maxBin; bin++) {
      const freq = bin * binToFreq;
      const pitchClass = this.freqToPitchClass(freq);
      if (pitchClass >= 0 && pitchClass < 12) {
        chroma[pitchClass] += spectrum[bin] * spectrum[bin];
      }
    }

    return chroma;
  }

  freqToPitchClass(freq) {
    if (freq <= 0) return -1;
    const midiNote = 69 + 12 * Math.log2(freq / 440);
    const pitchClass = Math.round(midiNote) % 12;
    return pitchClass < 0 ? pitchClass + 12 : pitchClass;
  }

  normalizeChroma(chroma) {
    const sum = chroma.reduce((a, b) => a + b, 0);
    if (sum === 0) return new Float32Array(12).fill(1 / 12);

    const normalized = new Float32Array(12);
    for (let i = 0; i < 12; i++) {
      normalized[i] = chroma[i] / sum;
    }
    return normalized;
  }

  findKey(chroma) {
    let bestKey = { note: 'C', mode: 'major', correlation: -1 };

    for (let shift = 0; shift < 12; shift++) {
      const rotatedChroma = this.rotateChroma(chroma, shift);

      const majorCorr = this.pearsonCorrelation(rotatedChroma, this.majorProfile);
      if (majorCorr > bestKey.correlation) {
        bestKey = { note: this.noteNames[shift], noteFlat: this.noteNamesFlat[shift], mode: 'major', correlation: majorCorr };
      }

      const minorCorr = this.pearsonCorrelation(rotatedChroma, this.minorProfile);
      if (minorCorr > bestKey.correlation) {
        bestKey = { note: this.noteNames[shift], noteFlat: this.noteNamesFlat[shift], mode: 'minor', correlation: minorCorr };
      }
    }

    const useFlat = ['Db', 'Eb', 'Gb', 'Ab', 'Bb'].includes(bestKey.noteFlat) && bestKey.mode === 'minor';

    return {
      key: useFlat ? bestKey.noteFlat : bestKey.note,
      mode: bestKey.mode,
      fullKey: `${useFlat ? bestKey.noteFlat : bestKey.note} ${bestKey.mode}`,
      confidence: Math.max(0, Math.min(1, (bestKey.correlation + 1) / 2)),
      camelotKey: this.getCamelotKey(bestKey.note, bestKey.mode)
    };
  }

  rotateChroma(chroma, n) {
    const rotated = new Float32Array(12);
    for (let i = 0; i < 12; i++) {
      rotated[i] = chroma[(i + n) % 12];
    }
    return rotated;
  }

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
    return denominator === 0 ? 0 : numerator / denominator;
  }

  getCamelotKey(note, mode) {
    const camelotMajor = { 'C': '8B', 'G': '9B', 'D': '10B', 'A': '11B', 'E': '12B', 'B': '1B', 'F#': '2B', 'Gb': '2B', 'Db': '3B', 'C#': '3B', 'Ab': '4B', 'G#': '4B', 'Eb': '5B', 'D#': '5B', 'Bb': '6B', 'A#': '6B', 'F': '7B' };
    const camelotMinor = { 'A': '8A', 'E': '9A', 'B': '10A', 'F#': '11A', 'Gb': '11A', 'Db': '12A', 'C#': '12A', 'Ab': '1A', 'G#': '1A', 'Eb': '2A', 'D#': '2A', 'Bb': '3A', 'A#': '3A', 'F': '4A', 'C': '5A', 'G': '6A', 'D': '7A' };
    return mode === 'major' ? (camelotMajor[note] || '') : (camelotMinor[note] || '');
  }
}

// Worker instances
const tempoDetector = new WorkerTempoDetector();
const keyDetector = new WorkerKeyDetector();

// Handle messages from main thread
self.onmessage = function(e) {
  const { type, data, id } = e.data;

  try {
    let result;

    switch (type) {
      case 'analyzeTempo':
        result = tempoDetector.analyze(data.channelData, data.sampleRate);
        break;

      case 'analyzeKey':
        result = keyDetector.analyze(data.channelData, data.sampleRate);
        break;

      case 'analyzeAll':
        result = {
          tempo: tempoDetector.analyze(data.channelData, data.sampleRate),
          key: keyDetector.analyze(data.channelData, data.sampleRate)
        };
        break;

      default:
        throw new Error('Unknown analysis type: ' + type);
    }

    self.postMessage({ id, success: true, result });
  } catch (error) {
    self.postMessage({ id, success: false, error: error.message });
  }
};
