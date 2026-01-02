"""
Simple test server without MediaPipe to verify Socket.IO works
"""
from flask import Flask, render_template
from flask_socketio import SocketIO, emit
import time
import random

app = Flask(__name__)
app.config['SECRET_KEY'] = 'test_secret'
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('connect')
def handle_connect():
    print('✅ Client connected!')
    emit('connection_status', {'status': 'connected'})

@socketio.on('disconnect')
def handle_disconnect():
    print('❌ Client disconnected!')

@socketio.on('test_spawn')
def handle_test_spawn():
    print('🧪 Test spawn requested')
    socketio.emit('spawn_fruit', {'x': 0.5, 'y': 0.5}, namespace='/')
    print('🍎 Sent spawn_fruit event')

@socketio.on('test_spawn_banana')
def handle_test_spawn_banana():
    print('🧪 Test banana spawn requested')
    socketio.emit('spawn_banana', {'x': 0.3, 'y': 0.5}, namespace='/')
    print('🍌 Sent spawn_banana event')

if __name__ == '__main__':
    print("🧪 TEST SERVER - Starting simple Socket.IO server...")
    print("Open http://localhost:5000")
    print("Press D to test apple spawning")
    print("Press B to test banana spawning")
    socketio.run(app, host='0.0.0.0', port=5000, debug=False)
