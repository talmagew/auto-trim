// Whisper.cpp WebAssembly Worker
// This worker handles offline speech-to-text processing using Whisper.cpp compiled to WebAssembly

let whisperModule = null;
let isInitialized = false;

// Import Whisper.cpp WebAssembly module
self.addEventListener('message', async (event) => {
    const { command, audio, language, modelSize, options } = event.data;
    
    try {
        switch (command) {
            case 'load':
                await loadWhisperModule();
                break;
            case 'transcribe':
                if (!isInitialized) {
                    throw new Error('Whisper module not initialized');
                }
                await transcribeAudio(audio, language, modelSize, options);
                break;
        }
    } catch (error) {
        self.postMessage({
            type: 'error',
            error: error.message
        });
    }
});

async function loadWhisperModule() {
    try {
        // Check if Whisper files are available
        const wasmResponse = await fetch('./whisper.wasm');
        if (!wasmResponse.ok) {
            throw new Error('Whisper.wasm not found. Please follow the setup guide to install Whisper.cpp WebAssembly files.');
        }
        
        const jsResponse = await fetch('./whisper.js');
        if (!jsResponse.ok) {
            throw new Error('Whisper.js not found. Please follow the setup guide to install Whisper.cpp WebAssembly files.');
        }
        
        // Load the Whisper.js module
        importScripts('./whisper.js');
        
        // Initialize our simplified WhisperModule
        whisperModule = new WhisperModule();
        await whisperModule.init();
        
        isInitialized = true;
        self.postMessage({ type: 'loaded' });
        
    } catch (error) {
        self.postMessage({
            type: 'error',
            error: `Failed to load Whisper.cpp: ${error.message}`
        });
    }
}

async function transcribeAudio(audioData, language, modelSize, options) {
    try {
        if (!whisperModule) {
            throw new Error('Whisper module not loaded');
        }
        
        // Progress updates
        self.postMessage({ type: 'progress', progress: 10 });
        
        // Check if model file exists
        const modelFile = `./ggml-${modelSize || 'base'}.en.bin`;
        const modelResponse = await fetch(modelFile);
        if (!modelResponse.ok) {
            throw new Error(`Model file not found: ${modelFile}. Please download the ${modelSize || 'base'} model.`);
        }
        
        self.postMessage({ type: 'progress', progress: 30 });
        
        // Load model
        await whisperModule.loadModel(modelFile);
        
        self.postMessage({ type: 'progress', progress: 50 });
        
        // Convert audio data if needed
        const audioBuffer = new Float32Array(audioData);
        
        self.postMessage({ type: 'progress', progress: 70 });
        
        // Transcribe using our module
        const result = await whisperModule.transcribe(audioBuffer, {
            language: language?.split('-')[0] || 'en',
            model: modelSize || 'base',
            enableTimestamps: options?.enableTimestamps || true
        });
        
        self.postMessage({ type: 'progress', progress: 90 });
        
        // Parse results into the expected format
        const transcriptResults = parseWhisperResult(result, options);
        
        self.postMessage({
            type: 'result',
            data: transcriptResults
        });
        
    } catch (error) {
        self.postMessage({
            type: 'error',
            error: error.message
        });
    }
}

function parseWhisperResult(result, options) {
    const results = [];
    
    if (result.segments && result.segments.length > 0) {
        // Use segments if available
        for (const segment of result.segments) {
            results.push({
                text: segment.text.trim(),
                startTime: segment.start || 0,
                endTime: segment.end || 0,
                confidence: segment.confidence || 0.9,
                words: estimateWordTimings(segment.text, segment.start || 0, segment.end || 0)
            });
        }
    } else {
        // Fallback to simple text
        results.push({
            text: result.text || 'No speech detected',
            startTime: 0,
            endTime: 10, // Default duration
            confidence: 0.9,
            words: estimateWordTimings(result.text || 'No speech detected', 0, 10)
        });
    }
    
    return results;
}

function estimateWordTimings(text, startTime, endTime) {
    const words = text.split(' ').filter(word => word.length > 0);
    const duration = endTime - startTime;
    const wordDuration = duration / words.length;
    
    return words.map((word, index) => ({
        word: word,
        startTime: startTime + (index * wordDuration),
        endTime: startTime + ((index + 1) * wordDuration),
        confidence: 0.85
    }));
}

// Error handling
self.onerror = function(error) {
    self.postMessage({
        type: 'error',
        error: error.message || 'Unknown worker error'
    });
}; 