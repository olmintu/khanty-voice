// songs.js - База данных песен
// Здесь мы храним только тексты и пути, никакой сложной логики.

// Путь к папке (чтобы не писать 100 раз)
const BASE_PATH = 'songs/lesson1/'; 

// Полная песня
const FULL_SONG_URL = BASE_PATH + 'full.wav';

// Данные урока (Экспортируем этот массив)
const LESSON_DATA = [
    {
        file: BASE_PATH + '1.wav',
        text: 'Ас мув ӆув ма̄нты...',   // <-- Впиши сюда текст
        trans: 'Обской земли сказ...',    // <-- Впиши перевод
        google_text: 'Тьёй тьёй рабц рабц Тьёй тьёй рабц рабц' 
    },
    {
        file: BASE_PATH + '2.wav',
        text: 'Тумтак ӆув во̄ты...',
        trans: 'Ветром принесенный...',
        google_text: 'хивием энма Тьёй тьёй рабц рабц'
    },
    {
        file: BASE_PATH + '3.wav',
        text: '...',
        trans: '...', 
        google_text: 'тьёй тьёй рабц рабц шушием энма'
    },
    {
        file: BASE_PATH + '4.wav',
        text: '...',
        trans: '...', 
        google_text: 'ёшиие ёша сораша акхиль'
    },
    {
        file: BASE_PATH + '5.wav',
        text: '...',
        trans: '...', 
        google_text: 'кюриен кура сораша акхиль тьёй тьёй рабц рабц'
    },
    {
        file: BASE_PATH + '6.wav',
        text: '...',
        trans: '...', google_text: 'кёй кёй рапс рапс эвием энма тёй тёй рапс рапс'
    },
    {
        file: BASE_PATH + '7.wav',
        text: '...',
        trans: '...', google_text: 'шушием енма Тьёй тьёй рапс рапс тьой тьой рапс рапс'
    }
];
