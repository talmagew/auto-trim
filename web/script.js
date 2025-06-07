const fileInput = document.getElementById('file-input');
const zoomSlider = document.getElementById('zoom-slider');
let wavesurfer;
let currentAnalysis = null;
let currentDuration = 0;

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
        responsive: true
    });

    const url = URL.createObjectURL(file);
    wavesurfer.load(url);

    wavesurfer.on('ready', async () => {
        const buffer = await wavesurfer.getDecodedData();
        currentDuration = buffer.duration;
        currentAnalysis = analyzeBuffer(buffer);
        updateCanvasSize();
        drawAnalysis(currentAnalysis, currentDuration);
    });
});

zoomSlider.addEventListener('input', () => {
    if (wavesurfer) {
        wavesurfer.zoom(Number(zoomSlider.value));
        updateCanvasSize();
        if (currentAnalysis) {
            drawAnalysis(currentAnalysis, currentDuration);
        }
    }
});

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
    const canvas = document.getElementById('analysis-canvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const { peaks, valleys, transients, noiseFloor } = analysis;
    const height = canvas.height;

    ctx.strokeStyle = 'green';
    const noiseY = height - noiseFloor * height;
    ctx.beginPath();
    ctx.moveTo(0, noiseY);
    ctx.lineTo(canvas.width, noiseY);
    ctx.stroke();

    function drawLines(points, color) {
        ctx.strokeStyle = color;
        points.forEach(p => {
            const time = (p.index / analysis.amp.length) * duration;
            const x = (time / duration) * canvas.width;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        });
    }

    drawLines(peaks, 'red');
    drawLines(valleys, 'blue');
    drawLines(transients, 'orange');
}

function updateCanvasSize() {
    const canvas = document.getElementById('analysis-canvas');
    const wrapper = wavesurfer.drawer.wrapper;
    canvas.width = wrapper.scrollWidth;
    canvas.style.width = wrapper.scrollWidth + 'px';
}
