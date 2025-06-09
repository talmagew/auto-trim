# Speech-to-Text Setup Guide

This guide helps you set up the STT (Speech-to-Text) functionality for your audio waveform analyzer.

## Available STT Methods

### 1. Google Cloud Speech-to-Text (Recommended for Cloud Processing)
- ✅ **Excellent accuracy**
- ✅ **Multi-language support**
- ✅ **Word-level timestamps**
- ⚠️ **Requires internet connection**
- ⚠️ **Requires API key (paid service)**

### 2. Whisper.cpp WebAssembly (Recommended for Privacy)
- ✅ **Excellent accuracy (state-of-the-art)**
- ✅ **Completely offline processing**
- ✅ **No API keys required**
- ✅ **Privacy-friendly**
- ⚠️ **Requires setup**
- ⚠️ **Large model files**

---

## Google Cloud Speech-to-Text Setup

### Step 1: Create Google Cloud Project
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable billing (required for Speech-to-Text API)

### Step 2: Enable Speech-to-Text API
1. Navigate to **APIs & Services > Library**
2. Search for "Cloud Speech-to-Text API"
3. Click **Enable**

### Step 3: Create API Key
1. Go to **APIs & Services > Credentials**
2. Click **Create Credentials > API Key**
3. Copy the generated API key
4. (Recommended) Restrict the key to Speech-to-Text API only

### Step 4: Configure in App
1. Select "Google Cloud Speech-to-Text" in the app
2. Paste your API key in the configuration field
3. Choose your preferred language
4. Click "Process Audio for STT"

### Pricing
- $0.006 per 15 seconds of audio (first 60 minutes free each month)
- See [Google Cloud Speech-to-Text Pricing](https://cloud.google.com/speech-to-text/pricing)

---

## Whisper.cpp WebAssembly Setup

### Quick Start (Pre-built WebAssembly)

If available, you can use pre-built WebAssembly files:

1. **Download Pre-built Files** (if available):
   - Download `whisper.wasm` and `whisper.js`
   - Place them in your web directory

2. **Download Model Files**:
   ```bash
   # Choose model size based on your needs:
   curl -L "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin" -o ggml-tiny.en.bin     # ~39MB, fastest
   curl -L "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin" -o ggml-base.en.bin     # ~74MB, balanced
   curl -L "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin" -o ggml-small.en.bin   # ~244MB, better
   curl -L "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin" -o ggml-medium.en.bin # ~769MB, high quality
   curl -L "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large.bin" -o ggml-large.bin         # ~1550MB, best quality
   ```

### Building from Source

If pre-built files aren't available, build Whisper.cpp WebAssembly version:

#### Prerequisites
- **Emscripten SDK** for WebAssembly compilation
- **CMake** (version 3.13 or higher)
- **Git**

#### Step 1: Install Emscripten
```bash
# Download and install Emscripten
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh  # Linux/Mac
# emsdk_env.bat        # Windows
```

#### Step 2: Clone and Build Whisper.cpp
```bash
# Clone Whisper.cpp repository
git clone https://github.com/ggerganov/whisper.cpp.git
cd whisper.cpp

# Build WebAssembly version
mkdir build-wasm
cd build-wasm
emcmake cmake ..
make -j$(nproc)

# This creates whisper.wasm and whisper.js files
```

#### Step 3: Download Models
```bash
# From whisper.cpp directory
cd models
./download-ggml-model.sh base.en  # Download base English model
./download-ggml-model.sh tiny.en  # Download tiny English model (faster)
./download-ggml-model.sh large    # Download large multilingual model
```

#### Step 4: Copy Files to Web Directory
Copy these files to your web project directory:
- `build-wasm/whisper.wasm`
- `build-wasm/whisper.js`
- `models/ggml-*.bin` (your chosen model files)

### Model Selection Guide

| Model Size | File Size | Speed | Quality | Use Case |
|------------|-----------|-------|---------|----------|
| **tiny.en** | ~39MB | Fastest | Basic | Quick demos, testing |
| **base.en** | ~74MB | Fast | Good | **Recommended for most users** |
| **small.en** | ~244MB | Medium | Better | Higher accuracy needed |
| **medium.en** | ~769MB | Slow | High | Professional transcription |
| **large** | ~1550MB | Slowest | Best | Best possible accuracy |

### Troubleshooting Whisper.cpp

#### Common Issues

1. **"Whisper.wasm not found"**
   - Ensure `whisper.wasm` is in the same directory as your HTML file
   - Check file permissions
   - Verify web server is serving .wasm files correctly

2. **"Model file not found"**
   - Download the model file using the commands above
   - Ensure model file is in the web directory
   - Check that filename matches exactly (e.g., `ggml-base.en.bin`)

3. **Loading timeout**
   - Large models take time to load
   - Check browser developer console for errors
   - Ensure sufficient RAM (large models need several GB)

4. **CORS errors**
   - If serving from a local server, ensure CORS is properly configured
   - For local development, use `python -m http.server` or similar

#### Performance Tips

- **Start with the base model** - good balance of speed and accuracy
- **Use English-only models** (.en) if you only need English transcription
- **Serve files from a fast web server** - model loading is bandwidth-dependent
- **Consider using a CDN** for model files in production

---

## Testing Your Setup

### Google Cloud Test
1. Load an audio file in the app
2. Select "Google Cloud Speech-to-Text"
3. Enter your API key
4. Click "Process Audio for STT"
5. You should see transcription results within seconds

### Whisper.cpp Test
1. Load an audio file in the app
2. Select "Whisper.cpp (WebAssembly - Offline)"
3. Choose a model size
4. Click "Process Audio for STT"
5. First run may take time to load the model

---

## Troubleshooting

### General Issues
- **No audio loaded**: Make sure to load an audio file first
- **Processing stuck**: Check browser developer console for errors
- **Poor accuracy**: Try a larger model or check audio quality

### Network Issues
- **Google Cloud timeout**: Check internet connection and API key
- **Model download fails**: Verify URL and try alternative download methods

### Browser Compatibility
- **Modern browsers required**: Chrome 87+, Firefox 84+, Safari 14+
- **WebAssembly support**: Required for Whisper.cpp
- **HTTPS required**: For Google Cloud API calls

---

## Production Deployment

### Security Considerations
- **Never expose API keys** in client-side code for production
- **Use server-side proxy** for Google Cloud API calls
- **Implement rate limiting** to prevent abuse

### Performance Optimization
- **Use CDN** for model files
- **Cache models** in browser storage
- **Implement progressive loading** for better UX

### Cost Management
- **Monitor Google Cloud usage** to avoid unexpected charges
- **Consider caching** frequently transcribed content
- **Use Whisper.cpp** for cost-sensitive applications

---

## Additional Resources

- [Google Cloud Speech-to-Text Documentation](https://cloud.google.com/speech-to-text/docs)
- [Whisper.cpp GitHub Repository](https://github.com/ggerganov/whisper.cpp)
- [OpenAI Whisper Paper](https://arxiv.org/abs/2212.04356)
- [WebAssembly Documentation](https://webassembly.org/) 