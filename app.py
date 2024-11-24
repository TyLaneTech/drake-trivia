from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from flask_socketio import SocketIO, emit
import os
from azure.data.tables import TableServiceClient
from azure.core.credentials import AzureNamedKeyCredential
import secrets
from dotenv import load_dotenv

# Load environment variables from .env file if it exists
load_dotenv()

# Verify required Azure configurations
required_vars = [
    'AZURE_STORAGE_CONNECTION_STRING',
    'AZURE_WEBPUBSUB_CONNECTION_STRING',
    'FLASK_SECRET_KEY'
]

missing_vars = [var for var in required_vars if not os.getenv(var)]
if missing_vars:
    raise ValueError(
        f"Missing required environment variables: {', '.join(missing_vars)}\n"
        f"Please ensure these are set in your .env file or environment."
    )

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('FLASK_SECRET_KEY')

# Initialize Socket.IO with Azure Web PubSub
socketio = SocketIO(app,
                   message_queue=os.getenv('AZURE_WEBPUBSUB_CONNECTION_STRING'),
                   engineio_logger=True if os.getenv('DEBUG', '').lower() == 'true' else False)

# Initialize Azure Table Storage
table_service_client = TableServiceClient.from_connection_string(
    os.getenv('AZURE_STORAGE_CONNECTION_STRING')
)

# Create tables if they don't exist
for table_name in ['teams', 'questions', 'scores']:
    try:
        table_service_client.create_table(table_name)
        print(f"Created or verified table: {table_name}")
    except Exception as e:
        print(f"Table {table_name} already exists or error: {str(e)}")

# Get table clients
teams_table = table_service_client.get_table_client('teams')
questions_table = table_service_client.get_table_client('questions')
scores_table = table_service_client.get_table_client('scores')

@app.route('/')
def index():
    return redirect(url_for('login'))
@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        team_name = request.form.get('team_name')
        if team_name:
            # Store team in Azure Table
            teams_table.upsert_entity({
                'PartitionKey': 'teams',
                'RowKey': team_name,
                'active': True
            })
            session['team_name'] = team_name
            return redirect(url_for('questions'))
    return render_template('login.html')
@app.route('/admin')
def admin():
    # Add admin authentication later
    return render_template('admin.html')
@app.route('/questions')
def questions():
    if 'team_name' not in session:
        return redirect(url_for('login'))
    return render_template('questions.html', team=session['team_name'])
@app.route('/scores')
def scores():
    return render_template('scores.html')
# Socket.IO events
@socketio.on('connect')
def handle_connect():
    print('Client connected')
@socketio.on('submit_answer')
def handle_answer(data):
    team = data.get('team')
    answer = data.get('answer')
    question_id = data.get('question_id')
    timestamp = data.get('timestamp')

    # Store answer in Azure Table
    scores_table.upsert_entity({
        'PartitionKey': question_id,
        'RowKey': team,
        'answer': answer,
        'timestamp': timestamp,
        'score': calculate_score(team, answer, timestamp)
    })

    # Emit score update to all clients
    emit('score_update', {
        'team': team,
        'new_score': calculate_score(team, answer, timestamp)
    }, broadcast=True)

def calculate_score(team, answer, timestamp):
    # TODO: Implement scoring logic
    return 0

# API endpoints
@app.route('/api/questions/current', methods=['GET'])
def get_current_question():
    # Query the latest question from Azure Table
    try:
        # Get the most recent question (you'll need to implement this logic)
        query = questions_table.query_entities(
            query_filter="PartitionKey eq 'current'"
        )
        questions = list(query)
        if questions:
            return jsonify(questions[0])
        return jsonify({'error': 'No current question'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500
@app.route('/api/scores', methods=['GET'])
def get_scores():
    try:
        # Query all scores from Azure Table
        scores = []
        query = scores_table.query_entities()
        for score in query:
            scores.append({
                'team': score['RowKey'],
                'question': score['PartitionKey'],
                'score': score['score'],
                'timestamp': score['timestamp']
            })
        return jsonify(scores)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    # Get port from environment variable or use default
    port = int(os.getenv('PORT', 5000))

    # Get host from environment variable or use default
    host = os.getenv('HOST', '127.0.0.1')

    # Debug mode from environment variable
    debug = os.getenv('DEBUG', 'False').lower() == 'true'

    # Start the app
    print(f"Starting app on {host}:{port} (Debug: {debug})")
    print("Using Azure services for data storage and real-time communications")
    socketio.run(app, host=host, port=port, debug=debug)
