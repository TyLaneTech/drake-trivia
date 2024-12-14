from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from werkzeug.security import generate_password_hash, check_password_hash
from azure.messaging.webpubsubservice import WebPubSubServiceClient
from azure.core.exceptions import ResourceNotFoundError
from azure.data.tables import TableServiceClient
import os, secrets, asyncio, json
from dotenv import load_dotenv
import secrets
import logging

def calculate_score(team, answer, timestamp):
    # TODO: Implement scoring logic
    return 0
    # Log sources to ignore non-error messages for

def setup_logging():
    """Configure logging"""
    log_level = logging.INFO
    logging.basicConfig(
        level=log_level,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )

    for loggerStr in ['azure.core.pipeline.policies.http_logging_policy', 'werkzeug', 'urllib3', 'openai', 'azure', 'httpx']:
        logger = logging.getLogger(loggerStr)
        logger.setLevel(logging.ERROR)
        logger.propagate = False

    # Suppress Azure SDK, and urllib3 logging messages
    http_logger = logging.getLogger('azure.core.pipeline.policies.http_logging_policy')
    urllib3_logger = logging.getLogger('urllib3')
    azure_logger = logging.getLogger('azure')
    urllib3_logger.setLevel(logging.ERROR)
    azure_logger.setLevel(logging.ERROR)
    http_logger.setLevel(logging.ERROR)
    urllib3_logger.propagate = False
    azure_logger.propagate = False
    http_logger.propagate = False

def webserver():
    """Initialize and run the Flask web server with all configurations"""
    # Load environment variables
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


    def init_admin_table(table_service_client):
        """Initialize admin user in Azure Table Storage"""
        admin_table = table_service_client.get_table_client('users')

        # Check if admin user exists
        try:
            admin_table.get_entity('admin', 'admin')
        except:
            # Create admin user if it doesn't exist
            admin_table.create_entity({
                'PartitionKey': 'admin',
                'RowKey': 'admin',
                'username': 'admin',
                # Default password is 'admin123' - should be changed after first login
                'password': generate_password_hash('admin123'),
                'token': secrets.token_hex(32)
            })
    def init_storage_tables(table_service_client):
        """Initialize Azure Storage Tables"""
        tables = {
            'teams': {
                'description': 'Stores team information and status',
                'client': None
            },
            'questions': {
                'description': 'Stores trivia questions and current game state',
                'client': None
            },
            'scores': {
                'description': 'Stores team answers and scoring information',
                'client': None
            },
            'users': {
                'description': 'Stores team answers and scoring information',
                'client': None
            }
        }

        # Create tables if they don't exist and store clients
        for table_name in tables:
            try:
                table_service_client.create_table(table_name)
                tables[table_name]['client'] = table_service_client.get_table_client(table_name)
                print(f"Created or verified table: {table_name}")
            except Exception as e:
                #print(f"Table {table_name} already exists or error: {str(e)}")
                tables[table_name]['client'] = table_service_client.get_table_client(table_name)

        return tables
    def inject_defaults():
        endpoint = request.path
        return {}
        appName = config.APP_NAME
        devMode = config.dev_mode


        # Define the b64encode filter function
        @timed_cache(3600*2)
        def b64encode_filter(value):
            print(f'Converting b64...')
            """Base64 encode a given value."""
            return base64.b64encode(value.encode('utf-8')).decode('utf-8')

        subtitleDict = {
            "Failed": "Jobs that failed before mapping",
            "Pending Review": "Jobs that completed with discrepencies",
            "Pending": "Jobs that are currently in progress",
            "Ignored": "Jobs that were manually ignored",
            "Success": "Jobs that completed with no discrepencies"
        }

        jobErrorNameMap = {"Field Mismatches": "Column Name Mismatches"}
        tableFieldDict = {}
        allSnowFields = {}
        if '/mappings' in str(endpoint).lower():
            tableFieldDict = json.dumps(readJSON(config.snowFieldRefJSON))
            allSnowFields = config.allSnowFields

        companyNames = []
        companyNamesB64 = ''
        if '/job/' in str(endpoint).lower():
            companyNames, companyNamesB64 = fetchValidAgencies(refreshDB=False, fetchAll=False, bs=context_bs, includeB64=True)

        allAccessLevels = ['user', 'admin', 'supervisor']

        isLoggedIn = 'username' in session
        username = session.get('username', None)
        alertDict = getAlertDict(username)
        userDict = getUserDict(username, ts=context_ts)


        userTemplates = getUserTemplates(username, returnType='name', bs=context_bs, ts=context_ts)

        if 'prod' in config.SHORT_ENV.lower():
            altName = 'Dev'
            altURL = APP_URL.replace('higgdatamapper.', 'higgdatamapper-dev.') + '/'
            appNameString = appName
        else:
            if 'localhost' in APP_URL.lower(): altURL = 'https://higgdatamapper.azurewebsites.net/'
            else: altURL = APP_URL.replace('higgdatamapper-dev.', 'higgdatamapper.') + '/'
            altName = 'Prod'
            appNameString = f'({config.SHORT_ENV}) Data Mapper'

        return {
            'appName': appName,
            'token': request.cookies.get('token', None),
            'altURL': altURL,
            'altName': altName,
            'appNameString': appNameString,
            'templates': userTemplates,
            'alertDict': alertDict,
            'userDict': userDict,
            'devMode': devMode,
            'allAccessLevels': allAccessLevels,
            'jobErrorNameMap': jobErrorNameMap,
            'tableFieldDict': tableFieldDict,
            'allSnowFields': allSnowFields,
            'validAgencies': companyNames,
            'validAgencyB64': companyNamesB64,
            'b64encode': b64encode_filter,
            'subtitleDict': subtitleDict,
            'isLoggedIn': isLoggedIn,
            'jsonDumps': json.dumps,
            'enumerate': enumerate,
            'type': type,
            'len': len,
            'str': str
        }
    def check_login(forceLogin=True):
        requestMethod = request.method
        endpoint = str(request.path)
        username = session.get('username', None)
        userIP = request.remote_addr
        validEndpoints = {rule.rule for rule in app.url_map.iter_rules()}

        # Logging requests
        if any(endpoint.startswith(validEndpoint) for validEndpoint in validEndpoints) and not endpoint.startswith('/socket.io/'):
            if '/static/' not in endpoint:
                if not (endpoint == '/' and requestMethod == 'GET'):
                    if not username: username = userIP
                    print(f'{username} - Requested "{endpoint}" ({requestMethod})')


    # Initialize Flask app
    app = Flask(__name__)
    app.config['SECRET_KEY'] = os.getenv('FLASK_SECRET_KEY')
    app.context_processor(inject_defaults)
    app.before_request(check_login)

    # Initialize Azure Web PubSub client
    question_client = WebPubSubServiceClient.from_connection_string(os.getenv('AZURE_WEBPUBSUB_CONNECTION_STRING'), hub='questions')
    score_client = WebPubSubServiceClient.from_connection_string(os.getenv('AZURE_WEBPUBSUB_CONNECTION_STRING'), hub='scores')
    table_service_client = TableServiceClient.from_connection_string(os.getenv('AZURE_STORAGE_CONNECTION_STRING'))

    # Initialize tables and get table clients
    tables = init_storage_tables(table_service_client)
    teams_table = tables['teams']['client']
    questions_table = tables['questions']['client']
    scores_table = tables['scores']['client']
    init_admin_table(table_service_client)


    # Route definitions
    @app.route('/')
    def index():
        return redirect(url_for('login'))
    @app.route('/logout')
    def logout():
        session.clear()
        return redirect(url_for('index'))
    @app.route('/login', methods=['GET', 'POST'])
    def login():
        if request.method == 'POST':
            team_name = request.form.get('team_name')
            if team_name:
                teams_table.upsert_entity({
                    'PartitionKey': 'teams',
                    'RowKey': team_name,
                    'active': True
                })
                session['team_name'] = team_name
                return redirect(url_for('scores'))
        return render_template('login.html')

    @app.route('/admin-login', methods=['GET', 'POST'])
    def admin_login():
        if request.method == 'GET':
            return render_template('admin_login.html')

        data = request.json
        username = data.get('username')
        password = data.get('password')

        if not username or not password:
            return jsonify({'error': 'Missing credentials'}), 400

        admin_table = tables['users']['client']

        try:
            # Try to get admin user
            admin_user = admin_table.get_entity('admin', 'admin')

            # Check credentials
            if username == admin_user['username'] and check_password_hash(admin_user['password'], password):
                # Create new session token
                new_token = secrets.token_hex(32)

                # Update token in database
                admin_user['token'] = new_token
                admin_table.update_entity(admin_user)

                # Set session variables
                session['is_admin'] = True
                session['admin_token'] = new_token

                return jsonify({'redirect': url_for('admin')})
            else:
                return jsonify({'error': 'Invalid credentials'}), 401

        except ResourceNotFoundError:
            # Admin user does not exist, create one
            token = secrets.token_hex(32)
            admin_table.create_entity({
                'PartitionKey': 'admin',
                'RowKey': 'admin',
                'username': username,
                'password': generate_password_hash(password),
                'token': token
            })

            # Set session variables
            session['is_admin'] = True
            session['admin_token'] = token

            return jsonify({'redirect': url_for('admin')})

        except Exception as e:
            print(f"Admin login error: {str(e)}")
            return jsonify({'error': 'Server error'}), 500
    @app.route('/admin')
    def admin():
        # Verify admin session
        if not session.get('is_admin'):
            return redirect(url_for('admin_login'))

        admin_table = tables['users']['client']
        try:
            admin_user = admin_table.get_entity('admin', 'admin')
            if session.get('admin_token') != admin_user['token']:
                session.clear()
                return redirect(url_for('admin_login'))
        except:
            session.clear()
            return redirect(url_for('admin_login'))

        return render_template('admin.html')
    @app.route('/api/admin/check', methods=['GET'])
    def check_admin_exists():
        try:
            admin_table = tables['users']['client']
            try:
                admin_table.get_entity('admin', 'admin')
                return jsonify({'exists': True})
            except ResourceNotFoundError:
                return jsonify({'exists': False})
        except Exception as e:
            return jsonify({'error': str(e)}), 500
    @app.route('/api/admin/setup', methods=['POST'])
    def setup_admin():
        try:
            data = request.json
            username = data.get('username')
            password = data.get('password')

            if not username or not password:
                return jsonify({'error': 'Missing credentials'}), 400

            admin_table = tables['users']['client']

            # Check if admin already exists
            try:
                admin_table.get_entity('admin', 'admin')
                return jsonify({'error': 'Admin already exists'}), 400
            except ResourceNotFoundError:
                # Create new admin user
                admin_token = secrets.token_hex(32)
                admin_table.create_entity({
                    'PartitionKey': 'admin',
                    'RowKey': 'admin',
                    'username': username,
                    'password': generate_password_hash(password),
                    'token': admin_token
                })

                # Set session variables
                session['is_admin'] = True
                session['admin_token'] = admin_token

                return jsonify({'redirect': url_for('admin')})

        except Exception as e:
            return jsonify({'error': str(e)}), 500

    @app.route('/questions')
    def questions():
        if 'team_name' not in session:
            return redirect(url_for('login'))

        # Generate client access token for WebPubSub
        token = question_client.get_client_access_token()
        print(token)

        return render_template(
            'questions.html',
            team=session['team_name'],
            pubsub_token=token
        )
    @app.route('/scores')
    def scores():
        token = score_client.get_client_access_token()

        return render_template('scores.html', pubsub_token=token)

    # WebPubSub event handlers
    @app.route('/api/submit_answer', methods=['POST'])
    def handle_answer():
        try:
            data = request.json
            team = data.get('team')
            answer = data.get('answer')
            question_id = data.get('question_id')
            timestamp = data.get('timestamp')

            # Store the answer
            scores_table.upsert_entity({
                'PartitionKey': question_id,
                'RowKey': team,
                'answer': answer,
                'timestamp': timestamp,
                'score': calculate_score(team, answer, timestamp)
            })

            # Broadcast score update using Web PubSub
            pubsub_client.send_to_all(
                hub="trivia",
                content=json.dumps({
                    'event': 'score_update',
                    'data': {
                        'team': team,
                        'new_score': calculate_score(team, answer, timestamp)
                    }
                })
            )

            return jsonify({'status': 'success'})

        except Exception as e:
            print(f"Error handling answer: {str(e)}")
            return jsonify({'error': str(e)}), 500

    # API endpoints
    @app.route('/api/questions/current', methods=['GET'])
    def get_current_question():
        try:
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


    return app

if __name__ == '__main__':
    try:
        # Get application instance
        app = webserver()

        # Get configuration from environment variables
        port = int(os.getenv('PORT', 5000))
        host = os.getenv('HOST', '127.0.0.1')

        # Start the app
        print(f"Starting app on http://{host}:{port}/")
        app.run(host=host, port=port, debug=False)
    except Exception as e:
        print(f"Failed to start server: {str(e)}")
        raise
else:
    setup_logging()
    app = webserver()
