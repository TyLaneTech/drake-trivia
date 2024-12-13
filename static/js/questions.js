/* static/js/questions.js */

// Initialize Azure Web PubSub connection
let webSocket;

async function initializeWebSocket(token) {
    try {
        // Connect to Azure Web PubSub
        webSocket = new WebSocket(token);

        webSocket.onopen = () => {
            console.log('Connected to Azure Web PubSub');
            // Join the trivia group
            webSocket.send(JSON.stringify({
                type: 'joinGroup',
                group: 'trivia'
            }));
        };

        webSocket.onclose = () => {
            console.log('Disconnected from Azure Web PubSub');
            // Attempt to reconnect after a delay
            setTimeout(() => initializeWebSocket(token), 5000);
        };

        webSocket.onerror = (error) => {
            console.error('WebSocket Error:', error);
        };

        webSocket.onmessage = (event) => {
            const message = JSON.parse(event.data);

            // Handle different event types
            switch (message.event) {
                case 'score_update':
                    handleScoreUpdate(message.data);
                    break;
                case 'new_question':
                    handleNewQuestion(message.data);
                    break;
                default:
                    console.log('Unknown message type:', message);
            }
        };
    } catch (error) {
        console.error('Failed to initialize WebSocket:', error);
    }
}

// Handle score updates
function handleScoreUpdate(data) {
    const scoreElement = document.getElementById('team-score');
    if (data.team === currentTeam) {
        scoreElement.textContent = data.new_score;
    }
}

// Handle new questions
function handleNewQuestion(data) {
    const questionElement = document.getElementById('question-text');
    questionElement.textContent = data.question;
    // Reset timer and other UI elements as needed
}

// Submit answer
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

// Initialize when the page loads
document.addEventListener('DOMContentLoaded', () => {
    const pubsubToken = document.getElementById('pubsub-token').value;
    initializeWebSocket(pubsubToken);
});
