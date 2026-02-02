/**
 * Media Sourceror - Main Application
 * AI-powered audio extraction and analysis tool
 *
 * @version 1.2.0
 * @bugfix Now passes preserveSampleRate setting to AudioProcessor
 */

class MediaSourcerorApp {
  constructor() {
    // State
    this.processor = null;
    this.audioElement = null;
    this.isPlaying = false;
    this.currentResult = null;
    this.waveformData = [];

    // DOM Elements
    this.elements = {};

    // Settings
    this.settings = {
      preserveSampleRate: true,
      autoDetectMusic: true,
      showWaveform: true
    };

    // Initialize on DOM ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.init());
    } else {
      this.init();
    }
  }

  /**
   * Initialize the application
   */
  async init() {
    this.cacheElements();
    this.bindEvents();
    this.loadSettings();
    this.registerServiceWorker();
    this.initAudioProcessor();

    console.log('Media Sourceror initialized');
  }

  /**
   * Cache DOM elements
   */
  cacheElements() {
    this.elements = {
      // Sections
      uploadSection: document.getElementById('uploadSection'),
      processingSection: document.getElementById('processingSection'),
      resultsSection: document.getElementById('resultsSection'),

      // Upload
      urlInput: document.getElementById('urlInput'),
      urlSubmitBtn: document.getElementById('urlSubmitBtn'),
      dropZone: document.getElementById('dropZone'),
      fileInput: document.getElementById('fileInput'),

      // Processing
      fileName: document.getElementById('fileName'),
      fileSize: document.getElementById('fileSize'),
      progressFill: document.getElementById('progressFill'),
      progressStage: document.getElementById('progressStage'),
      progressPercent: document.getElementById('progressPercent'),
      cancelBtn: document.getElementById('cancelBtn'),
      steps: {
        step1: document.getElementById('step1'),
        step2: document.getElementById('step2'),
        step3: document.getElementById('step3'),
        step4: document.getElementById('step4')
      },

      // Results
      newExtractBtn: document.getElementById('newExtractBtn'),
      waveformCanvas: document.getElementById('waveformCanvas'),
      playBtn: document.getElementById('playBtn'),
      seekBar: document.getElementById('seekBar'),
      currentTime: document.getElementById('currentTime'),
      totalTime: document.getElementById('totalTime'),

      // Metadata
      metaDuration: document.getElementById('metaDuration'),
      metaSampleRate: document.getElementById('metaSampleRate'),
      metaChannels: document.getElementById('metaChannels'),
      metaBitDepth: document.getElementById('metaBitDepth'),
      metaTempo: document.getElementById('metaTempo'),
      metaKey: document.getElementById('metaKey'),

      // Download
      formatBtns: document.querySelectorAll('.format-btn'),
      downloadProgress: document.getElementById('downloadProgress'),
      downloadStatus: document.getElementById('downloadStatus'),
      downloadBarFill: document.getElementById('downloadBarFill'),

      // Settings
      menuBtn: document.getElementById('menuBtn'),
      settingsPanel: document.getElementById('settingsPanel'),
      settingsOverlay: document.getElementById('settingsOverlay'),
      settingsClose: document.getElementById('settingsClose'),
      preserveSampleRate: document.getElementById('preserveSampleRate'),
      autoDetectMusic: document.getElementById('autoDetectMusic'),
      showWaveform: document.getElementById('showWaveform'),

      // Toast
      toastContainer: document.getElementById('toastContainer'),

      // Audio
      audioPlayer: document.getElementById('audioPlayer')
    };

    this.audioElement = this.elements.audioPlayer;
  }

  /**
   * Bind event listeners
   */
  bindEvents() {
    // URL input
    this.elements.urlSubmitBtn.addEventListener('click', () => this.handleURLSubmit());
    this.elements.urlInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.handleURLSubmit();
    });

    // File drop zone
    this.elements.dropZone.addEventListener('click', () => this.elements.fileInput.click());
    this.elements.dropZone.addEventListener('dragover', (e) => this.handleDragOver(e));
    this.elements.dropZone.addEventListener('dragleave', (e) => this.handleDragLeave(e));
    this.elements.dropZone.addEventListener('drop', (e) => this.handleDrop(e));
    this.elements.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));

    // Processing
    this.elements.cancelBtn.addEventListener('click', () => this.cancelProcessing());

    // Results
    this.elements.newExtractBtn.addEventListener('click', () => this.resetToUpload());
    this.elements.playBtn.addEventListener('click', () => this.togglePlayback());
    this.elements.seekBar.addEventListener('input', (e) => this.handleSeek(e));

    // Audio player events
    this.audioElement.addEventListener('timeupdate', () => this.updateTimeDisplay());
    this.audioElement.addEventListener('ended', () => this.handlePlaybackEnd());
    this.audioElement.addEventListener('loadedmetadata', () => this.handleAudioLoaded());

    // Format buttons
    this.elements.formatBtns.forEach(btn => {
      btn.addEventListener('click', () => this.handleFormatSelect(btn));
    });

    // Settings
    this.elements.menuBtn.addEventListener('click', () => this.toggleSettings(true));
    this.elements.settingsOverlay.addEventListener('click', () => this.toggleSettings(false));
    this.elements.settingsClose.addEventListener('click', () => this.toggleSettings(false));

    // Settings toggles
    this.elements.preserveSampleRate.addEventListener('change', (e) => {
      this.settings.preserveSampleRate = e.target.checked;
      this.saveSettings();
      // Update processor settings
      if (this.processor) {
        this.processor.updateSettings({ preserveSampleRate: e.target.checked });
      }
    });

    this.elements.autoDetectMusic.addEventListener('change', (e) => {
      this.settings.autoDetectMusic = e.target.checked;
      this.saveSettings();
    });

    this.elements.showWaveform.addEventListener('change', (e) => {
      this.settings.showWaveform = e.target.checked;
      this.saveSettings();
    });

    // Prevent default behaviors
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => e.preventDefault());
  }

  /**
   * Initialize audio processor
   * @bugfix Now passes settings to AudioProcessor
   */
  async initAudioProcessor() {
    try {
      this.processor = new AudioProcessor({
        preserveSampleRate: this.settings.preserveSampleRate,
        useWebWorker: true
      });

      this.processor.onProgress = (percent) => {
        this.updateProgress(percent);
      };

      this.processor.onStageChange = (stage) => {
        this.updateStage(stage);
      };

      console.log('[MediaSourceror] Audio processor created');
    } catch (error) {
      console.error('[MediaSourceror] Failed to create audio processor:', error);
      this.showToast('Failed to initialize audio engine', 'error');
    }
  }

  /**
   * Register service worker
   */
  async registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js');
        console.log('Service Worker registered:', registration.scope);
      } catch (error) {
        console.error('Service Worker registration failed:', error);
      }
    }
  }

  /**
   * Handle URL submission
   */
  async handleURLSubmit() {
    const url = this.elements.urlInput.value.trim();

    if (!url) {
      this.showToast('Please enter a URL', 'error');
      return;
    }

    if (!this.isValidURL(url)) {
      this.showToast('Please enter a valid URL', 'error');
      return;
    }

    await this.processMedia(url, 'url');
  }

  /**
   * Validate URL
   */
  isValidURL(string) {
    try {
      new URL(string);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Handle drag over
   */
  handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    this.elements.dropZone.classList.add('drag-over');
  }

  /**
   * Handle drag leave
   */
  handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    this.elements.dropZone.classList.remove('drag-over');
  }

  /**
   * Handle file drop
   */
  async handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    this.elements.dropZone.classList.remove('drag-over');

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      await this.processMedia(files[0], 'file');
    }
  }

  /**
   * Handle file selection
   */
  async handleFileSelect(e) {
    const files = e.target.files;
    if (files.length > 0) {
      await this.processMedia(files[0], 'file');
    }
  }

  /**
   * Process media (file or URL)
   */
  async processMedia(source, type) {
    try {
      // Show processing section
      this.showSection('processing');

      // Update file info
      if (type === 'file') {
        this.elements.fileName.textContent = source.name;
        this.elements.fileSize.textContent = this.formatFileSize(source.size);
      } else {
        this.elements.fileName.textContent = this.extractFileName(source) || 'URL Media';
        this.elements.fileSize.textContent = 'Fetching...';
      }

      // Reset progress
      this.resetProgress();

      // Initialize processor if needed
      if (!this.processor || !this.processor.isLoaded) {
        this.setStepActive('step1');
        this.updateStage('Loading audio engine...');

        // Ensure processor exists
        if (!this.processor) {
          await this.initAudioProcessor();
        }

        try {
          await this.processor.initialize();
          this.setStepCompleted('step1');
        } catch (initError) {
          console.error('[MediaSourceror] Initialization failed:', initError);
          throw new Error('Failed to load audio engine. Please refresh the page and try again.');
        }
      } else {
        this.setStepCompleted('step1');
        this.updateProgress(25);
      }

      // Process the media
      this.setStepActive('step2');
      this.updateStage(type === 'file' ? 'Processing file...' : 'Fetching media...');
      let result;

      if (type === 'file') {
        result = await this.processor.processFile(source);
      } else {
        result = await this.processor.processURL(source);
      }

      this.setStepCompleted('step2');
      this.setStepActive('step3');
      this.updateStage('Analyzing audio...');

      // Short delay for UI
      await this.delay(300);
      this.setStepCompleted('step3');

      if (this.settings.autoDetectMusic) {
        this.setStepActive('step4');
        this.updateStage('Detecting tempo & key...');
        await this.delay(500);
        this.setStepCompleted('step4');
      }

      // Store result
      this.currentResult = result;

      // Generate waveform data
      this.waveformData = this.processor.generateWaveformData(200);

      // Update progress to 100%
      this.updateProgress(100);
      this.updateStage('Complete!');

      // Show results
      this.showResults(result);

    } catch (error) {
      console.error('[MediaSourceror] Processing error:', error);
      this.showToast(error.message || 'Failed to process media. Please try again.', 'error');
      this.resetToUpload();
    }
  }

  /**
   * Show results
   */
  showResults(result) {
    // Update metadata display
    this.elements.metaDuration.textContent = this.formatDuration(result.metadata.duration);
    this.elements.metaSampleRate.textContent = `${(result.metadata.sampleRate / 1000).toFixed(1)} kHz`;
    this.elements.metaChannels.textContent = result.metadata.channels === 1 ? 'Mono' :
                                              result.metadata.channels === 2 ? 'Stereo' :
                                              `${result.metadata.channels} ch`;
    this.elements.metaBitDepth.textContent = `${result.metadata.bitDepth} bit`;

    // Update tempo and key
    if (result.metadata.tempo) {
      this.elements.metaTempo.textContent = `${result.metadata.tempo.bpm} BPM`;
    } else {
      this.elements.metaTempo.textContent = '--';
    }

    if (result.metadata.key) {
      this.elements.metaKey.textContent = result.metadata.key.fullKey;
    } else {
      this.elements.metaKey.textContent = '--';
    }

    // Create audio blob for playback
    const wavBlob = new Blob([result.wavData], { type: 'audio/wav' });
    const audioUrl = URL.createObjectURL(wavBlob);
    this.audioElement.src = audioUrl;

    // Draw waveform
    if (this.settings.showWaveform) {
      this.drawWaveform();
    }

    // Show results section
    this.showSection('results');
  }

  /**
   * Draw waveform visualization
   */
  drawWaveform() {
    const canvas = this.elements.waveformCanvas;
    const ctx = canvas.getContext('2d');

    // Set canvas size
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    const width = rect.width;
    const height = rect.height;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw waveform
    const barWidth = width / this.waveformData.length;
    const centerY = height / 2;

    // Create gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, 'rgba(34, 211, 238, 0.8)');
    gradient.addColorStop(0.5, 'rgba(13, 148, 136, 0.6)');
    gradient.addColorStop(1, 'rgba(34, 211, 238, 0.8)');

    ctx.fillStyle = gradient;

    for (let i = 0; i < this.waveformData.length; i++) {
      const value = this.waveformData[i];
      const barHeight = value * height * 0.8;

      ctx.fillRect(
        i * barWidth,
        centerY - barHeight / 2,
        barWidth - 1,
        barHeight
      );
    }
  }

  /**
   * Handle format selection
   */
  async handleFormatSelect(button) {
    const format = button.dataset.format;

    // Update UI
    this.elements.formatBtns.forEach(btn => btn.classList.remove('selected'));
    button.classList.add('selected');

    // Show download progress
    this.elements.downloadProgress.classList.remove('hidden');
    this.elements.downloadStatus.textContent = `Converting to ${format.toUpperCase()}...`;
    this.elements.downloadBarFill.style.width = '0%';

    try {
      // Set up progress callback
      this.processor.onProgress = (percent) => {
        this.elements.downloadBarFill.style.width = `${percent}%`;
      };

      // Convert
      const result = await this.processor.convertToFormat(format);

      this.elements.downloadStatus.textContent = 'Download ready!';
      this.elements.downloadBarFill.style.width = '100%';

      // Trigger download
      this.downloadFile(result.blob, result.fileName);

      // Hide progress after delay
      setTimeout(() => {
        this.elements.downloadProgress.classList.add('hidden');
        button.classList.remove('selected');
      }, 1500);

      this.showToast('Download started!', 'success');

    } catch (error) {
      console.error('Conversion error:', error);
      this.showToast('Conversion failed: ' + error.message, 'error');
      this.elements.downloadProgress.classList.add('hidden');
      button.classList.remove('selected');
    }
  }

  /**
   * Download file
   */
  downloadFile(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Toggle playback
   */
  togglePlayback() {
    if (this.isPlaying) {
      this.audioElement.pause();
      this.isPlaying = false;
      this.elements.playBtn.classList.remove('playing');
    } else {
      this.audioElement.play();
      this.isPlaying = true;
      this.elements.playBtn.classList.add('playing');
    }
  }

  /**
   * Handle seek
   */
  handleSeek(e) {
    const percent = e.target.value / 100;
    this.audioElement.currentTime = percent * this.audioElement.duration;
  }

  /**
   * Update time display
   */
  updateTimeDisplay() {
    const current = this.audioElement.currentTime;
    const duration = this.audioElement.duration;

    this.elements.currentTime.textContent = this.formatTime(current);
    this.elements.seekBar.value = (current / duration) * 100;
  }

  /**
   * Handle audio loaded
   */
  handleAudioLoaded() {
    this.elements.totalTime.textContent = this.formatTime(this.audioElement.duration);
  }

  /**
   * Handle playback end
   */
  handlePlaybackEnd() {
    this.isPlaying = false;
    this.elements.playBtn.classList.remove('playing');
    this.elements.seekBar.value = 0;
  }

  /**
   * Cancel processing
   */
  cancelProcessing() {
    // Reset processor state
    if (this.processor) {
      this.processor.destroy();
      this.initAudioProcessor();
    }

    this.resetToUpload();
    this.showToast('Processing cancelled', 'info');
  }

  /**
   * Reset to upload section
   */
  resetToUpload() {
    this.showSection('upload');
    this.elements.urlInput.value = '';
    this.elements.fileInput.value = '';
    this.currentResult = null;

    // Stop any playing audio
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.src = '';
    }
    this.isPlaying = false;
    this.elements.playBtn.classList.remove('playing');
  }

  /**
   * Show section
   */
  showSection(section) {
    this.elements.uploadSection.classList.toggle('hidden', section !== 'upload');
    this.elements.processingSection.classList.toggle('hidden', section !== 'processing');
    this.elements.resultsSection.classList.toggle('hidden', section !== 'results');
  }

  /**
   * Reset progress
   */
  resetProgress() {
    this.elements.progressFill.style.width = '0%';
    this.elements.progressPercent.textContent = '0%';
    this.elements.progressStage.textContent = 'Initializing...';

    // Reset steps
    Object.values(this.elements.steps).forEach(step => {
      step.classList.remove('active', 'completed');
    });
  }

  /**
   * Update progress
   */
  updateProgress(percent) {
    this.elements.progressFill.style.width = `${percent}%`;
    this.elements.progressPercent.textContent = `${percent}%`;
  }

  /**
   * Update stage
   */
  updateStage(stage) {
    this.elements.progressStage.textContent = stage;
  }

  /**
   * Set step active
   */
  setStepActive(stepId) {
    this.elements.steps[stepId].classList.add('active');
    this.elements.steps[stepId].classList.remove('completed');
  }

  /**
   * Set step completed
   */
  setStepCompleted(stepId) {
    this.elements.steps[stepId].classList.remove('active');
    this.elements.steps[stepId].classList.add('completed');
  }

  /**
   * Toggle settings panel
   */
  toggleSettings(show) {
    this.elements.settingsPanel.classList.toggle('hidden', !show);
  }

  /**
   * Load settings from localStorage
   */
  loadSettings() {
    const saved = localStorage.getItem('mediaSourcerorSettings');
    if (saved) {
      try {
        this.settings = { ...this.settings, ...JSON.parse(saved) };
      } catch (e) {
        console.error('Failed to load settings:', e);
      }
    }

    // Apply to UI
    this.elements.preserveSampleRate.checked = this.settings.preserveSampleRate;
    this.elements.autoDetectMusic.checked = this.settings.autoDetectMusic;
    this.elements.showWaveform.checked = this.settings.showWaveform;
  }

  /**
   * Save settings to localStorage
   */
  saveSettings() {
    localStorage.setItem('mediaSourcerorSettings', JSON.stringify(this.settings));
  }

  /**
   * Show toast notification
   */
  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = 'toast';

    const icons = {
      success: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>',
      error: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
      info: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>'
    };

    toast.innerHTML = `
      <span class="toast-icon ${type}">${icons[type]}</span>
      <span class="toast-message"></span>
    `;
    toast.querySelector('.toast-message').textContent = message;

    this.elements.toastContainer.appendChild(toast);

    // Remove after delay
    setTimeout(() => {
      toast.classList.add('toast-out');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  /**
   * Format file size
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Format duration
   */
  formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Format time
   */
  formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Extract filename from URL
   */
  extractFileName(url) {
    try {
      const urlObj = new URL(url);
      const path = urlObj.pathname;
      const match = path.match(/\/([^/]+)$/);
      return match ? decodeURIComponent(match[1]) : null;
    } catch {
      return null;
    }
  }

  /**
   * Delay helper
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Initialize app
const app = new MediaSourcerorApp();

// Export for debugging
if (typeof window !== 'undefined') {
  window.MediaSourcerorApp = MediaSourcerorApp;
  window.app = app;
}
