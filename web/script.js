const fileInput = document.getElementById('file-input');
const zoomControls = document.getElementById('zoom-controls');
const zoomInBtn = document.getElementById('zoom-in');
const zoomOutBtn = document.getElementById('zoom-out');
const zoomResetBtn = document.getElementById('zoom-reset');
const zoomLevel = document.getElementById('zoom-level');
const canvas = document.getElementById('analysis-canvas');

let wavesurfer;
let currentZoom = 1;
let minZoom = 1;
let maxZoom = 20;
let audioBuffer;
let analysisData;

// Set up canvas to be responsive
function resizeCanvas() {
    const container = document.querySelector('.container');
    const containerWidth = container.clientWidth;
    canvas.width = containerWidth;
    canvas.height = 200;
    canvas.style.width = containerWidth + 'px';
    canvas.style.height = '200px';
    
    // Redraw analysis if data exists
    if (analysisData && audioBuffer) {
        drawAnalysis(analysisData, audioBuffer.duration);
    }
}

// Initialize canvas size
window.addEventListener('resize', resizeCanvas);
window.addEventListener('load', resizeCanvas);

fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (wavesurfer) {
        wavesurfer.destroy();
    }

    wavesurfer = WaveSurfer.create({
        container: '#waveform',
        waveColor: '#4a90e2',
        progressColor: '#2d5fa8',
        height: 128,
        responsive: true,
        scrollParent: true,
        normalize: true,
        backend: 'WebAudio'
    });

    const url = URL.createObjectURL(file);
    wavesurfer.load(url);

    wavesurfer.on('ready', async () => {
        audioBuffer = await wavesurfer.getDecodedData();
        analysisData = analyzeBuffer(audioBuffer);
        
        // Show zoom controls
        zoomControls.style.display = 'flex';
        
        // Reset zoom
        currentZoom = 1;
        updateZoomLevel();
        
        // Resize canvas and draw analysis
        resizeCanvas();
        drawAnalysis(analysisData, audioBuffer.duration);
    });
});

// Zoom functionality
zoomInBtn.addEventListener('click', () => {
    if (currentZoom < maxZoom) {
        currentZoom = Math.min(currentZoom * 2, maxZoom);
        applyZoom();
    }
});

zoomOutBtn.addEventListener('click', () => {
    if (currentZoom > minZoom) {
        currentZoom = Math.max(currentZoom / 2, minZoom);
        applyZoom();
    }
});

zoomResetBtn.addEventListener('click', () => {
    currentZoom = 1;
    applyZoom();
});

function applyZoom() {
    if (wavesurfer) {
        wavesurfer.zoom(currentZoom * 50); // Wavesurfer zoom is in pixels per second
        updateZoomLevel();
    }
}

function updateZoomLevel() {
    zoomLevel.textContent = `Zoom: ${currentZoom}x`;
    zoomInBtn.disabled = currentZoom >= maxZoom;
    zoomOutBtn.disabled = currentZoom <= minZoom;
}

function analyzeBuffer(buffer) {
    const data = buffer.getChannelData(0); // use first channel
    const sampleRate = buffer.sampleRate;
    const windowSize = Math.floor(sampleRate / 100); // ~10ms windows
    const amp = [];
    for (let i = 0; i < data.length; i += windowSize) {
        let sum = 0;
        for (let j = i; j < i + windowSize && j < data.length; j++) {
            sum += data[j] * data[j];
        }
        amp.push(Math.sqrt(sum / windowSize));
    }

    const noiseFloor = amp.reduce((a, b) => a + b, 0) / amp.length;

    const peaks = [];
    const valleys = [];
    const transients = [];
    for (let i = 1; i < amp.length - 1; i++) {
        if (amp[i] > amp[i - 1] && amp[i] > amp[i + 1] && amp[i] > noiseFloor * 1.5) {
            peaks.push({ index: i, value: amp[i] });
        }
        if (amp[i] < amp[i - 1] && amp[i] < amp[i + 1]) {
            valleys.push({ index: i, value: amp[i] });
        }
        if (amp[i] - amp[i - 1] > noiseFloor) {
            transients.push({ index: i, value: amp[i] });
        }
    }

    return { amp, peaks, valleys, transients, noiseFloor };
}

function drawAnalysis(analysis, duration) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const { peaks, valleys, transients, noiseFloor } = analysis;
    const height = canvas.height;

    // Draw noise floor line
    ctx.strokeStyle = 'green';
    ctx.lineWidth = 1;
    const noiseY = height - noiseFloor * height;
    ctx.beginPath();
    ctx.moveTo(0, noiseY);
    ctx.lineTo(canvas.width, noiseY);
    ctx.stroke();

    // Add noise floor label
    ctx.fillStyle = 'green';
    ctx.font = '12px Arial';
    ctx.fillText('Noise Floor', 5, noiseY - 5);

    function drawLines(points, color, label) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        points.forEach((p, index) => {
            const time = (p.index / analysis.amp.length) * duration;
            const x = (time / duration) * canvas.width;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
            
            // Add labels for the first few markers
            if (index < 3) {
                ctx.fillStyle = color;
                ctx.font = '10px Arial';
                ctx.fillText(label, x + 2, 15 + index * 15);
            }
        });
    }

    drawLines(peaks, 'red', 'Peak');
    drawLines(valleys, 'blue', 'Valley');
    drawLines(transients, 'orange', 'Transient');
}

// Initialize
resizeCanvas();
