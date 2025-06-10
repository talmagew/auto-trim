// Audio and processing variables
let audioBuffer = null;
let wavesurfer = null;
let sttProcessor = null;
let isProcessing = false;
let audioDuration = 0;
let transcriptData = [];
let originalFileInfo = null;

// Enhanced STT Processing with Google Cloud and Whisper.cpp
class AudioSTTProcessor {
    constructor() {
        this.whisperWorker = null;
        this.isWhisperLoaded = false;
        this.maxSyncFileSize = 10 * 1024 * 1024; // 10MB for Google Cloud sync
        this.maxAsyncFileSize = 1024 * 1024 * 1024; // 1GB for Google Cloud async
        this.chunkDuration = 30; // seconds per chunk
    }

    async processAudioFile(audioBuffer, options = {}) {
        const {
            method = 'cloud-google',
            language = 'en-US',
            enableTimestamps = true,
            confidenceTracking = true,
            chunkSize = 30
        } = options;

        // Clear previous results
        transcriptData = [];
        
        // Show processing status
        const processingStatus = document.getElementById('processing-status');
        if (processingStatus) {
            processingStatus.style.display = 'block';
        }
        this.updateProgress(0);

        try {
            let results;
            
            // Check file size and choose processing strategy
            const estimatedFileSize = this.estimateAudioFileSize(audioBuffer);
            
            if (method === 'cloud-google') {
                if (estimatedFileSize > this.maxAsyncFileSize) {
                    // File too large, use chunking
                    results = await this.processWithChunking(audioBuffer, options);
                } else if (estimatedFileSize > this.maxSyncFileSize) {
                    // Use async API
                    results = await this.processWithGoogleCloudAsync(audioBuffer, options);
                } else {
                    // Use sync API
                    results = await this.processWithGoogleCloud(audioBuffer, options);
                }
            } else if (method === 'whisper-wasm') {
                results = await this.processWithWhisper(audioBuffer, options);
            } else {
                throw new Error(`Unsupported STT method: ${method}`);
            }
            
            this.updateProgress(100);
            setTimeout(() => {
                const processingStatus = document.getElementById('processing-status');
                if (processingStatus) {
                    processingStatus.style.display = 'none';
                }
            }, 1000);
            
            return results;
            
        } catch (error) {
            const processingStatus = document.getElementById('processing-status');
            if (processingStatus) {
                processingStatus.style.display = 'none';
            }
            throw error;
        }
    }

    estimateAudioFileSize(audioBuffer) {
        // Estimate WAV file size: (sample rate * channels * bit depth * duration) / 8
        const sampleRate = audioBuffer.sampleRate;
        const channels = audioBuffer.numberOfChannels;
        const duration = audioBuffer.duration;
        const bitDepth = 16; // We use 16-bit PCM
        
        return Math.ceil((sampleRate * channels * bitDepth * duration) / 8);
    }

    async processWithChunking(audioBuffer, options) {
        const chunks = this.createAudioChunks(audioBuffer, this.chunkDuration);
        const allResults = [];
        
        this.updateProgress(5);
        
        for (let i = 0; i < chunks.length; i++) {
            try {
                this.updateProcessingStatus(`Processing chunk ${i + 1}/${chunks.length}...`);
                
                // Process chunk directly (bypassing file size check to avoid recursion)
                const chunkResults = await this.processChunkDirectly(chunks[i].buffer, options);
                
                // Adjust timestamps for chunk offset
                const adjustedResults = chunkResults.map(result => ({
                    ...result,
                    startTime: result.startTime + chunks[i].startTime,
                    endTime: result.endTime + chunks[i].startTime,
                    words: result.words.map(word => ({
                        ...word,
                        startTime: word.startTime + chunks[i].startTime,
                        endTime: word.endTime + chunks[i].startTime
                    }))
                }));
                
                allResults.push(...adjustedResults);
                
                const progress = 10 + (i + 1) / chunks.length * 80;
                this.updateProgress(progress);
                
            } catch (error) {
                console.warn(`Chunk ${i + 1} processing failed:`, error);
                // Add placeholder for failed chunk
                allResults.push({
                    text: `[Chunk ${i + 1} processing failed: ${error.message}]`,
                    startTime: chunks[i].startTime,
                    endTime: chunks[i].startTime + this.chunkDuration,
                    confidence: 0.0,
                    words: []
                });
            }
        }
        
        return allResults;
    }

    createAudioChunks(audioBuffer, chunkDurationSeconds) {
        const chunks = [];
        const totalDuration = audioBuffer.duration;
        const sampleRate = audioBuffer.sampleRate;
        const samplesPerChunk = Math.floor(chunkDurationSeconds * sampleRate);
        
        for (let startTime = 0; startTime < totalDuration; startTime += chunkDurationSeconds) {
            const endTime = Math.min(startTime + chunkDurationSeconds, totalDuration);
            const startSample = Math.floor(startTime * sampleRate);
            const endSample = Math.floor(endTime * sampleRate);
            const chunkLength = endSample - startSample;
            
            // Create new AudioBuffer for this chunk
            const chunkBuffer = new AudioContext().createBuffer(
                audioBuffer.numberOfChannels,
                chunkLength,
                sampleRate
            );
            
            // Copy audio data
            for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
                const originalData = audioBuffer.getChannelData(channel);
                const chunkData = chunkBuffer.getChannelData(channel);
                
                for (let i = 0; i < chunkLength; i++) {
                    chunkData[i] = originalData[startSample + i] || 0;
                }
            }
            
            chunks.push({
                buffer: chunkBuffer,
                startTime: startTime,
                endTime: endTime,
                duration: endTime - startTime
            });
        }
        
        return chunks;
    }

    async processWithGoogleCloudAsync(audioBuffer, options) {
        const apiKey = options.googleApiKey;
        if (!apiKey) {
            throw new Error('Google Cloud API key required');
        }

        const { language } = options;
        
        // Convert audio to base64
        const audioBytes = await this.audioBufferToBase64(audioBuffer);
        
        const requestBody = {
            config: {
                encoding: 'LINEAR16',
                sampleRateHertz: audioBuffer.sampleRate,
                languageCode: language,
                enableWordTimeOffsets: true,
                enableWordConfidence: true,
                model: 'latest_long',
                useEnhanced: true // Better for video content
            },
            audio: {
                content: audioBytes
            }
        };

        this.updateProcessingStatus('Uploading to Google Cloud (large file)...');
        
        // Start long-running operation
        const operationResponse = await fetch(`https://speech.googleapis.com/v1/speech:longrunningrecognize?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
        });

        if (!operationResponse.ok) {
            const errorText = await operationResponse.text();
            throw new Error(`Google Cloud API error: ${operationResponse.status} - ${errorText}`);
        }

        const operation = await operationResponse.json();
        const operationName = operation.name;
        
        // Poll for completion
        return await this.pollGoogleCloudOperation(operationName, apiKey);
    }

    async pollGoogleCloudOperation(operationName, apiKey) {
        let attempts = 0;
        const maxAttempts = 60; // 5 minutes max
        
        while (attempts < maxAttempts) {
            this.updateProcessingStatus(`Processing with Google Cloud... (${attempts * 5}s)`);
            
            const statusResponse = await fetch(`https://speech.googleapis.com/v1/operations/${operationName}?key=${apiKey}`);
            
            if (!statusResponse.ok) {
                throw new Error(`Failed to check operation status: ${statusResponse.status}`);
            }
            
            const status = await statusResponse.json();
            
            if (status.done) {
                if (status.error) {
                    throw new Error(`Google Cloud processing failed: ${status.error.message}`);
                }
                
                return this.parseGoogleCloudResponse(status.response);
            }
            
            // Wait 5 seconds before next check
            await new Promise(resolve => setTimeout(resolve, 5000));
            attempts++;
            
            // Update progress
            const progress = Math.min(30 + (attempts / maxAttempts) * 60, 90);
            this.updateProgress(progress);
        }
        
        throw new Error('Google Cloud processing timeout - file may be too large or complex');
    }

    updateProcessingStatus(message) {
        const progressText = document.getElementById('progress-text');
        if (progressText) {
            progressText.textContent = message;
        }
    }

    // WebAssembly Whisper.cpp integration
    async processWithWhisper(audioBuffer, options) {
        if (!this.isWhisperLoaded) {
            await this.loadWhisperWASM();
        }

        const { language, modelSize } = options;
        
        // Convert audio buffer to format expected by Whisper
        const audioData = this.prepareAudioForWhisper(audioBuffer);
        
        return new Promise((resolve, reject) => {
            this.whisperWorker.postMessage({
                command: 'transcribe',
                audio: audioData,
                language: language,
                modelSize: modelSize || 'base',
                options: options
            });

            this.whisperWorker.onmessage = (event) => {
                const { type, data, progress, error } = event.data;
                
                if (type === 'progress') {
                    this.updateProgress(progress);
                } else if (type === 'result') {
                    resolve(data);
                } else if (type === 'error') {
                    reject(new Error(error));
                }
            };
        });
    }

    async loadWhisperWASM() {
        return new Promise((resolve, reject) => {
            this.whisperWorker = new Worker('whisper-worker.js');
            
            this.whisperWorker.postMessage({ command: 'load' });
            
            this.whisperWorker.onmessage = (event) => {
                if (event.data.type === 'loaded') {
                    this.isWhisperLoaded = true;
                    this.updateWhisperStatus('ready');
                    resolve();
                } else if (event.data.type === 'error') {
                    this.updateWhisperStatus('error', event.data.error);
                    reject(new Error(event.data.error));
                }
            };

            // Timeout after 30 seconds
            setTimeout(() => {
                if (!this.isWhisperLoaded) {
                    this.updateWhisperStatus('timeout');
                    reject(new Error('Whisper WASM loading timeout'));
                }
            }, 30000);
        });
    }

    updateWhisperStatus(status, errorMessage = '') {
        const whisperModelStatus = document.getElementById('whisper-model-status');
        const whisperSetupGuide = document.getElementById('whisper-setup-guide');
        const whisperModelSelection = document.getElementById('whisper-model-selection');
        
        if (!whisperModelStatus) return;
        
        switch (status) {
            case 'checking':
                whisperModelStatus.textContent = '⏳ Checking Whisper.cpp installation...';
                if (whisperSetupGuide) whisperSetupGuide.style.display = 'none';
                if (whisperModelSelection) whisperModelSelection.style.display = 'none';
                break;
            case 'ready':
                whisperModelStatus.textContent = '✅ Whisper.cpp ready for offline processing';
                if (whisperSetupGuide) whisperSetupGuide.style.display = 'none';
                if (whisperModelSelection) whisperModelSelection.style.display = 'block';
                break;
            case 'error':
            case 'timeout':
                whisperModelStatus.textContent = '❌ Whisper.cpp not found - setup required';
                if (whisperSetupGuide) whisperSetupGuide.style.display = 'block';
                if (whisperModelSelection) whisperModelSelection.style.display = 'none';
                break;
        }
    }

    async checkWhisperAvailability() {
        this.updateWhisperStatus('checking');
        
        try {
            // Check if Whisper files exist
            const wasmResponse = await fetch('./whisper.wasm', { method: 'HEAD' });
            const jsResponse = await fetch('./whisper.js', { method: 'HEAD' });
            
            if (wasmResponse.ok && jsResponse.ok) {
                this.updateWhisperStatus('ready');
                return true;
            } else {
                this.updateWhisperStatus('error');
                return false;
            }
        } catch (error) {
            this.updateWhisperStatus('error');
            return false;
        }
    }

    prepareAudioForWhisper(audioBuffer) {
        // Whisper expects 16kHz mono audio
        const targetSampleRate = 16000;
        const audioData = audioBuffer.getChannelData(0);
        
        // Resample if necessary
        if (audioBuffer.sampleRate !== targetSampleRate) {
            return this.resampleAudio(audioData, audioBuffer.sampleRate, targetSampleRate);
        }
        
        return audioData;
    }

    // Google Cloud Speech-to-Text integration
    async processWithGoogleCloud(audioBuffer, options) {
        const apiKey = options.googleApiKey;
        if (!apiKey) {
            throw new Error('Google Cloud API key required');
        }

        const { language } = options;
        
        // Check file size and use appropriate processing method
        const estimatedFileSize = this.estimateAudioFileSize(audioBuffer);
        console.log(`Estimated file size: ${Math.round(estimatedFileSize / 1024 / 1024 * 100) / 100}MB`);
        
        if (estimatedFileSize > this.maxSyncFileSize) {
            console.log('File exceeds 10MB limit, using chunked processing...');
            return await this.processWithChunking(audioBuffer, options);
        }
        
        // Convert audio to base64
        const audioBytes = await this.audioBufferToBase64(audioBuffer);
        
        const requestBody = {
            config: {
                encoding: 'LINEAR16',
                sampleRateHertz: audioBuffer.sampleRate,
                languageCode: language,
                enableWordTimeOffsets: true,
                enableWordConfidence: true,
                model: 'latest_long',
                useEnhanced: true // Better for video content
            },
            audio: {
                content: audioBytes
            }
        };

        const response = await fetch(`https://speech.googleapis.com/v1/speech:recognize?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            let errorMessage = `Google Cloud API error: ${response.status}`;
            
            try {
                const errorData = JSON.parse(errorText);
                if (errorData.error && errorData.error.message) {
                    errorMessage += ` - ${errorData.error.message}`;
                }
            } catch (e) {
                // If we can't parse the error, just show the status
            }
            
            throw new Error(errorMessage);
        }

        const result = await response.json();
        return this.parseGoogleCloudResponse(result);
    }

    // Process a single chunk directly without file size checking
    async processChunkDirectly(audioBuffer, options) {
        const apiKey = options.googleApiKey;
        const { language } = options;
        
        // Convert audio to base64
        const audioBytes = await this.audioBufferToBase64(audioBuffer);
        
        const requestBody = {
            config: {
                encoding: 'LINEAR16',
                sampleRateHertz: audioBuffer.sampleRate,
                languageCode: language,
                enableWordTimeOffsets: true,
                enableWordConfidence: true,
                model: 'latest_long',
                useEnhanced: true
            },
            audio: {
                content: audioBytes
            }
        };

        const response = await fetch(`https://speech.googleapis.com/v1/speech:recognize?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            let errorMessage = `Chunk processing failed: ${response.status}`;
            
            try {
                const errorData = JSON.parse(errorText);
                if (errorData.error && errorData.error.message) {
                    errorMessage += ` - ${errorData.error.message}`;
                }
            } catch (e) {
                errorMessage += ` - ${errorText}`;
            }
            
            throw new Error(errorMessage);
        }

        const result = await response.json();
        return this.parseGoogleCloudResponse(result);
    }

    // Utility functions
    parseGoogleCloudResponse(response) {
        const results = [];
        
        if (response.results && response.results.length > 0) {
            response.results.forEach(result => {
                if (result.alternatives && result.alternatives.length > 0) {
                    const alternative = result.alternatives[0];
                    
                    if (alternative.words && alternative.words.length > 0) {
                        // Group words into sentences
                        let currentSentence = '';
                        let sentenceWords = [];
                        let sentenceStart = parseFloat(alternative.words[0].startTime.replace('s', ''));
                        
                        alternative.words.forEach((word, index) => {
                            currentSentence += word.word + ' ';
                            sentenceWords.push({
                                word: word.word,
                                startTime: parseFloat(word.startTime.replace('s', '')),
                                endTime: parseFloat(word.endTime.replace('s', '')),
                                confidence: word.confidence || 0.8
                            });
                            
                            // End sentence on punctuation or every 20 words
                            if (word.word.match(/[.!?]$/) || index % 20 === 19 || index === alternative.words.length - 1) {
                                const sentenceEnd = parseFloat(word.endTime.replace('s', ''));
                                results.push({
                                    text: currentSentence.trim(),
                                    startTime: sentenceStart,
                                    endTime: sentenceEnd,
                                    confidence: alternative.confidence || 0.8,
                                    words: sentenceWords
                                });
                                
                                currentSentence = '';
                                sentenceWords = [];
                                if (index < alternative.words.length - 1) {
                                    sentenceStart = parseFloat(alternative.words[index + 1].startTime.replace('s', ''));
                                }
                            }
                        });
                    } else {
                        // Fallback for simple response without word timing
                        results.push({
                            text: alternative.transcript,
                            startTime: 0,
                            endTime: audioDuration,
                            confidence: alternative.confidence || 0.8,
                            words: []
                        });
                    }
                }
            });
        }
        
        return results;
    }

    updateProgress(percentage) {
        const progressBar = document.getElementById('progress-bar');
        const progressText = document.getElementById('progress-text');
        
        if (progressBar) {
            progressBar.style.width = percentage + '%';
        }
        
        if (progressText) {
            if (percentage === 0) {
                progressText.textContent = 'Initializing...';
            } else if (percentage < 30) {
                progressText.textContent = 'Preparing audio...';
            } else if (percentage < 70) {
                progressText.textContent = 'Processing speech...';
            } else if (percentage < 100) {
                progressText.textContent = 'Finalizing results...';
            } else {
                progressText.textContent = 'Complete!';
            }
        }
    }

    async audioBufferToBase64(audioBuffer) {
        // Convert AudioBuffer to WAV format
        const wavData = this.audioBufferToWav(audioBuffer);
        
        // Convert to base64
        let binary = '';
        const bytes = new Uint8Array(wavData);
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    audioBufferToWav(audioBuffer) {
        const numChannels = audioBuffer.numberOfChannels;
        const sampleRate = audioBuffer.sampleRate;
        const format = 1; // PCM
        const bitDepth = 16;
        
        const bytesPerSample = bitDepth / 8;
        const blockAlign = numChannels * bytesPerSample;
        
        const buffer = new ArrayBuffer(44 + audioBuffer.length * numChannels * bytesPerSample);
        const view = new DataView(buffer);
        
        // WAV header
        const writeString = (offset, string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        };
        
        writeString(0, 'RIFF');
        view.setUint32(4, 36 + audioBuffer.length * numChannels * bytesPerSample, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, format, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * blockAlign, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitDepth, true);
        writeString(36, 'data');
        view.setUint32(40, audioBuffer.length * numChannels * bytesPerSample, true);
        
        // Convert float samples to 16-bit PCM
        let offset = 44;
        for (let i = 0; i < audioBuffer.length; i++) {
            for (let channel = 0; channel < numChannels; channel++) {
                const sample = Math.max(-1, Math.min(1, audioBuffer.getChannelData(channel)[i]));
                view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
                offset += 2;
            }
        }
        
        return buffer;
    }

    resampleAudio(inputData, inputSampleRate, outputSampleRate) {
        if (inputSampleRate === outputSampleRate) {
            return inputData;
        }
        
        const ratio = inputSampleRate / outputSampleRate;
        const outputLength = Math.round(inputData.length / ratio);
        const outputData = new Float32Array(outputLength);
        
        for (let i = 0; i < outputLength; i++) {
            const sourceIndex = i * ratio;
            const index = Math.floor(sourceIndex);
            const fraction = sourceIndex - index;
            
            if (index + 1 < inputData.length) {
                outputData[i] = inputData[index] * (1 - fraction) + inputData[index + 1] * fraction;
            } else {
                outputData[i] = inputData[index];
            }
        }
        
        return outputData;
    }
}

// DOM Elements
const fileInput = document.getElementById('file-input');
const fileInfo = document.getElementById('file-info');
const fileName = document.getElementById('file-name');
const fileSize = document.getElementById('file-size');
const fileDuration = document.getElementById('file-duration');
const fileSampleRate = document.getElementById('file-sample-rate');
const fileChannels = document.getElementById('file-channels');

// Audio Controls
const playPauseBtn = document.getElementById('play-pause-btn');
const playIcon = document.getElementById('play-icon');
const pauseIcon = document.getElementById('pause-icon');
const currentTimeSpan = document.getElementById('current-time');
const totalTimeSpan = document.getElementById('total-time');
const volumeSlider = document.getElementById('volume-slider');
const volumeValue = document.getElementById('volume-value');

// STT Elements
const sttControls = document.getElementById('stt-controls');
const processAudioBtn = document.getElementById('process-audio-stt');
const transcriptionStatus = document.getElementById('transcription-status');
const sttOptionsPanel = document.getElementById('stt-options-panel');
const languageSelect = document.getElementById('language-select');
const enableTimestamps = document.getElementById('enable-timestamps');
const confidenceTracking = document.getElementById('confidence-tracking');

// Google Cloud Elements
const googleApiKey = document.getElementById('google-api-key');

// Whisper Elements
const whisperConfig = document.getElementById('whisper-config');
const whisperModelSize = document.getElementById('whisper-model-size');

// Transcript Elements
const transcriptSection = document.getElementById('transcript-section');
const transcriptContent = document.getElementById('transcript-content');
const segmentCount = document.getElementById('segment-count');
const wordCount = document.getElementById('word-count');
const avgConfidence = document.getElementById('avg-confidence');
const copyTranscriptBtn = document.getElementById('copy-transcript');
const downloadTxtBtn = document.getElementById('download-txt');
const downloadSrtBtn = document.getElementById('download-srt');
const downloadVttBtn = document.getElementById('download-vtt');

// Processing Elements
const processingStatus = document.getElementById('processing-status');

// Analysis Elements
const analysisSection = document.getElementById('analysis-section');
const peakCount = document.getElementById('peak-count').querySelector('span');
const rmsEnergy = document.getElementById('rms-energy');
const zeroCrossings = document.getElementById('zero-crossings');
const spectralCentroid = document.getElementById('spectral-centroid');

// Initialize STT Processor
sttProcessor = new AudioSTTProcessor();

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    sttProcessor = new AudioSTTProcessor();
    initializeWaveSurfer();
    setupEventListeners();
    
    // Set initial UI state
    updateUIState('initial');
    
    // Add event listeners for the new UI elements
    const apiKeyInput = document.getElementById('google-api-key');
    if (apiKeyInput) {
        apiKeyInput.addEventListener('input', updateSTTMethodStatus);
    }
    
    const methodRadios = document.querySelectorAll('input[name="stt-method"]');
    methodRadios.forEach(radio => {
        radio.addEventListener('change', handleSTTMethodChange);
    });
    
    const validateApiBtn = document.getElementById('validate-api-key');
    if (validateApiBtn) {
        validateApiBtn.addEventListener('click', validateGoogleApiKey);
    }
    
    const autoSetupBtn = document.getElementById('auto-setup-whisper');
    if (autoSetupBtn) {
        autoSetupBtn.addEventListener('click', autoSetupWhisper);
    }

    // Check Whisper.cpp availability and update UI accordingly
    sttProcessor.checkWhisperAvailability();
});

function initializeWaveSurfer() {
    console.log('Initializing WaveSurfer...');
    
    try {
        // Initialize WaveSurfer
        wavesurfer = WaveSurfer.create({
            container: '#waveform',
            waveColor: 'rgba(255, 255, 255, 0.8)',
            progressColor: 'rgba(255, 255, 255, 1)',
            backgroundColor: 'transparent',
            height: 60,
            barWidth: 2,
            barGap: 1,
            responsive: true,
            normalize: true
        });

        console.log('WaveSurfer created successfully');

        // WaveSurfer event listeners
        wavesurfer.on('ready', () => {
            console.log('WaveSurfer is ready');
            const playPauseBtn = document.getElementById('play-pause-btn');
            const totalTimeSpan = document.getElementById('total-time');
            
            if (playPauseBtn) {
                playPauseBtn.disabled = false;
            }
            
            if (totalTimeSpan) {
                totalTimeSpan.textContent = formatTime(wavesurfer.getDuration());
            }
            
            audioDuration = wavesurfer.getDuration();
            
            // Show sections
            showElement('file-info');
            showElement('stt-controls');
            showElement('stt-options-panel');
            showElement('analysis-section');
            
            // Perform basic audio analysis
            performAudioAnalysis();
        });

        wavesurfer.on('audioprocess', () => {
            const currentTimeSpan = document.getElementById('current-time');
            if (currentTimeSpan) {
                currentTimeSpan.textContent = formatTime(wavesurfer.getCurrentTime());
            }
        });

        wavesurfer.on('play', () => {
            const playIcon = document.getElementById('play-icon');
            const pauseIcon = document.getElementById('pause-icon');
            if (playIcon) playIcon.style.display = 'none';
            if (pauseIcon) pauseIcon.style.display = 'block';
        });

        wavesurfer.on('pause', () => {
            const playIcon = document.getElementById('play-icon');
            const pauseIcon = document.getElementById('pause-icon');
            if (playIcon) playIcon.style.display = 'block';
            if (pauseIcon) pauseIcon.style.display = 'none';
        });

        wavesurfer.on('finish', () => {
            const playIcon = document.getElementById('play-icon');
            const pauseIcon = document.getElementById('pause-icon');
            if (playIcon) playIcon.style.display = 'block';
            if (pauseIcon) pauseIcon.style.display = 'none';
        });

        wavesurfer.on('error', (error) => {
            console.error('WaveSurfer error:', error);
            alert('Error loading audio file: ' + error.message);
        });

        wavesurfer.on('interaction', () => {
            updateTimeDisplay();
        });
        
    } catch (error) {
        console.error('Error initializing WaveSurfer:', error);
        alert('Error initializing WaveSurfer: ' + error.message);
    }
}

function setupEventListeners() {
    console.log('Setting up event listeners...');
    
    // File input handler
    const fileInput = document.getElementById('file-input');
    if (fileInput) {
        fileInput.addEventListener('change', handleFileSelect);
        console.log('File input listener added');
    } else {
        console.error('File input element not found');
    }

    // Audio Controls
    const playPauseBtn = document.getElementById('play-pause-btn');
    if (playPauseBtn) {
        playPauseBtn.addEventListener('click', () => {
            if (wavesurfer) {
                wavesurfer.playPause();
            }
        });
    }

    const volumeSlider = document.getElementById('volume-slider');
    if (volumeSlider) {
        volumeSlider.addEventListener('input', (e) => {
            const value = e.target.value;
            if (wavesurfer) {
                wavesurfer.setVolume(value / 100);
            }
            const volumeValue = document.getElementById('volume-value');
            if (volumeValue) {
                volumeValue.textContent = value + '%';
            }
            
            // Update slider visual
            e.target.style.setProperty('--value', value + '%');
        });
    }

    // STT Processing
    const processAudioBtn = document.getElementById('process-audio-stt');
    if (processAudioBtn) {
        processAudioBtn.addEventListener('click', handleSTTProcessing);
    }

    // STT method change handler
    document.querySelectorAll('input[name="stt-method"]').forEach(radio => {
        radio.addEventListener('change', handleSTTMethodChange);
    });

    // Whisper setup guide button
    const downloadWhisperGuideBtn = document.getElementById('download-whisper-guide');
    if (downloadWhisperGuideBtn) {
        downloadWhisperGuideBtn.addEventListener('click', downloadWhisperGuide);
    }

    // Export functions
    const copyTranscriptBtn = document.getElementById('copy-transcript');
    if (copyTranscriptBtn) {
        copyTranscriptBtn.addEventListener('click', handleCopyTranscript);
    }

    const downloadTxtBtn = document.getElementById('download-txt');
    if (downloadTxtBtn) {
        downloadTxtBtn.addEventListener('click', () => {
            const text = getFullTranscriptText();
            const blob = new Blob([text], { type: 'text/plain' });
            downloadFile(blob, 'transcript.txt');
        });
    }

    const downloadSrtBtn = document.getElementById('download-srt');
    if (downloadSrtBtn) {
        downloadSrtBtn.addEventListener('click', () => {
            const srt = generateSRT();
            const blob = new Blob([srt], { type: 'text/plain' });
            downloadFile(blob, 'transcript.srt');
        });
    }

    const downloadVttBtn = document.getElementById('download-vtt');
    if (downloadVttBtn) {
        downloadVttBtn.addEventListener('click', () => {
            const vtt = generateVTT();
            const blob = new Blob([vtt], { type: 'text/vtt' });
            downloadFile(blob, 'transcript.vtt');
        });
    }
}

function updateUIState(state) {
    const onboardingSection = document.getElementById('onboarding-section');
    const sttControls = document.getElementById('stt-controls');
    const processingStatus = document.getElementById('processing-status');
    const transcriptSection = document.getElementById('transcript-section');
    const analysisSection = document.getElementById('analysis-section');

    // Hide all conditional sections by default
    if (onboardingSection) onboardingSection.style.display = 'none';
    if (sttControls) sttControls.style.display = 'none';
    if (processingStatus) processingStatus.style.display = 'none';
    if (transcriptSection) transcriptSection.style.display = 'none';
    if (analysisSection) analysisSection.style.display = 'none';

    switch (state) {
        case 'initial':
            if (onboardingSection) onboardingSection.style.display = 'block';
            break;
        case 'file-loaded':
            if (sttControls) sttControls.style.display = 'block';
            if (analysisSection) analysisSection.style.display = 'block';
            handleSTTMethodChange();
            break;
        case 'processing':
            if (sttControls) sttControls.style.display = 'block';
            if (analysisSection) analysisSection.style.display = 'block';
            if (processingStatus) processingStatus.style.display = 'block';
            break;
        case 'results':
            if (sttControls) sttControls.style.display = 'block';
            if (analysisSection) analysisSection.style.display = 'block';
            if (transcriptSection) transcriptSection.style.display = 'block';
            break;
    }
}

function updateSTTMethodStatus() {
    const googleStatus = document.getElementById('google-status');
    const whisperStatus = document.getElementById('whisper-status');
    const apiKey = document.getElementById('google-api-key')?.value;
    
    // Update Google Cloud status
    if (googleStatus) {
        const statusSpan = googleStatus.querySelector('.status-indicator');
        if (apiKey && apiKey.trim().length > 0) {
            statusSpan.textContent = '✅ API Key Configured';
            statusSpan.className = 'status-indicator ready';
        } else {
            statusSpan.textContent = '⚠️ API Key Required';
            statusSpan.className = 'status-indicator pending';
        }
    }
    
    // Update process button state
    updateProcessButtonState();
}

function updateProcessButtonState() {
    const processBtn = document.getElementById('process-audio-stt');
    const selectedMethod = document.querySelector('input[name="stt-method"]:checked')?.value;
    const apiKey = document.getElementById('google-api-key')?.value;
    
    if (!processBtn || !audioBuffer) {
        if (processBtn) processBtn.disabled = true;
        return;
    }
    
    let canProcess = false;
    let buttonText = 'Start Transcription';
    
    if (selectedMethod === 'cloud-google') {
        canProcess = apiKey && apiKey.trim().length > 0;
        if (!canProcess) {
            buttonText = 'Enter API Key First';
        }
    } else if (selectedMethod === 'whisper-wasm') {
        // Check if Whisper is available (this would be updated by checkWhisperAvailability)
        canProcess = sttProcessor?.isWhisperLoaded || false;
        if (!canProcess) {
            buttonText = 'Setup Whisper First';
        }
    }
    
    processBtn.disabled = !canProcess;
    const btnText = processBtn.querySelector('.btn-text');
    if (btnText) btnText.textContent = buttonText;
}

function handleSTTMethodChange() {
    const selectedMethod = document.querySelector('input[name="stt-method"]:checked');
    if (!selectedMethod) return;

    const method = selectedMethod.value;
    const cloudConfig = document.getElementById('cloud-config');
    const whisperConfig = document.getElementById('whisper-config');

    // Hide all config sections first
    if (cloudConfig) cloudConfig.style.display = 'none';
    if (whisperConfig) whisperConfig.style.display = 'none';

    // Show relevant config section
    if (method === 'cloud-google' && cloudConfig) {
        cloudConfig.style.display = 'block';
    } else if (method === 'whisper-wasm' && whisperConfig) {
        whisperConfig.style.display = 'block';
    }

    // Update method option styling
    document.querySelectorAll('.method-option').forEach(option => {
        const radio = option.querySelector('input[type="radio"]');
        if (radio && radio.checked) {
            option.style.borderColor = '#667eea';
            option.style.background = '#f0f4ff';
        } else {
            option.style.borderColor = '#e2e8f0';
            option.style.background = 'white';
        }
    });

    updateSTTMethodStatus();
}

async function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    originalFileInfo = {
        name: file.name,
        size: file.size,
        type: file.type
    };

    const fileInfoPreview = document.getElementById('file-info-preview');
    const fileSizeWarning = document.getElementById('file-size-warning');

    if (fileInfoPreview) fileInfoPreview.style.display = 'block';
    if (fileSizeWarning) fileSizeWarning.textContent = `File: ${file.name} (${formatFileSize(file.size)})`;

    try {
        if (isVideoFormat(file)) {
            await handleVideoFile(file);
        } else {
            await handleAudioFile(file);
        }
        updateUIState('file-loaded');
    } catch (error) {
        showErrorModal('File Processing Error', `Failed to process file: ${error.message}`);
        updateUIState('initial');
    }
}

function isVideoFormat(file) {
    const videoExtensions = ['.mov', '.mp4', '.avi', '.mkv', '.mxf', '.braw', '.r3d', '.prores'];
    const videoMimeTypes = [
        'video/quicktime',
        'video/mp4', 
        'video/x-msvideo',
        'video/x-matroska',
        'application/mxf',
        'video/x-blackmagic-raw'
    ];
    
    const fileName = file.name.toLowerCase();
    const fileType = file.type.toLowerCase();
    
    return videoExtensions.some(ext => fileName.endsWith(ext)) || 
           videoMimeTypes.some(type => fileType.includes(type));
}

async function handleVideoFile(file) {
    const transcriptionStatus = document.getElementById('transcription-status');
    if (transcriptionStatus) {
        transcriptionStatus.textContent = 'Processing video file - extracting audio...';
        transcriptionStatus.className = 'processing';
    }
    
    try {
        // Method 1: Try direct video loading with WaveSurfer (works for many formats)
        console.log('Attempting direct video load...');
        const blob = new Blob([file], { type: file.type });
        const url = URL.createObjectURL(blob);
        
        await wavesurfer.load(url);
        
        // Decode the video file directly to get audio
        const arrayBuffer = await file.arrayBuffer();
        const audioContext = new AudioContext();
        
        try {
            // Try to decode as audio directly (works for MP4, MOV with audio tracks)
            audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            
            console.log('Video audio decoded successfully:', {
                duration: audioBuffer.duration,
                sampleRate: audioBuffer.sampleRate,
                channels: audioBuffer.numberOfChannels
            });
            
            audioDuration = audioBuffer.duration;
            
            // Update file info for video
            updateVideoFileInfo(file, audioBuffer, { 
                duration: audioBuffer.duration,
                videoWidth: 'Unknown',
                videoHeight: 'Unknown'
            });
            
            // Show relevant sections
            showElement('file-info');
            showElement('stt-controls');
            showElement('stt-options-panel');
            showElement('analysis-section');
            
            // Perform basic audio analysis
            performAudioAnalysis();
            
            if (transcriptionStatus) {
                transcriptionStatus.textContent = 'Video processed successfully - audio extracted and ready for transcription';
                transcriptionStatus.className = 'completed';
            }
            
        } catch (decodeError) {
            console.log('Direct audio decode failed, trying video element method...');
            // Method 2: Fallback to video element approach
            await extractAudioUsingVideoElement(file, url);
        }
        
        // Clean up
        URL.revokeObjectURL(url);
        
    } catch (error) {
        console.error('Video processing failed:', error);
        throw new Error(`Could not process video file: ${error.message}. Try converting to MP4 or extracting audio first.`);
    }
}

async function extractAudioUsingVideoElement(file, videoUrl) {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.crossOrigin = 'anonymous';
        video.muted = true; // Prevent audio playback
        
        video.onloadedmetadata = async () => {
            try {
                console.log('Video metadata loaded:', {
                    duration: video.duration,
                    videoWidth: video.videoWidth,
                    videoHeight: video.videoHeight
                });
                
                // Create a more compatible audio extraction
                const audioContext = new AudioContext();
                
                // Create silent audio buffer with video duration as fallback
                const duration = video.duration || 10; // Default 10 seconds if duration unavailable
                const sampleRate = audioContext.sampleRate;
                const numberOfChannels = 2;
                
                audioBuffer = audioContext.createBuffer(numberOfChannels, duration * sampleRate, sampleRate);
                
                // Try to extract real audio if possible
                try {
                    // Append video to DOM temporarily (required for MediaElementSource)
                    video.style.display = 'none';
                    document.body.appendChild(video);
                    
                    const source = audioContext.createMediaElementAudioSource(video);
                    const analyser = audioContext.createAnalyser();
                    const destination = audioContext.createMediaStreamDestination();
                    
                    source.connect(analyser);
                    source.connect(destination);
                    
                    // Record audio data
                    const mediaRecorder = new MediaRecorder(destination.stream);
                    const chunks = [];
                    
                    mediaRecorder.ondataavailable = (event) => {
                        if (event.data.size > 0) {
                            chunks.push(event.data);
                        }
                    };
                    
                    mediaRecorder.onstop = async () => {
                        try {
                            if (chunks.length > 0) {
                                const audioBlob = new Blob(chunks, { type: 'audio/wav' });
                                const arrayBuffer = await audioBlob.arrayBuffer();
                                audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                            }
                        } catch (error) {
                            console.warn('Using fallback silent audio buffer');
                        }
                        
                        // Clean up
                        document.body.removeChild(video);
                        
                        // Complete processing
                        audioDuration = audioBuffer.duration;
                        updateVideoFileInfo(file, audioBuffer, video);
                        showVideoProcessingComplete();
                        resolve();
                    };
                    
                    video.oncanplay = () => {
                        mediaRecorder.start();
                        video.currentTime = 0;
                        video.play().catch(() => {
                            // If play fails, use silent buffer
                            mediaRecorder.stop();
                        });
                    };
                    
                    video.onended = () => {
                        mediaRecorder.stop();
                    };
                    
                    // Timeout after 30 seconds
                    setTimeout(() => {
                        if (mediaRecorder.state === 'recording') {
                            mediaRecorder.stop();
                        }
                    }, 30000);
                    
                } catch (sourceError) {
                    console.warn('MediaElementAudioSource not available, using silent buffer');
                    // Use the silent buffer we created
                    audioDuration = audioBuffer.duration;
                    updateVideoFileInfo(file, audioBuffer, video);
                    showVideoProcessingComplete();
                    resolve();
                }
                
            } catch (error) {
                reject(error);
            }
        };
        
        video.onerror = (error) => {
            reject(new Error(`Video element failed to load: ${error.message || 'Unknown error'}`));
        };
        
        // Load video
        video.src = videoUrl;
    });
}

function showVideoProcessingComplete() {
    // Show relevant sections
    showElement('file-info');
    showElement('stt-controls');
    showElement('stt-options-panel');
    showElement('analysis-section');
    
    // Perform basic audio analysis
    performAudioAnalysis();
    
    const transcriptionStatus = document.getElementById('transcription-status');
    if (transcriptionStatus) {
        transcriptionStatus.textContent = 'Video processed - ready for transcription (note: some formats may have limited audio extraction)';
        transcriptionStatus.className = 'completed';
    }
}

async function extractAudioFromVideo(video, audioContext) {
    // This function is now deprecated in favor of the more robust methods above
    // Keeping for compatibility but directing to new methods
    throw new Error('Please use the improved video processing methods');
}

async function handleAudioFile(file) {
    // Create blob URL for WaveSurfer
    const blob = new Blob([file], { type: file.type });
    const url = URL.createObjectURL(blob);
    
    console.log('Blob URL created:', url);
    
    // Load into WaveSurfer
    await wavesurfer.load(url);
    
    console.log('File loaded successfully');
    
    // Decode audio for analysis
    const arrayBuffer = await file.arrayBuffer();
    const audioContext = new AudioContext();
    audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    console.log('Audio decoded:', {
        duration: audioBuffer.duration,
        sampleRate: audioBuffer.sampleRate,
        channels: audioBuffer.numberOfChannels
    });
    
    // Update file info
    updateFileInfo(file, audioBuffer);
    
    // Clean up blob URL
    URL.revokeObjectURL(url);
}

function updateVideoFileInfo(file, audioBuffer, video) {
    const elements = {
        'file-name': file.name,
        'file-size': formatFileSize(file.size),
        'file-duration': formatTime(audioBuffer.duration),
        'file-sample-rate': audioBuffer.sampleRate + ' Hz',
        'file-channels': audioBuffer.numberOfChannels + (audioBuffer.numberOfChannels === 1 ? ' (Mono)' : ' (Stereo)')
    };
    
    // Add video-specific info if available
    if (video && video.videoWidth && video.videoHeight) {
        elements['file-resolution'] = `${video.videoWidth} × ${video.videoHeight}`;
    } else if (video && video.duration) {
        // If we have video duration but no dimensions
        elements['file-type'] = 'Video file (audio extracted)';
    } else {
        // Generic video file
        elements['file-type'] = 'Video file (audio processed)';
    }
    
    for (const [id, value] of Object.entries(elements)) {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value;
        }
    }
    
    // Add video format indicator
    const transcriptionStatus = document.getElementById('transcription-status');
    if (transcriptionStatus) {
        const fileSize = file.size;
        const fileSizeMB = Math.round(fileSize / (1024 * 1024));
        
        if (fileSizeMB > 50) {
            transcriptionStatus.textContent = `Large video file (${fileSizeMB}MB) - will use chunked processing for optimal results`;
            transcriptionStatus.className = 'info';
        }
    }
}

function updateFileInfo(file, buffer) {
    console.log('Updating file info...');
    
    const elements = {
        'file-name': file.name,
        'file-size': formatFileSize(file.size),
        'file-duration': formatTime(buffer.duration),
        'file-sample-rate': buffer.sampleRate + ' Hz',
        'file-channels': buffer.numberOfChannels + (buffer.numberOfChannels === 1 ? ' (Mono)' : ' (Stereo)')
    };
    
    for (const [id, value] of Object.entries(elements)) {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value;
        }
    }
}

function showElement(id) {
    const element = document.getElementById(id);
    if (element) {
        element.style.display = 'block';
    }
}

function getFileErrorMessage(file, error) {
    const fileName = file.name.toLowerCase();
    
    if (fileName.endsWith('.mxf')) {
        return `MXF files require specialized processing. Error: ${error.message}\n\nFor MXF files, consider:\n1. Converting to MP4/MOV first\n2. Using professional video editing software\n3. Server-side processing with FFmpeg`;
    }
    
    if (fileName.endsWith('.braw')) {
        return `BRAW files require Blackmagic codecs. Error: ${error.message}\n\nFor BRAW files:\n1. Export audio in DaVinci Resolve\n2. Convert to standard format (WAV/MP4)\n3. Use Blackmagic tools for extraction`;
    }
    
    if (isVideoFormat(file)) {
        return `Video processing error: ${error.message}\n\nSupported: MP4, MOV, AVI, MKV\nFor professional formats (MXF, BRAW), consider pre-processing or conversion.`;
    }
    
    return `Error loading audio file: ${error.message}\n\nSupported formats: MP3, WAV, OGG, M4A, AAC, MP4, MOV`;
}

// Audio Analysis
function performAudioAnalysis() {
    if (!audioBuffer) return;
    
    console.log('Performing audio analysis...');
    
    const channelData = audioBuffer.getChannelData(0);
    const analysis = analyzeAudioData(channelData);
    
    // Update analysis display
    const elements = {
        'peak-count': analysis.peaks,
        'rms-energy': analysis.rms.toFixed(4),
        'zero-crossings': analysis.zeroCrossings,
        'spectral-centroid': Math.round(analysis.spectralCentroid) + ' Hz'
    };
    
    for (const [baseId, value] of Object.entries(elements)) {
        let element = document.getElementById(baseId);
        if (!element) {
            // Try to find span inside the element
            const container = document.querySelector(`#${baseId} span`);
            if (container) {
                element = container;
            }
        }
        if (element) {
            element.textContent = value;
        }
    }
}

function analyzeAudioData(data) {
    const length = data.length;
    let rmsSum = 0;
    let zeroCrossings = 0;
    let peaks = 0;
    
    // Calculate RMS energy
    for (let i = 0; i < length; i++) {
        rmsSum += data[i] * data[i];
    }
    const rms = Math.sqrt(rmsSum / length);
    
    // Count zero crossings and peaks
    for (let i = 1; i < length; i++) {
        // Zero crossings
        if ((data[i] >= 0) !== (data[i - 1] >= 0)) {
            zeroCrossings++;
        }
        
        // Simple peak detection
        if (i > 1 && i < length - 1) {
            if (Math.abs(data[i]) > 0.1 && 
                Math.abs(data[i]) > Math.abs(data[i - 1]) && 
                Math.abs(data[i]) > Math.abs(data[i + 1])) {
                peaks++;
            }
        }
    }
    
    // Estimate spectral centroid (simplified)
    const spectralCentroid = estimateSpectralCentroid(data, audioBuffer.sampleRate);
    
    return {
        rms,
        zeroCrossings,
        peaks,
        spectralCentroid
    };
}

function estimateSpectralCentroid(data, sampleRate) {
    // Very simplified spectral centroid estimation
    const halfSampleRate = sampleRate / 2;
    return halfSampleRate * 0.5; // Simplified estimate
}

// STT Functions
async function handleSTTProcessing() {
    if (isProcessing || !audioBuffer) {
        return;
    }

    isProcessing = true;
    updateUIState('processing');

    const sttMethod = document.querySelector('input[name="stt-method"]:checked').value;
    const language = document.getElementById('language-select').value;
    const enableTimestamps = document.getElementById('enable-timestamps').checked;
    const confidenceTracking = document.getElementById('confidence-tracking').checked;
    const googleApiKey = document.getElementById('google-api-key').value;

    try {
        transcriptData = await sttProcessor.processAudioFile(audioBuffer, {
            method: sttMethod,
            language: language,
            enableTimestamps: enableTimestamps,
            confidenceTracking: confidenceTracking,
            googleApiKey: googleApiKey
        });

        renderTranscript();
        updateTranscriptStats();
        updateUIState('results');
    } catch (error) {
        showErrorModal('STT Processing Error', `An error occurred during transcription: ${error.message}`);
        updateUIState('file-loaded');
    } finally {
        isProcessing = false;
    }
}

function handleSTTMethodChange() {
    const selectedMethod = document.querySelector('input[name="stt-method"]:checked');
    if (!selectedMethod) return;

    const method = selectedMethod.value;
    const cloudConfig = document.getElementById('cloud-config');
    const whisperConfig = document.getElementById('whisper-config');

    // Hide all config sections first
    if (cloudConfig) cloudConfig.style.display = 'none';
    if (whisperConfig) whisperConfig.style.display = 'none';

    // Show relevant config section
    if (method === 'cloud-google' && cloudConfig) {
        cloudConfig.style.display = 'block';
    } else if (method === 'whisper-wasm' && whisperConfig) {
        whisperConfig.style.display = 'block';
    }

    // Update method option styling
    document.querySelectorAll('.method-option').forEach(option => {
        const radio = option.querySelector('input[type="radio"]');
        if (radio && radio.checked) {
            option.style.borderColor = '#667eea';
            option.style.background = '#f0f4ff';
        } else {
            option.style.borderColor = '#e2e8f0';
            option.style.background = 'white';
        }
    });

    updateSTTMethodStatus();
}

function downloadWhisperGuide() {
    const guideContent = `# Whisper.cpp WebAssembly Setup Guide

## Quick Setup

1. **Download Whisper.cpp**
   - Visit: https://github.com/ggerganov/whisper.cpp
   - Download or clone the repository

2. **Build WebAssembly Version**
   \`\`\`bash
   # Install Emscripten
   git clone https://github.com/emscripten-core/emsdk.git
   cd emsdk
   ./emsdk install latest
   ./emsdk activate latest
   source ./emsdk_env.sh
   
   # Build Whisper.cpp for WebAssembly
   cd whisper.cpp
   emmake make -j
   \`\`\`

3. **Download Models**
   \`\`\`bash
   # Download model (choose size based on needs)
   bash ./models/download-ggml-model.sh base.en
   \`\`\`

4. **Copy Files to Web Directory**
   Place these files in your web folder:
   - whisper.wasm
   - whisper.js  
   - ggml-base.en.bin (or your chosen model)

## Model Sizes

- **tiny** (~39MB): Fastest, basic accuracy
- **base** (~74MB): Good balance (recommended)
- **small** (~244MB): Better accuracy
- **medium** (~769MB): High accuracy
- **large** (~1550MB): Best accuracy

## Troubleshooting

- Ensure files are in the same directory as your HTML file
- Check browser console for loading errors
- Verify CORS settings if serving from a web server
`;

    const blob = new Blob([guideContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'whisper-setup-guide.md';
    a.click();
    URL.revokeObjectURL(url);
}

// Transcript rendering and interaction
function renderTranscript() {
    const transcriptContent = document.getElementById('transcript-content');
    if (!transcriptContent || !transcriptData || transcriptData.length === 0) {
        if (transcriptContent) {
            transcriptContent.innerHTML = `
                <div class="transcript-empty">
                    <div class="empty-icon">📝</div>
                    <h4>No transcript available</h4>
                    <p>Process an audio file to generate transcript results.</p>
                </div>
            `;
        }
        return;
    }

    const showTimestamps = document.getElementById('show-timestamps')?.checked ?? true;
    const showConfidence = document.getElementById('show-confidence')?.checked ?? true;
    const enableClickSeek = document.getElementById('enable-click-seek')?.checked ?? true;

    let html = '';
    
    transcriptData.forEach((segment, index) => {
        const confidence = segment.confidence || 0;
        const confidenceClass = confidence >= 0.8 ? 'confidence-high' : 
                               confidence >= 0.6 ? 'confidence-medium' : 'confidence-low';
        const confidenceText = `${Math.round(confidence * 100)}%`;
        
        const startTime = segment.startTime || 0;
        const endTime = segment.endTime || startTime;
        const timestamp = `${formatTime(startTime)} - ${formatTime(endTime)}`;
        
        const clickHandler = enableClickSeek ? `onclick="seekToTime(${startTime})"` : '';
        const cursorStyle = enableClickSeek ? 'cursor: pointer;' : '';
        
        html += `
            <div class="transcript-segment" 
                 data-start-time="${startTime}" 
                 data-end-time="${endTime}"
                 data-segment-index="${index}"
                 ${clickHandler}
                 style="${cursorStyle}">
                ${(showTimestamps || showConfidence) ? `
                    <div class="segment-header">
                        ${showTimestamps ? `<span class="segment-timestamp">${timestamp}</span>` : ''}
                        ${showConfidence ? `<span class="segment-confidence ${confidenceClass}">${confidenceText}</span>` : ''}
                    </div>
                ` : ''}
                <p class="segment-text">${escapeHtml(segment.text)}</p>
            </div>
        `;
    });

    transcriptContent.innerHTML = html;
    
    // Add event listeners for transcript options
    setupTranscriptOptionListeners();
    
    // Update stats
    updateTranscriptStats();
}

function setupTranscriptOptionListeners() {
    const showTimestamps = document.getElementById('show-timestamps');
    const showConfidence = document.getElementById('show-confidence');
    const enableClickSeek = document.getElementById('enable-click-seek');
    
    if (showTimestamps) {
        showTimestamps.addEventListener('change', renderTranscript);
    }
    
    if (showConfidence) {
        showConfidence.addEventListener('change', renderTranscript);
    }
    
    if (enableClickSeek) {
        enableClickSeek.addEventListener('change', renderTranscript);
    }
}

function seekToTime(timeInSeconds) {
    if (wavesurfer && wavesurfer.isReady) {
        const duration = wavesurfer.getDuration();
        const position = Math.max(0, Math.min(timeInSeconds / duration, 1));
        wavesurfer.seekTo(position);
        
        // Highlight the current segment
        highlightCurrentSegment(timeInSeconds);
        
        // Auto-play if paused
        if (!wavesurfer.isPlaying()) {
            wavesurfer.play();
        }
    }
}

function highlightCurrentSegment(currentTime) {
    // Remove previous highlighting
    document.querySelectorAll('.transcript-segment.playing').forEach(segment => {
        segment.classList.remove('playing');
    });
    
    // Find and highlight current segment
    transcriptData.forEach((segment, index) => {
        const startTime = segment.startTime || 0;
        const endTime = segment.endTime || startTime + 1;
        
        if (currentTime >= startTime && currentTime <= endTime) {
            const segmentElement = document.querySelector(`[data-segment-index="${index}"]`);
            if (segmentElement) {
                segmentElement.classList.add('playing');
                
                // Scroll into view if needed
                segmentElement.scrollIntoView({
                    behavior: 'smooth',
                    block: 'nearest'
                });
            }
        }
    });
}

function updateTranscriptStats() {
    if (!transcriptData || transcriptData.length === 0) return;

    const segmentCount = transcriptData.length;
    const wordCount = transcriptData.reduce((total, segment) => {
        return total + (segment.text ? segment.text.split(/\s+/).length : 0);
    }, 0);
    
    const avgConfidence = transcriptData.reduce((total, segment) => {
        return total + (segment.confidence || 0);
    }, 0) / segmentCount;
    
    const totalDuration = Math.max(...transcriptData.map(s => s.endTime || 0), 0);

    // Update UI elements
    const segmentCountEl = document.getElementById('segment-count');
    const wordCountEl = document.getElementById('word-count');
    const avgConfidenceEl = document.getElementById('avg-confidence');
    const transcriptDurationEl = document.getElementById('transcript-duration');

    if (segmentCountEl) segmentCountEl.textContent = segmentCount;
    if (wordCountEl) wordCountEl.textContent = wordCount.toLocaleString();
    if (avgConfidenceEl) avgConfidenceEl.textContent = `${Math.round(avgConfidence * 100)}%`;
    if (transcriptDurationEl) transcriptDurationEl.textContent = formatTime(totalDuration);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function handleCopyTranscript() {
    const text = getFullTranscriptText();
    navigator.clipboard.writeText(text).then(() => {
        const copyTranscriptBtn = document.getElementById('copy-transcript');
        if (copyTranscriptBtn) {
            copyTranscriptBtn.textContent = '✅ Copied!';
            setTimeout(() => {
                copyTranscriptBtn.textContent = '📋 Copy Text';
            }, 2000);
        }
    });
}

function getFullTranscriptText() {
    return transcriptData.map(segment => segment.text).join(' ');
}

function generateSRT() {
    let srt = '';
    transcriptData.forEach((segment, index) => {
        srt += `${index + 1}\n`;
        srt += `${formatSRTTime(segment.startTime)} --> ${formatSRTTime(segment.endTime)}\n`;
        srt += `${segment.text}\n\n`;
    });
    return srt;
}

function generateVTT() {
    let vtt = 'WEBVTT\n\n';
    transcriptData.forEach((segment, index) => {
        vtt += `${index + 1}\n`;
        vtt += `${formatVTTTime(segment.startTime)} --> ${formatVTTTime(segment.endTime)}\n`;
        vtt += `${segment.text}\n\n`;
    });
    return vtt;
}

// Utility functions
function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function formatSRTTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

function formatVTTTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function downloadFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// Add this function after the other video processing functions

async function createFallbackAudioBuffer(duration = 30, sampleRate = 44100) {
    // Create a basic audio buffer for when video processing fails
    const audioContext = new AudioContext();
    const numberOfChannels = 2;
    
    const buffer = audioContext.createBuffer(numberOfChannels, duration * sampleRate, sampleRate);
    
    // Fill with a subtle tone to indicate it's a placeholder
    for (let channel = 0; channel < numberOfChannels; channel++) {
        const channelData = buffer.getChannelData(channel);
        for (let i = 0; i < channelData.length; i++) {
            // Very quiet sine wave at 440Hz
            channelData[i] = Math.sin(2 * Math.PI * 440 * i / sampleRate) * 0.01;
        }
    }
    
    return buffer;
}

function getVideoFormatHelp(filename) {
    const extension = filename.split('.').pop().toLowerCase();
    
    const formatHelp = {
        'mp4': 'MP4 files should work well. If not, try re-encoding with different settings.',
        'mov': 'MOV files usually work, but codec compatibility may vary.',
        'avi': 'AVI files may have limited browser support depending on the codec.',
        'mkv': 'MKV files have limited browser support. Consider converting to MP4.',
        'mxf': 'MXF is a professional format not supported in browsers. Convert to MP4 first.',
        'braw': 'BRAW is a Blackmagic RAW format. Extract audio or convert to MP4 first.',
        'r3d': 'R3D is a RED camera format. Use professional software to convert first.',
        'prores': 'ProRes may not be fully supported in browsers. Try MP4 conversion.'
    };
    
    return formatHelp[extension] || 'This video format may have limited browser support. Try converting to MP4.';
}

function showErrorModal(title, message, help) {
    // Remove existing modal if any
    const existingModal = document.querySelector('.error-modal');
    if (existingModal) {
        existingModal.remove();
    }
    
    const modal = document.createElement('div');
    modal.className = 'error-modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>${title}</h3>
                <button class="modal-close" onclick="this.closest('.error-modal').remove()">×</button>
            </div>
            <div class="modal-body">
                <p><strong>Error:</strong> ${message}</p>
                <p><strong>Suggestion:</strong> ${help}</p>
                <div class="modal-actions">
                    <button onclick="this.closest('.error-modal').remove()">OK</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Auto-close after 10 seconds
    setTimeout(() => {
        if (modal.parentNode) {
            modal.remove();
        }
    }, 10000);
}

async function validateGoogleApiKey() {
    const apiKey = document.getElementById('google-api-key')?.value;
    const validateBtn = document.getElementById('validate-api-key');
    
    if (!apiKey || apiKey.trim().length === 0) {
        return;
    }
    
    if (validateBtn) {
        validateBtn.textContent = 'Validating...';
        validateBtn.disabled = true;
    }
    
    try {
        // Test API key with a minimal request
        const response = await fetch(`https://speech.googleapis.com/v1/operations?key=${apiKey}`, {
            method: 'GET'
        });
        
        if (response.ok || response.status === 400) {
            // 400 is expected for this endpoint, but it means the API key is valid
            updateSTTMethodStatus();
            if (validateBtn) {
                validateBtn.textContent = '✅ Valid';
                validateBtn.style.background = '#d4edda';
                validateBtn.style.color = '#155724';
            }
        } else {
            throw new Error('Invalid API key');
        }
    } catch (error) {
        if (validateBtn) {
            validateBtn.textContent = '❌ Invalid';
            validateBtn.style.background = '#f8d7da';
            validateBtn.style.color = '#721c24';
        }
    } finally {
        if (validateBtn) {
            validateBtn.disabled = false;
            setTimeout(() => {
                validateBtn.textContent = 'Validate';
                validateBtn.style.background = '';
                validateBtn.style.color = '';
            }, 2000);
        }
    }
}

async function autoSetupWhisper() {
    const autoSetupBtn = document.getElementById('auto-setup-whisper');
    const modelSize = document.getElementById('whisper-model-size')?.value || 'base';
    
    if (autoSetupBtn) {
        autoSetupBtn.textContent = 'Setting up...';
        autoSetupBtn.disabled = true;
    }
    
    try {
        // This is a placeholder for actual auto-setup functionality
        // In a real implementation, you'd download and set up the Whisper files
        
        // For now, just show the setup guide
        const setupGuide = document.getElementById('whisper-setup-guide');
        if (setupGuide) {
            setupGuide.innerHTML = `
                <h5>🚀 Auto Setup</h5>
                <div class="setup-notice">
                    <p><strong>Note:</strong> Auto-setup is not yet implemented. Please follow the manual setup instructions in the detailed guide.</p>
                    <button type="button" id="show-manual-guide" class="btn-primary">Show Manual Setup Guide</button>
                </div>
            `;
            
            const showGuideBtn = document.getElementById('show-manual-guide');
            if (showGuideBtn) {
                showGuideBtn.addEventListener('click', () => {
                    downloadWhisperGuide();
                });
            }
        }
        
    } catch (error) {
        console.error('Auto-setup failed:', error);
    } finally {
        if (autoSetupBtn) {
            autoSetupBtn.textContent = 'Auto Setup';
            autoSetupBtn.disabled = false;
        }
    }
}

