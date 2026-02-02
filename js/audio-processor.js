/**
 * Audio Processor Module
 * Handles audio extraction, analysis, and format conversion
 * Uses FFmpeg.wasm for media processing
 */

class AudioProcessor {
  constructor() {
    this.ffmpeg = null;
    this.isLoaded = false;
    this.audioContext = null;
    this.currentFile = null;
    this.extractedAudio = null;
    this.audioBuffer = null;

    // Audio metadata
    this.metadata = {
      duration: 0,
      sampleRate: 0,
      channels: 0,
      bitDepth: 0,
      codec: '',
      bitrate: 0
    };

    // Detectors
    this.tempoDetector = new TempoDetector();
    this.keyDetector = new KeyDetector();

    // Processing callbacks
    this.onProgress = null;
    this.onStageChange = null;
  }

  /**
   * Initialize FFmpeg
   */
  async initialize() {
    if (this.isLoaded) return true;

    try {
      this.updateStage('Loading FFmpeg...');

      // Wait for FFmpeg to be available from CDN
      let attempts = 0;
      while ((!window.FFmpegWASM?.FFmpeg || !window.FFmpegUtil?.fetchFile) && attempts < 50) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }

      if (!window.FFmpegWASM?.FFmpeg) {
        throw new Error('FFmpeg failed to load from CDN');
      }

      // Access FFmpeg from the global scope (loaded via CDN)
      const FFmpeg = window.FFmpegWASM.FFmpeg;
      const fetchFile = window.FFmpegUtil.fetchFile;

      this.ffmpeg = new FFmpeg();
      this.fetchFile = fetchFile;

      // Set up progress handler
      this.ffmpeg.on('progress', ({ progress }) => {
        if (this.onProgress) {
          this.onProgress(Math.round(progress * 100));
        }
      });

      // Set up log handler for debugging
      this.ffmpeg.on('log', ({ message }) => {
        console.log('[FFmpeg]', message);
        this.parseFFmpegLog(message);
      });

      // Load FFmpeg core
      await this.ffmpeg.load({
        coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js',
        wasmURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm',
      });

      this.isLoaded = true;
      this.updateStage('FFmpeg ready');

      return true;
    } catch (error) {
      console.error('Failed to load FFmpeg:', error);
      throw new Error('Failed to initialize audio processor');
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

      // Step 5: Detect tempo and key
      this.updateStage('Detecting tempo & key...');
      const [tempoResult, keyResult] = await Promise.all([
        this.tempoDetector.analyze(this.audioBuffer),
        this.keyDetector.analyze(this.audioBuffer)
      ]);

      this.metadata.tempo = tempoResult;
      this.metadata.key = keyResult;

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
   */
  async extractAudio(inputName) {
    const outputName = 'output.wav';

    // Determine optimal sample rate
    // Preserve original if 44100 or 48000, otherwise resample to 48000
    const targetSampleRate = this.metadata.sampleRate === 44100 ? 44100 : 48000;

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
