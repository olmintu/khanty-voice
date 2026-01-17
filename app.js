// app.js - Версия 3.0: С реальным анализом голоса (Pitch Detection)

// --- КОНФИГУРАЦИЯ ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const analyser = audioCtx.createAnalyser();
analyser.fftSize = 2048; 
const bufferLength = analyser.frequencyBinCount;
const dataArray = new Uint8Array(bufferLength);

let isRecording = false;
let mediaRecorder;
let audioChunks = [];
let userAudioBlob = null; 

// Целевые ноты эталона (в Герцах): До (C4), Ре (D4), Ми (E4)
const TARGET_FREQUENCIES = [261.63, 293.66, 329.63]; 
const NOTE_DURATION = 0.5; // Длительность одной ноты в эталоне (сек)

// Ссылки на UI
const canvas = document.getElementById('visualizer');
const ctx = canvas.getContext('2d');
const btnPlayRef = document.getElementById('btn-play-ref');
const btnRecord = document.getElementById('btn-record');
const btnStop = document.getElementById('btn-stop');
const btnCompare = document.getElementById('btn-compare');
const statusText = document.getElementById('status');
const scoreDisplay = document.getElementById('score');
const recDisplay = document.getElementById('recommendation');

// --- 1. ГЕНЕРАТОР ЭТАЛОНА ---
function playReferenceMelody() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    statusText.innerText = "🔊 Слушай: До - Ре - Ми...";
    
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    gainNode.connect(analyser); // Чтобы видеть волну

    // Программируем мелодию
    osc.frequency.setValueAtTime(TARGET_FREQUENCIES[0], now);
    osc.frequency.setValueAtTime(TARGET_FREQUENCIES[1], now + NOTE_DURATION);
    osc.frequency.setValueAtTime(TARGET_FREQUENCIES[2], now + NOTE_DURATION * 2);
    
    gainNode.gain.setValueAtTime(0.5, now);
    gainNode.gain.exponentialRampToValueAtTime(0.01, now + (NOTE_DURATION * 3));

    osc.start(now);
    osc.stop(now + (NOTE_DURATION * 3));

    osc.onended = () => {
        statusText.innerText = "Теперь нажми 'Записать' и повтори мелодию";
    };
    drawVisualizer();
}

// --- 2. ЗАПИСЬ ---
async function startRecording() {
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    statusText.innerText = "🔴 Пой: До - Ре - Ми...";

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);

        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
        
        mediaRecorder.onstop = () => {
            userAudioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            stream.getTracks().forEach(track => track.stop());
            source.disconnect();
            console.log("Запись готова к анализу");
        };

        mediaRecorder.start();
        isRecording = true;
        drawVisualizer();
    } catch (err) {
        console.error(err);
        statusText.innerText = "❌ Ошибка доступа к микрофону";
    }
}

// --- 3. АЛГОРИТМ СРАВНЕНИЯ ---
btnCompare.addEventListener('click', async () => {
    if (!userAudioBlob) return;
    statusText.innerText = "🧮 Вычисляю точность...";
    document.getElementById('results').classList.remove('hidden');

    // 1. Превращаем Blob в AudioBuffer для анализа
    const arrayBuffer = await userAudioBlob.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    
    // 2. Анализируем
    const userPitches = analyzeUserAudio(audioBuffer);
    
    // 3. Сравниваем с эталоном
    const result = calculateScore(userPitches, TARGET_FREQUENCIES);
    
    scoreDisplay.innerText = result.score;
    recDisplay.innerText = result.text;
    statusText.innerText = "Готово!";
});

function analyzeUserAudio(buffer) {
    const rawData = buffer.getChannelData(0); // Данные из левого канала
    const sampleRate = buffer.sampleRate;
    const samplesPerNote = Math.floor(sampleRate * NOTE_DURATION);
    
    let detectedPitches = [];

    // Разбиваем запись на 3 части (как в эталоне) и ищем частоту в каждой
    for (let i = 0; i < 3; i++) {
        const start = i * samplesPerNote;
        const end = start + samplesPerNote;
        
        // Если запись короче эталона
        if (start >= rawData.length) {
            detectedPitches.push(0); 
            continue;
        }

        const segment = rawData.slice(start, Math.min(end, rawData.length));
        const pitch = autoCorrelate(segment, sampleRate);
        detectedPitches.push(pitch);
    }
    
    console.log("Распознанные частоты:", detectedPitches);
    return detectedPitches;
}

// Математика: Алгоритм Автокорреляции (поиск высоты тона)
function autoCorrelate(buf, sampleRate) {
    // 1. Проверка громкости (RMS), если тишина - возвращаем -1
    let rms = 0;
    for (let i = 0; i < buf.length; i++) {
        rms += buf[i] * buf[i];
    }
    rms = Math.sqrt(rms / buf.length);
    if (rms < 0.01) return -1; // Слишком тихо

    // 2. Сама автокорреляция
    let r1 = 0, r2 = bufferLength - 1, thres = 0.2;
    for (let i = 0; i < bufferLength / 2; i++) {
        if (Math.abs(buf[i]) < thres) { r1 = i; break; }
    }
    for (let i = 1; i < bufferLength / 2; i++) {
        if (Math.abs(buf[bufferLength - i]) < thres) { r2 = bufferLength - i; break; }
    }

    buf = buf.slice(r1, r2);
    let c = new Array(buf.length).fill(0);
    for (let i = 0; i < buf.length; i++) {
        for (let j = 0; j < buf.length - i; j++) {
            c[i] = c[i] + buf[j] * buf[j + i];
        }
    }

    let d = 0; while (c[d] > c[d + 1]) d++;
    let maxval = -1, maxpos = -1;
    for (let i = d; i < buf.length; i++) {
        if (c[i] > maxval) {
            maxval = c[i];
            maxpos = i;
        }
    }
    let T0 = maxpos;

    return sampleRate / T0;
}

// Самая лояльная логика: "Наличие правильных нот"

function freqToNote(freq) {
    if (freq <= 0) return -1;
    const noteNum = 12 * (Math.log(freq / 440) / Math.log(2));
    const midi = Math.round(noteNum) + 69;
    return midi % 12;
}

function calculateScore(userPitches, targetPitches) {
    // 1. Переводим эталон в набор нот (уникальные ноты)
    // Для нашего эталона это будет набор {До, Ре, Ми}
    const targetNotes = new Set(targetPitches.map(freq => freqToNote(freq)));
    
    // 2. Смотрим, какие ноты вообще спел пользователь
    // Фильтруем шум (-1)
    const userNotes = userPitches
        .map(freq => freqToNote(freq))
        .filter(note => note !== -1);

    if (userNotes.length === 0) return { score: 0, text: "Голос не услышан." };

    // 3. Считаем, сколько целевых нот пользователь "задел"
    let hitCount = 0;
    targetNotes.forEach(tNote => {
        // Проверяем, есть ли эта нота в пении пользователя (с допуском +/- 1 полутон)
        const hit = userNotes.some(uNote => {
            let diff = Math.abs(uNote - tNote);
            if (diff > 6) diff = 12 - diff; // коррекция октавы
            return diff <= 1; // Допускаем погрешность в 1 полутон
        });
        
        if (hit) hitCount++;
    });

    // 4. Расчет процента
    // Если нашел все 3 ноты из 3 -> 100%
    // Если нашел 2 из 3 -> 66%
    let accuracy = (hitCount / targetNotes.size) * 100;
    
    // Бонус за старание (чтобы не было обидных 66%)
    if (accuracy > 0) accuracy += 10; 
    if (accuracy > 100) accuracy = 100;

    let text = "";
    if (accuracy > 80) text = "Отлично! Все ноты найдены!";
    else if (accuracy > 50) text = "Вы попали в часть нот.";
    else text = "Попробуйте пропеть мелодию четче.";

    return { score: Math.round(accuracy), text: text };
}


// --- UI HELPERS ---
function drawVisualizer() {
    if (!isRecording && audioCtx.state === 'suspended') return;
    requestAnimationFrame(drawVisualizer);
    analyser.getByteTimeDomainData(dataArray);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#03dac6';
    ctx.beginPath();
    const sliceWidth = canvas.width * 1.0 / bufferLength;
    let x = 0;
    for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = v * canvas.height / 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        x += sliceWidth;
    }
    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();
}

// События кнопок
btnPlayRef.addEventListener('click', playReferenceMelody);
btnRecord.addEventListener('click', () => {
    startRecording();
    btnRecord.disabled = true;
    btnStop.disabled = false;
    btnPlayRef.disabled = true;
    btnCompare.disabled = true;
});
btnStop.addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    isRecording = false;
    statusText.innerText = "⏹ Запись есть. Жми Сравнить!";
    btnRecord.disabled = false;
    btnStop.disabled = true;
    btnPlayRef.disabled = false;
    btnCompare.disabled = false;
});

drawVisualizer();
