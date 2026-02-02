/**
 * Audio Processor Module
 * Handles audio extraction, analysis, and format conversion
 * Uses FFmpeg.wasm for media processing
 *
 * @version 1.2.0
 * @bugfix Fixed preserveSampleRate setting not being used
 * @bugfix Integrated Web Worker for non-blocking audio analysis
 */

class AudioProcessor {
  constructor(options = {}) {
    this.ffmpeg = null;
    this.isLoaded = false;
    this.audioContext = null;
    this.currentFile = null;
    this.extractedAudio = null;
    this.audioBuffer = null;

    // Settings with defaults
    this.settings = {
      preserveSampleRate: options.preserveSampleRate ?? true,
      useWebWorker: options.useWebWorker ?? true
    };

    // Audio metadata
    this.metadata = {
      duration: 0,
      sampleRate: 0,
      originalSampleRate: 0,
      channels: 0,
      bitDepth: 0,
      codec: '',
      bitrate: 0
    };

    // Web Worker for background analysis
    this.analysisWorker = null;
    this.workerMessageId = 0;
    this.pendingWorkerCalls = new Map();

    // Fallback detectors (used if worker unavailable)
    this.tempoDetector = null;
    this.keyDetector = null;

    // Processing callbacks
    this.onProgress = null;
    this.onStageChange = null;

    // Initialize worker
    this.initWorker();
  }

  /**
   * Update settings
   * @param {Object} newSettings - Settings to update
   */
  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
  }

  /**
   * Initialize Web Worker for audio analysis
   */
  initWorker() {
    if (!this.settings.useWebWorker || typeof Worker === 'undefined') {
      console.log('[AudioProcessor] Web Worker not available, using main thread');
      return;
    }

    try {
      this.analysisWorker = new Worker('js/analysis-worker.js');

      this.analysisWorker.onmessage = (e) => {
        const { id, success, result, error } = e.data;
        const pending = this.pendingWorkerCalls.get(id);

        if (pending) {
          this.pendingWorkerCalls.delete(id);
          if (success) {
            pending.resolve(result);
          } else {
            pending.reject(new Error(error));
          }
        }
      };

      this.analysisWorker.onerror = (error) => {
        console.error('[AudioProcessor] Worker error:', error);
        // Fall back to main thread analysis
        this.analysisWorker = null;
      };

      console.log('[AudioProcessor] Web Worker initialized');
    } catch (error) {
      console.warn('[AudioProcessor] Failed to initialize worker:', error);
      this.analysisWorker = null;
    }
  }

  /**
   * Run analysis in Web Worker
   * @param {string} type - Analysis type ('analyzeTempo', 'analyzeKey', 'analyzeAll')
   * @param {Float32Array} channelData - Audio channel data
   * @param {number} sampleRate - Sample rate
   * @returns {Promise} - Analysis result
   */
  runWorkerAnalysis(type, channelData, sampleRate) {
    return new Promise((resolve, reject) => {
      if (!this.analysisWorker) {
        reject(new Error('Worker not available'));
        return;
      }

      const id = ++this.workerMessageId;
      this.pendingWorkerCalls.set(id, { resolve, reject });

      // Transfer channel data to worker (use slice to create transferable copy)
      const dataArray = new Float32Array(channelData);

      this.analysisWorker.postMessage({
        type,
        id,
        data: {
          channelData: dataArray,
          sampleRate
        }
      }, [dataArray.buffer]);
    });
  }

  /**
   * Initialize FFmpeg
   * Uses single-threaded core for compatibility with GitHub Pages (no SharedArrayBuffer required)
   */
  async initialize() {
    if (this.isLoaded) return true;

    try {
      this.updateStage('Loading FFmpeg...');
      this.updateProgress(5);

      // Wait for FFmpeg to be available from CDN
      let attempts = 0;
      const maxAttempts = 100; // 10 seconds max wait
      while ((!window.FFmpegWASM?.FFmpeg || !window.FFmpegUtil?.fetchFile) && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
        // Update progress during loading
        if (attempts % 10 === 0) {
          this.updateProgress(5 + Math.min(attempts / 10, 10));
        }
      }

      if (!window.FFmpegWASM?.FFmpeg) {
        throw new Error('FFmpeg library failed to load. Please check your internet connection and try again.');
      }

      if (!window.FFmpegUtil?.fetchFile) {
        throw new Error('FFmpeg utilities failed to load. Please check your internet connection and try again.');
      }

      this.updateStage('Initializing audio engine...');
      this.updateProgress(15);

      // Access FFmpeg from the global scope (loaded via CDN)
      const FFmpeg = window.FFmpegWASM.FFmpeg;
      const fetchFile = window.FFmpegUtil.fetchFile;

      this.ffmpeg = new FFmpeg();
      this.fetchFile = fetchFile;

      // Set up progress handler
      this.ffmpeg.on('progress', ({ progress }) => {
        if (this.onProgress) {
          // Map FFmpeg progress (0-1) to our progress range (25-90)
          const mappedProgress = 25 + Math.round(progress * 65);
          this.onProgress(mappedProgress);
        }
      });

      // Set up log handler for debugging
      this.ffmpeg.on('log', ({ message }) => {
        console.log('[FFmpeg]', message);
        this.parseFFmpegLog(message);
      });

      this.updateStage('Loading audio processing core...');
      this.updateProgress(20);

      // Load FFmpeg core - using single-threaded version for compatibility
      // Note: @ffmpeg/core@0.12.x is single-threaded (@ffmpeg/core-mt is multi-threaded)
      // SharedArrayBuffer is enabled via coi-serviceworker for GitHub Pages compatibility
      await this.ffmpeg.load({
        coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js',
        wasmURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm',
      });

      this.isLoaded = true;
      this.updateStage('Audio engine ready');
      this.updateProgress(25);

      console.log('[AudioProcessor] FFmpeg initialized successfully');
      return true;
    } catch (error) {
      console.error('[AudioProcessor] Failed to load FFmpeg:', error);
      this.updateStage('Error loading audio engine');
      throw new Error(error.message || 'Failed to initialize audio processor. Please refresh and try again.');
    }
  }

  /**
   * Parse FFmpeg log messages for metadata
   */
  parseFFmpegLog(message) {
    // Extract duration
    const durationMatch = message.match(/Duration: (\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
    if (durationMatch) {
      const hours = parseInt(durationMatch[1]);
      const minutes = parseInt(durationMatch[2]);
      const seconds = parseInt(durationMatch[3]);
      this.metadata.duration = hours * 3600 + minutes * 60 + seconds;
    }

    // Extract audio stream info
    const audioMatch = message.match(/Audio: (\w+).*, (\d+) Hz, (stereo|mono|5\.1|7\.1), (\w+)/);
    if (audioMatch) {
      this.metadata.codec = audioMatch[1];
      this.metadata.sampleRate = parseInt(audioMatch[2]);
      this.metadata.channels = audioMatch[3] === 'mono' ? 1 :
                               audioMatch[3] === 'stereo' ? 2 :
                               audioMatch[3] === '5.1' ? 6 : 8;

      // Estimate bit depth from format
      const format = audioMatch[4];
      if (format.includes('s16') || format.includes('16')) {
        this.metadata.bitDepth = 16;
      } else if (format.includes('s24') || format.includes('24')) {
        this.metadata.bitDepth = 24;
      } else if (format.includes('s32') || format.includes('32') || format.includes('flt')) {
        this.metadata.bitDepth = 32;
      } else {
        this.metadata.bitDepth = 16; // Default
      }
    }

    // Extract bitrate
    const bitrateMatch = message.match(/bitrate: (\d+) kb\/s/);
    if (bitrateMatch) {
      this.metadata.bitrate = parseInt(bitrateMatch[1]);
    }
  }

  /**
   * Process a media file
   * @param {File} file - The media file to process
   */
  async processFile(file) {
    if (!this.isLoaded) {
      await this.initialize();
    }

    this.currentFile = file;
    const inputName = 'input' + this.getExtension(file.name);

    try {
      // Step 1: Load file into FFmpeg
      this.updateStage('Loading media...');
      this.updateProgress(5);

      const fileData = await this.fetchFile(file);
      await this.ffmpeg.writeFile(inputName, fileData);

      this.updateProgress(15);

      // Step 2: Probe the file for audio streams
      this.updateStage('Detecting audio streams...');
      await this.probeFile(inputName);

      this.updateProgress(25);

      // Step 3: Extract audio to WAV (intermediate format for analysis)
      this.updateStage('Extracting audio...');
      const wavData = await this.extractAudio(inputName);

      this.updateProgress(60);

      // Step 4: Load into Web Audio API for analysis
      this.updateStage('Analyzing audio...');
      await this.loadAudioBuffer(wavData);

      this.updateProgress(75);

      // Step 5: Detect tempo and key (using Web Worker if available)
      this.updateStage('Detecting tempo & key...');
      const analysisResult = await this.analyzeAudio(this.audioBuffer);

      this.metadata.tempo = analysisResult.tempo;
      this.metadata.key = analysisResult.key;

      this.updateProgress(100);
      this.updateStage('Analysis complete');

      // Clean up input file
      await this.ffmpeg.deleteFile(inputName);

      return {
        metadata: this.metadata,
        audioBuffer: this.audioBuffer,
        wavData: wavData
      };
    } catch (error) {
      console.error('Error processing file:', error);
      throw error;
    }
  }

  /**
   * Process a URL
   * @param {string} url - The URL to process
   */
  async processURL(url) {
    if (!this.isLoaded) {
      await this.initialize();
    }

    try {
      this.updateStage('Fetching media...');
      this.updateProgress(5);

      // Fetch the URL content
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to fetch URL');
      }

      const blob = await response.blob();
      const fileName = this.extractFileName(url) || 'media';
      const file = new File([blob], fileName, { type: blob.type });

      // Process as file
      return await this.processFile(file);
    } catch (error) {
      console.error('Error processing URL:', error);
      throw new Error('Failed to process URL: ' + error.message);
    }
  }

  /**
   * Probe file for audio stream information
   */
  async probeFile(inputName) {
    try {
      // Run FFmpeg with info flag to get stream info
      await this.ffmpeg.exec(['-i', inputName, '-hide_banner']);
    } catch (e) {
      // FFmpeg exits with error when only probing, but we get the info in logs
    }
  }

  /**
   * Extract audio from media file
   * @bugfix Now respects preserveSampleRate setting
   */
  async extractAudio(inputName) {
    const outputName = 'output.wav';

    // Store original sample rate
    this.metadata.originalSampleRate = this.metadata.sampleRate;

    // Determine target sample rate based on settings
    let targetSampleRate;

    if (this.settings.preserveSampleRate) {
      // Preserve original sample rate when setting is enabled
      targetSampleRate = this.metadata.sampleRate;

      // Validate sample rate is within reasonable bounds for WAV
      if (targetSampleRate < 8000 || targetSampleRate > 384000) {
        console.warn(`[AudioProcessor] Unusual sample rate ${targetSampleRate}Hz, defaulting to 48000Hz`);
        targetSampleRate = 48000;
      }
    } else {
      // When not preserving, standardize to common rates
      // Preserve 44.1kHz for CD-quality sources, otherwise use 48kHz
      targetSampleRate = this.metadata.sampleRate === 44100 ? 44100 : 48000;
    }

    console.log(`[AudioProcessor] Sample rate: ${this.metadata.originalSampleRate}Hz -> ${targetSampleRate}Hz (preserve: ${this.settings.preserveSampleRate})`);

    // Extract audio with proper settings
    await this.ffmpeg.exec([
      '-i', inputName,
      '-vn',                          // No video
      '-acodec', 'pcm_s24le',        // 24-bit PCM
      '-ar', targetSampleRate.toString(),
      '-ac', '2',                     // Stereo
      outputName
    ]);

    // Read the output file
    const data = await this.ffmpeg.readFile(outputName);

    // Store extracted audio for conversion
    this.extractedAudio = data;
    this.metadata.sampleRate = targetSampleRate;
    this.metadata.bitDepth = 24;
    this.metadata.channels = 2;

    // Clean up
    await this.ffmpeg.deleteFile(outputName);

    return data;
  }

  /**
   * Analyze audio for tempo and key
   * Uses Web Worker for non-blocking analysis when available
   * @bugfix Now properly uses Web Worker instead of main thread
   */
  async analyzeAudio(audioBuffer) {
    const channelData = this.getMono(audioBuffer);
    const sampleRate = audioBuffer.sampleRate;

    // Try Web Worker first
    if (this.analysisWorker) {
      try {
        console.log('[AudioProcessor] Running analysis in Web Worker');
        const result = await this.runWorkerAnalysis('analyzeAll', channelData, sampleRate);
        return result;
      } catch (error) {
        console.warn('[AudioProcessor] Worker analysis failed, falling back to main thread:', error);
      }
    }

    // Fallback to main thread analysis
    console.log('[AudioProcessor] Running analysis on main thread');

    // Lazy-initialize detectors only when needed
    if (!this.tempoDetector) {
      this.tempoDetector = new TempoDetector();
    }
    if (!this.keyDetector) {
      this.keyDetector = new KeyDetector();
    }

    const [tempo, key] = await Promise.all([
      this.tempoDetector.analyze(audioBuffer),
      this.keyDetector.analyze(audioBuffer)
    ]);

    return { tempo, key };
  }

  /**
   * Convert audio buffer to mono
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
   * Load audio into Web Audio API for analysis
   */
  async loadAudioBuffer(wavData) {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    // Convert Uint8Array to ArrayBuffer
    const arrayBuffer = wavData.buffer.slice(
      wavData.byteOffset,
      wavData.byteOffset + wavData.byteLength
    );

    // Decode audio
    this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
    this.metadata.duration = this.audioBuffer.duration;

    return this.audioBuffer;
  }

  /**
   * Convert extracted audio to specified format
   * @param {string} format - Target format (flac, wav, mp3, aac)
   */
  async convertToFormat(format) {
    if (!this.extractedAudio) {
      throw new Error('No audio extracted. Process a file first.');
    }

    const inputName = 'temp_audio.wav';
    let outputName, ffmpegArgs;

    // Write the extracted audio to FFmpeg filesystem
    await this.ffmpeg.writeFile(inputName, this.extractedAudio);

    switch (format.toLowerCase()) {
      case 'flac':
        outputName = 'output.flac';
        ffmpegArgs = [
          '-i', inputName,
          '-acodec', 'flac',
          '-compression_level', '8',    // Highest compression
          '-sample_fmt', 's32',         // 32-bit for best quality
          outputName
        ];
        break;

      case 'wav':
        outputName = 'output.wav';
        ffmpegArgs = [
          '-i', inputName,
          '-acodec', 'pcm_s24le',       // 24-bit PCM
          outputName
        ];
        break;

      case 'mp3':
        outputName = 'output.mp3';
        ffmpegArgs = [
          '-i', inputName,
          '-acodec', 'libmp3lame',
          '-b:a', '320k',               // Highest MP3 bitrate
          '-q:a', '0',                  // Best quality
          outputName
        ];
        break;

      case 'aac':
        outputName = 'output.m4a';
        ffmpegArgs = [
          '-i', inputName,
          '-acodec', 'aac',
          '-b:a', '256k',               // High AAC bitrate
          '-movflags', '+faststart',    // Optimize for streaming
          outputName
        ];
        break;

      default:
        throw new Error('Unsupported format: ' + format);
    }

    this.updateStage(`Converting to ${format.toUpperCase()}...`);
    this.updateProgress(10);

    // Run conversion
    await this.ffmpeg.exec(ffmpegArgs);

    this.updateProgress(90);

    // Read output file
    const outputData = await this.ffmpeg.readFile(outputName);

    // Clean up
    await this.ffmpeg.deleteFile(inputName);
    await this.ffmpeg.deleteFile(outputName);

    this.updateProgress(100);
    this.updateStage('Conversion complete');

    // Create blob with correct MIME type
    const mimeTypes = {
      'flac': 'audio/flac',
      'wav': 'audio/wav',
      'mp3': 'audio/mpeg',
      'aac': 'audio/mp4'
    };

    const blob = new Blob([outputData], { type: mimeTypes[format] });

    return {
      blob,
      fileName: this.generateFileName(format),
      mimeType: mimeTypes[format]
    };
  }

  /**
   * Generate output filename
   */
  generateFileName(format) {
    if (!this.currentFile) return `audio.${format}`;

    const baseName = this.currentFile.name.replace(/\.[^/.]+$/, '');
    const extension = format === 'aac' ? 'm4a' : format;

    return `${baseName}.${extension}`;
  }

  /**
   * Get file extension
   */
  getExtension(filename) {
    const match = filename.match(/\.[^/.]+$/);
    return match ? match[0] : '';
  }

  /**
   * Extract filename from URL
   */
  extractFileName(url) {
    try {
      const urlObj = new URL(url);
      const path = urlObj.pathname;
      const match = path.match(/\/([^/]+)$/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  /**
   * Generate waveform data for visualization
   */
  generateWaveformData(samples = 200) {
    if (!this.audioBuffer) return [];

    const channelData = this.audioBuffer.getChannelData(0);
    const blockSize = Math.floor(channelData.length / samples);
    const waveformData = [];

    for (let i = 0; i < samples; i++) {
      const start = i * blockSize;
      let max = 0;

      for (let j = 0; j < blockSize; j++) {
        const value = Math.abs(channelData[start + j] || 0);
        if (value > max) max = value;
      }

      waveformData.push(max);
    }

    return waveformData;
  }

  /**
   * Update progress callback
   */
  updateProgress(percent) {
    if (this.onProgress) {
      this.onProgress(percent);
    }
  }

  /**
   * Update stage callback
   */
  updateStage(stage) {
    if (this.onStageChange) {
      this.onStageChange(stage);
    }
  }

  /**
   * Clean up resources
   */
  destroy() {
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.audioBuffer = null;
    this.extractedAudio = null;
    this.currentFile = null;
  }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.AudioProcessor = AudioProcessor;
}
