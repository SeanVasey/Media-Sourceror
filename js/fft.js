/**
 * Fast Fourier Transform (FFT) Module
 * Optimized O(N log N) implementation using Cooley-Tukey algorithm
 * Addresses MS1 and MS2 performance issues with O(N²) DFT
 *
 * @version 1.1.0
 * @security-fix MS1-[critical], MS2-[critical] - Performance bottleneck resolution
 */

class FFT {
  /**
   * Create FFT processor
   * @param {number} size - FFT size (must be power of 2)
   */
  constructor(size) {
    this.size = size;
    this.log2size = Math.log2(size);

    if (!Number.isInteger(this.log2size)) {
      throw new Error('FFT size must be a power of 2');
    }

    // Pre-compute twiddle factors for efficiency
    this.cosTable = new Float32Array(size / 2);
    this.sinTable = new Float32Array(size / 2);

    for (let i = 0; i < size / 2; i++) {
      const angle = -2 * Math.PI * i / size;
      this.cosTable[i] = Math.cos(angle);
      this.sinTable[i] = Math.sin(angle);
    }

    // Pre-compute bit-reversal indices
    this.reverseTable = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      this.reverseTable[i] = this.reverseBits(i, this.log2size);
    }
  }

  /**
   * Reverse bits of an integer
   * @param {number} x - Input integer
   * @param {number} bits - Number of bits
   * @returns {number} - Bit-reversed integer
   */
  reverseBits(x, bits) {
    let result = 0;
    for (let i = 0; i < bits; i++) {
      result = (result << 1) | (x & 1);
      x >>= 1;
    }
    return result;
  }

  /**
   * Perform in-place FFT using Cooley-Tukey algorithm
   * Complexity: O(N log N)
   *
   * @param {Float32Array} real - Real part of input/output
   * @param {Float32Array} imag - Imaginary part of input/output
   */
  transform(real, imag) {
    const n = this.size;

    // Bit-reversal permutation
    for (let i = 0; i < n; i++) {
      const j = this.reverseTable[i];
      if (j > i) {
        // Swap real parts
        const tempReal = real[i];
        real[i] = real[j];
        real[j] = tempReal;

        // Swap imaginary parts
        const tempImag = imag[i];
        imag[i] = imag[j];
        imag[j] = tempImag;
      }
    }

    // Cooley-Tukey iterative FFT
    for (let size = 2; size <= n; size *= 2) {
      const halfSize = size / 2;
      const tableStep = n / size;

      for (let i = 0; i < n; i += size) {
        for (let j = 0; j < halfSize; j++) {
          const k = j * tableStep;
          const cos = this.cosTable[k];
          const sin = this.sinTable[k];

          const evenIndex = i + j;
          const oddIndex = i + j + halfSize;

          const evenReal = real[evenIndex];
          const evenImag = imag[evenIndex];
          const oddReal = real[oddIndex];
          const oddImag = imag[oddIndex];

          // Butterfly operation
          const tReal = cos * oddReal - sin * oddImag;
          const tImag = sin * oddReal + cos * oddImag;

          real[evenIndex] = evenReal + tReal;
          imag[evenIndex] = evenImag + tImag;
          real[oddIndex] = evenReal - tReal;
          imag[oddIndex] = evenImag - tImag;
        }
      }
    }
  }

  /**
   * Compute magnitude spectrum from real signal
   * @param {Float32Array} signal - Input signal (will be modified)
   * @returns {Float32Array} - Magnitude spectrum (size/2)
   */
  getMagnitudeSpectrum(signal) {
    const n = this.size;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);

    // Copy signal to real array, zero-pad if necessary
    const copyLength = Math.min(signal.length, n);
    for (let i = 0; i < copyLength; i++) {
      real[i] = signal[i];
    }

    // Perform FFT
    this.transform(real, imag);

    // Compute magnitude (only need first half due to symmetry)
    const spectrum = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      spectrum[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
    }

    return spectrum;
  }

  /**
   * Apply Hanning window to signal in-place
   * @param {Float32Array} signal - Signal to window
   */
  static applyHanningWindow(signal) {
    const n = signal.length;
    for (let i = 0; i < n; i++) {
      signal[i] *= 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
    }
  }

  /**
   * Apply Hamming window to signal in-place
   * @param {Float32Array} signal - Signal to window
   */
  static applyHammingWindow(signal) {
    const n = signal.length;
    for (let i = 0; i < n; i++) {
      signal[i] *= 0.54 - 0.46 * Math.cos(2 * Math.PI * i / n);
    }
  }
}

/**
 * FFT Cache - Reuse FFT instances for common sizes
 * Improves performance by avoiding repeated twiddle factor computation
 */
class FFTCache {
  constructor() {
    this.cache = new Map();
  }

  /**
   * Get or create FFT instance for given size
   * @param {number} size - FFT size
   * @returns {FFT} - FFT instance
   */
  get(size) {
    if (!this.cache.has(size)) {
      this.cache.set(size, new FFT(size));
    }
    return this.cache.get(size);
  }

  /**
   * Clear cache to free memory
   */
  clear() {
    this.cache.clear();
  }
}

// Global FFT cache instance
const fftCache = new FFTCache();

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.FFT = FFT;
  window.FFTCache = FFTCache;
  window.fftCache = fftCache;
}
