/* static/js/questions.js */

// Initialize Azure Web PubSub connection
document.addEventListener('DOMContentLoaded', () => {
    initializeWebSocket('trivia');
});

function initializeWebSocket(hubName) {
    const hostname = "draketriviawps2.webpubsub.azure.com";
    let ws;
    let reconnectTimeout = 0; // 2 seconds

    const connectWebSocket = () => {
        let socketURL = 'wss://draketriviawps2.webpubsub.azure.com/client/hubs/Hub?access_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJ3c3M6Ly9kcmFrZXRyaXZpYXdwczIud2VicHVic3ViLmF6dXJlLmNvbS9jbGllbnQvaHVicy9IdWIiLCJpYXQiOjE3MzQ2MjgzMDcsImV4cCI6MTczNDYzMTkwN30.OvH3ndZSrwnNuHBoNwjtCmARPYoua7Zn8wJgK48T4hk';
        //let socketURL = `wss://${hostname}/client/hubs/${hubName}`;
        ws = new WebSocket(socketURL);
        console.log(`Connected to WebPubSub: ${socketURL}`);
        ws.onopen = () => {
            console.log(`WebSocket connection opened for hub: ${hubName}`);
        };

        ws.onclose = () => {
            console.log(`WebSocket connection closed for hub: ${hubName}. Attempting to reconnect...`);
            setTimeout(connectWebSocket, reconnectTimeout);
        };

        ws.onerror = (error) => {
          ///  console.error(`WebSocket error for hub: ${hubName}`, error);
        };

        ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            console.log(`Received message on hub ${hubName}:`, message);

            switch (hubName) {
                case 'questions':
                    handleQuestionMessage(message);
                    break;
                case 'scores':
                    handleScoreMessage(message);
                    break;
                case 'trivia':
                    console.log(`Trivia Message: ${message}`)
                default:
                    console.error(`Unknown hub: ${hubName}`);
            }
        };
    };

    connectWebSocket();
}

function handleQuestionMessage(message) {
    switch (message.type) {
        case 'question':
            displayQuestion(message.data);
            break;
        case 'timer':
            updateTimer(message.data);
            break;
        default:
            console.log('Unknown question message type:', message.type);
    }
}

function handleScoreMessage(message) {
    switch (message.type) {
        case 'scoreUpdate':
            updateScore(message.data);
            break;
        default:
            console.log('Unknown score message type:', message.type);
    }
}

function displayQuestion(data) {
    const questionElement = document.getElementById('question');
    const answersElement = document.getElementById('answers');
    questionElement.textContent = data.question;
    answersElement.innerHTML = ''; // Clear previous answers
    data.answers.forEach(answer => {
        const li = document.createElement('li');
        li.textContent = answer;
        answersElement.appendChild(li);
    });
}

function updateScore(data) {
    const scoreElement = document.getElementById(`score-${data.team}`);
    if (scoreElement) {
        scoreElement.textContent = data.score;
    }
}

function updateTimer(data) {
    const timerElement = document.getElementById('timer');
    timerElement.textContent = data.timeLeft;
}


// Submit an answer
async function submitAnswer(answer) {
    try {
        const response = await fetch('/api/submit_answer', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                team: currentTeam,
                answer: answer,
                question_id: currentQuestionId,
                timestamp: new Date().toISOString()
            })
        });

        if (!response.ok) {
            throw new Error('Failed to submit answer');
        }

        const result = await response.json();
        console.log('Answer submitted successfully:', result);
    } catch (error) {
        console.error('Error submitting answer:', error);
    }
}
