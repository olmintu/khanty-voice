// app.js - Версия: Фонетическая подсветка и Нечеткий поиск

// --- ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ---
let currentStep = 0;
let currentTargetData = null; 
let currentAudioBuffer = null; 
let isPlayingPhrase = false; 
let activeSourceNode = null; 
let fullSongAudio = null;

// --- GOOGLE SPEECH (DEBUG VERSION) ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let recognizedText = "";

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.lang = 'ru-RU'; 
    recognition.continuous = true; 
    recognition.interimResults = true; 

    // Когда Гугл начинает слушать
    recognition.onstart = () => {
        console.log("🟢 Google Speech: Слушаю...");
    };

    // Когда приходит результат (даже частичный)
    recognition.onresult = (e) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = e.resultIndex; i < e.results.length; ++i) {
            if (e.results[i].isFinal) {
                finalTranscript += e.results[i][0].transcript;
            } else {
                interimTranscript += e.results[i][0].transcript;
            }
        }
        
        // Мы берем или финал, или черновик - что есть
        recognizedText = (finalTranscript + interimTranscript).toLowerCase();
        
        console.log("👂 Google heard:", recognizedText);
        
        // Сразу пишем на экран, чтобы ты видел
        if (document.getElementById('google-heard')) {
            document.getElementById('google-heard').innerText = recognizedText;
        }
    };

    // Если ошибка
    recognition.onerror = (e) => {
        console.error("🔴 Google Error:", e.error);
        if (e.error === 'not-allowed') alert("Разрешите доступ к микрофону для Google!");
        if (e.error === 'network') alert("Нужен интернет для распознавания!");
    };
    
    // Если сам отключился
    recognition.onend = () => {
        console.log("⚪ Google Speech: Отключился.");
        // Если запись еще идет, а Гугл упал - перезапустим его!
        if (isRecording) {
            console.log("🔄 Перезапуск Google...");
            try { recognition.start(); } catch(e){}
        }
    };
} else {
    alert("Ваш браузер не поддерживает Speech API. Попробуйте Chrome.");
}


// --- АУДИО ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const analyser = audioCtx.createAnalyser();
analyser.fftSize = 2048;
const dataArray = new Uint8Array(analyser.frequencyBinCount);

let isRecording = false;
let mediaRecorder;
let audioChunks = [];
let userAudioBlob = null;

// UI
const statusText = document.getElementById('status');
const canvas = document.getElementById('visualizer');
const ctx = canvas.getContext('2d');
const scoreDisplay = document.getElementById('score');
const recDisplay = document.getElementById('recommendation');
const googleHeardDisplay = document.getElementById('google-heard');
const stepIndicator = document.getElementById('step-indicator');

// Элементы текста (для подсветки)
const lyricsOriginal = document.getElementById('lyrics-original');
const lyricsPhonetic = document.getElementById('lyrics-phonetic');

// --- 0. ОСТАНОВКА ---
function stopAllAudio() {
    if (activeSourceNode) { try { activeSourceNode.stop(); } catch(e){} activeSourceNode = null; }
    isPlayingPhrase = false;
    if (fullSongAudio) { fullSongAudio.pause(); fullSongAudio.currentTime = 0; }
    if (isRecording) stopRecording();
    try { analyser.disconnect(); } catch(e){}
    if (recognition) try { recognition.stop(); } catch(e){}
    statusText.innerText = "Готов.";
}

// --- 1. ЗАГРУЗКА ШАГА (С разбиением на слова) ---
async function loadStep(index) {
    stopAllAudio();
    statusText.innerText = "⏳ Загрузка...";
    document.getElementById('results').classList.add('hidden');
    
    stepIndicator.innerText = `Фраза ${index + 1} из ${LESSON_DATA.length}`;
    document.getElementById('btn-prev').disabled = index === 0;
    document.getElementById('btn-next').disabled = index === LESSON_DATA.length - 1;

    const data = LESSON_DATA[index];

    // 1. Рендерим Хантыйский текст по словам (чтобы можно было подсветить)
    lyricsOriginal.innerHTML = data.text.split(' ').map(word => 
        `<span class="khanty-word">${word}</span>`
    ).join(' ');

    // 2. Рендерим Фонетику по словам
    const phoneticWords = (data.google_text || "").split(' ');
    lyricsPhonetic.innerHTML = phoneticWords.map(word => 
        `<span class="word" data-word="${word}">${word}</span>`
    ).join(' ');

    document.getElementById('lyrics-translation').innerText = data.trans;

    currentAudioBuffer = null;
    recognizedText = "";

    try {
        const response = await fetch(data.file);
        if (!response.ok) throw new Error("Нет файла");
        const arrayBuffer = await response.arrayBuffer();
        currentAudioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        currentTargetData = analyzeAudioBuffer(currentAudioBuffer);
        statusText.innerText = "Готов.";
    } catch (err) {
        console.error(err);
        statusText.innerText = "Ошибка файла";
    }
}

// --- 2. ВОСПРОИЗВЕДЕНИЕ ---
document.getElementById('btn-play-ref').addEventListener('click', async () => {
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    if (isPlayingPhrase) { stopAllAudio(); return; }
    stopAllAudio();
    if (!currentAudioBuffer) return;

    statusText.innerText = "🔊 Слушаем...";
    const source = audioCtx.createBufferSource();
    source.buffer = currentAudioBuffer;
    source.connect(analyser);
    analyser.connect(audioCtx.destination);
    source.start(0);
    activeSourceNode = source;
    isPlayingPhrase = true;
    drawVisualizer(); 
    source.onended = () => { isPlayingPhrase = false; statusText.innerText = "Повтори."; };
});

document.getElementById('btn-full-song').addEventListener('click', () => {
    if (fullSongAudio && !fullSongAudio.paused) { stopAllAudio(); return; }
    stopAllAudio();
    fullSongAudio = new Audio(FULL_SONG_URL);
    fullSongAudio.play();
});

// --- 3. ЗАПИСЬ ---
document.getElementById('btn-record').addEventListener('click', async () => {
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    stopAllAudio(); 
    
    // Сброс подсветки перед новой записью
    document.querySelectorAll('.word').forEach(el => el.classList.remove('matched'));
    document.querySelectorAll('.khanty-word').forEach(el => el.classList.remove('matched'));

    statusText.innerText = "🔴 Пой!";
    recognizedText = "";

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } 
        });
        const source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);
        
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
        mediaRecorder.onstop = () => {
            userAudioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            stream.getTracks().forEach(t => t.stop());
            source.disconnect();
            
        };
        mediaRecorder.start();
        isRecording = true;

        if (recognition) {
            try { recognition.start(); } catch (e) {}
        }

        document.getElementById('btn-record').disabled = true;
        document.getElementById('btn-stop').disabled = false;
        document.getElementById('btn-compare').disabled = true;
        drawVisualizer();

    } catch (e) {
        statusText.innerText = "❌ Нет микрофона";
    }
});

document.getElementById('btn-stop').addEventListener('click', () => {
    stopAllAudio();
    document.getElementById('btn-record').disabled = false;
    document.getElementById('btn-stop').disabled = true;
    document.getElementById('btn-compare').disabled = false;
});

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    isRecording = false;
}

// --- 4. СРАВНЕНИЕ (С ПОДСВЕТКОЙ) ---
document.getElementById('btn-compare').addEventListener('click', () => {
    // 1. Сначала мягко останавливаем Гугл (если он еще слушает)
    if (recognition) {
        try { recognition.stop(); } catch(e){}
    }

    statusText.innerText = "🧮 Ждем ответ от Google...";
    
    // 2. Делаем паузу 1 секунду перед анализом.
    // Это критически важно! Гугл возвращает финальный текст через 0.5-1с после тишины.
    setTimeout(async () => {
        if (!userAudioBlob) {
            statusText.innerText = "❌ Нет записи для проверки";
            return;
        }

        statusText.innerText = "🧮 Анализирую...";
        document.getElementById('results').classList.remove('hidden');

        // Обновляем текст на экране (финальная проверка)
        if (googleHeardDisplay) googleHeardDisplay.innerText = recognizedText || "(тишина)";

        // 3. Стандартный анализ аудио
        const arrayBuffer = await userAudioBlob.arrayBuffer();
        const userBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        const userData = analyzeAudioBuffer(userBuffer);
        
        // Получаем правильный текст
        const targetGoogleText = LESSON_DATA[currentStep].google_text || "";

        // 4. Считаем баллы
        const result = calculateScore(userData, currentTargetData, recognizedText, targetGoogleText);
        
        scoreDisplay.innerText = result.score;
        recDisplay.innerText = result.text;
        statusText.innerText = "Готово.";
        
    }, 1000); // 1000 мс = 1 секунда задержки
});


// --- НАВИГАЦИЯ ---
document.getElementById('btn-next').addEventListener('click', () => {
    if (currentStep < LESSON_DATA.length - 1) { currentStep++; loadStep(currentStep); }
});
document.getElementById('btn-prev').addEventListener('click', () => {
    if (currentStep > 0) { currentStep--; loadStep(currentStep); }
});

// --- ФУНКЦИИ ОЦЕНКИ ---

function calculateScore(userData, targetData, userText, targetText) {
    if (!targetData) return { score: 0, text: "Ошибка" };

    // 1. НОТЫ (30%)
    const userMelody = compressMelody(userData.notes);
    const targetMelody = compressMelody(targetData.notes);
    let noteScore = 0;
    if (targetMelody.length > 0 && userMelody.length > 0) {
        const dist = levenshteinDistance(userMelody, targetMelody);
        const maxLen = Math.max(userMelody.length, targetMelody.length);
        noteScore = (1 - (dist / maxLen)) * 100;
    }

    // 2. РИТМ (30%)
    let rhythmScore = compareRhythm(userData.volume, targetData.volume);

    // 3. СЛОВА (40%) с Нечетким поиском и Подсветкой
    let textScore = 0;
    let matchedWordsCount = 0;
    const targetWords = targetText.toLowerCase().split(' '); // Ожидаемые слова
    const userWords = userText.toLowerCase().split(' ');     // Что услышал Гугл

    // Бежим по ожидаемым словам и ищем их у пользователя
    const phoneticSpans = document.querySelectorAll('#lyrics-phonetic .word');
    const khantySpans = document.querySelectorAll('#lyrics-original .khanty-word');

    targetWords.forEach((targetWord, index) => {
        // Ищем совпадение в ЛЮБОМ месте услышанной фразы
        const isMatched = userWords.some(uWord => isWordSimilar(uWord, targetWord));
        
        if (isMatched) {
            matchedWordsCount++;
            // Подсвечиваем Фонетику
            if (phoneticSpans[index]) phoneticSpans[index].classList.add('matched');
            // Подсвечиваем Хантыйский (по индексу)
            if (khantySpans[index]) khantySpans[index].classList.add('matched');
        }
    });

    if (targetWords.length > 0) {
        textScore = (matchedWordsCount / targetWords.length) * 100;
    } else {
        textScore = 100; // Текста нет
    }

    // ИТОГ
    let finalScore = (noteScore * 0.3) + (rhythmScore * 0.3) + (textScore * 0.4);

    let text = "";
    if (finalScore > 80) text = "Отлично!";
    else if (textScore < 40) text = "Слова не распознаны.";
    else text = "Тренируйтесь.";

    return { score: Math.round(finalScore), text: text };
}

// Хелпер: Похожи ли слова (Нечеткое сравнение)
function isWordSimilar(wordA, wordB) {
    // 1. Очистка от знаков препинания
    const a = wordA.replace(/[.,!?]/g, '');
    const b = wordB.replace(/[.,!?]/g, '');
    
    if (a === b) return true; // Полное совпадение

    // 2. Частичное совпадение (если слово длинное)
    if (a.length > 3 && b.length > 3) {
        if (a.includes(b) || b.includes(a)) return true; // "рапс" внутри "рапса"
    }

    // 3. Расстояние Левенштейна (допуск ошибок)
    const dist = levenshteinString(a, b);
    const maxLen = Math.max(a.length, b.length);
    
    // Если слово короткое (<= 3 букв), допускаем 1 ошибку (например, "той" вместо "тёй")
    if (maxLen <= 3) return dist <= 1;
    // Если длинное, допускаем 2 ошибки
    return dist <= 2;
}

function drawVisualizer() {
    if (!isRecording && !isPlayingPhrase) return;
    requestAnimationFrame(drawVisualizer);
    analyser.getByteTimeDomainData(dataArray);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2; ctx.strokeStyle = '#03dac6'; ctx.beginPath();
    const sliceWidth = canvas.width * 1.0 / dataArray.length; let x = 0;
    for (let i = 0; i < dataArray.length; i++) {
        const v = dataArray[i] / 128.0; const y = v * canvas.height / 2;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); x += sliceWidth;
    }
    ctx.lineTo(canvas.width, canvas.height / 2); ctx.stroke();
}

function analyzeAudioBuffer(buffer) {
    const rawData = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    const stepSize = Math.floor(sampleRate * 0.05); 
    let timeSeries = []; let volumeSeries = []; let maxVolume = 0;
    for (let i = 0; i < rawData.length; i += stepSize) {
        const segment = rawData.slice(i, i + stepSize);
        let rms = 0; for (let k = 0; k < segment.length; k++) rms += segment[k] * segment[k];
        rms = Math.sqrt(rms / segment.length);
        if (rms > maxVolume) maxVolume = rms;
        volumeSeries.push(rms);
        const result = autoCorrelate(segment, sampleRate);
        if (result.freq > 0 && result.certainty > 0.6) { timeSeries.push(freqToNote(result.freq)); } else { timeSeries.push(-1); }
    }
    if (maxVolume > 0) volumeSeries = volumeSeries.map(v => v / maxVolume);
    return { notes: timeSeries, volume: volumeSeries };
}

function compareRhythm(userVol, targetVol) {
    const len = Math.min(userVol.length, targetVol.length);
    if (len === 0) return 0;
    let matchSum = 0;
    for (let i = 0; i < len; i++) {
        let u = userVol[i] > 0.1 ? 1 : 0; let t = targetVol[i] > 0.1 ? 1 : 0;
        if (u === t) matchSum++; 
    }
    return (matchSum / len) * 100;
}

function compressMelody(series) {
    if (!series) return [];
    let melody = []; let lastNote = -200;
    for (let note of series) {
        if (note === -1) continue; 
        if (note !== lastNote) { melody.push(note); lastNote = note; }
    }
    return melody;
}

function levenshteinDistance(a, b) {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b[i - 1] === a[j - 1]) { matrix[i][j] = matrix[i - 1][j - 1]; } 
            else {
                let diff = Math.abs(b[i - 1] - a[j - 1]); if (diff > 6) diff = 12 - diff;
                let cost = (diff <= 1) ? 0.5 : 1;
                matrix[i][j] = Math.min(matrix[i - 1][j - 1] + cost, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
            }
        }
    }
    return matrix[b.length][a.length];
}

function autoCorrelate(buf, sampleRate) {
    let rms = 0; for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i]; rms = Math.sqrt(rms / buf.length);
    if (rms < 0.01) return { freq: -1, certainty: 0 };
    let r1 = 0, r2 = buf.length - 1, thres = 0.2;
    for (let i = 0; i < buf.length / 2; i++) if (Math.abs(buf[i]) < thres) { r1 = i; break; }
    for (let i = 1; i < buf.length / 2; i++) if (Math.abs(buf[buf.length - i]) < thres) { r2 = buf.length - i; break; }
    buf = buf.slice(r1, r2);
    let c = new Array(buf.length).fill(0);
    for (let i = 0; i < buf.length; i++) for (let j = 0; j < buf.length - i; j++) c[i] = c[i] + buf[j] * buf[j + i];
    let d = 0; while (c[d] > c[d + 1]) d++;
    let maxval = -1, maxpos = -1;
    for (let i = d; i < buf.length; i++) if (c[i] > maxval) { maxval = c[i]; maxpos = i; }
    let certainty = (c[0] > 0) ? maxval / c[0] : 0;
    return { freq: sampleRate / maxpos, certainty: certainty };
}

function freqToNote(freq) {
    if (freq <= 0) return -1;
    const noteNum = 12 * (Math.log(freq / 440) / Math.log(2));
    return (Math.round(noteNum) + 69) % 12;
}

function levenshteinString(a, b) {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) matrix[i][j] = matrix[i - 1][j - 1];
            else matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
        }
    }
    return matrix[b.length][a.length];
}

loadStep(0);
