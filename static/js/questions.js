/* static/js/questions.js */

document.addEventListener('DOMContentLoaded', () => {
    initializeSocket();
    wireAnswerForm();
});

function initializeSocket() {
    if (typeof io === 'undefined') {
        console.error('socket.io client not loaded');
        return;
    }
    const socket = io();
    window.gameSocket = socket;

    socket.on('connect', () => console.log('Socket connected:', socket.id));
    socket.on('disconnect', () => console.log('Socket disconnected'));

    socket.on('question', (message) => {
        console.log('Received question:', message);
        if (message && message.data) displayQuestion(message.data);
    });

    socket.on('score_update', (message) => {
        console.log('Received score update:', message);
        updateScore(message);
    });

    socket.on('timer', (message) => {
        updateTimer(message);
    });
}

function wireAnswerForm() {
    const form = document.getElementById('answer-form');
    if (!form) return;
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = document.getElementById('answer-input');
        const answer = input ? input.value.trim() : '';
        if (!answer) return;
        submitAnswer(answer);
        if (input) input.value = '';
    });
}

function displayQuestion(data) {
    const questionElement = document.getElementById('question-text');
    const answersElement = document.getElementById('answers');
    if (questionElement) questionElement.textContent = data.question || data.text || '';
    if (answersElement && Array.isArray(data.answers)) {
        answersElement.innerHTML = '';
        data.answers.forEach(answer => {
            const li = document.createElement('li');
            li.textContent = answer;
            answersElement.appendChild(li);
        });
    }
}

function updateScore(data) {
    const scoreElement = document.getElementById(`score-${data.team}`);
    if (scoreElement) scoreElement.textContent = data.new_score;
}

function updateTimer(data) {
    const timerElement = document.getElementById('timer');
    if (!timerElement) return;
    timerElement.textContent = data.timeLeft != null ? data.timeLeft : data;
}

async function submitAnswer(answer) {
    try {
        const response = await fetch('/api/submit_answer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                team: window.currentTeam || null,
                answer: answer,
                question_id: window.currentQuestionId || null,
                timestamp: new Date().toISOString(),
            }),
        });
        if (!response.ok) throw new Error('Failed to submit answer');
        const result = await response.json();
        console.log('Answer submitted:', result);
    } catch (error) {
        console.error('Error submitting answer:', error);
    }
}
