import cv2
import numpy as np
import math
import threading
import time
import os
import urllib.request
from flask import Flask, render_template, Response
from flask_socketio import SocketIO, emit

import mediapipe as mp
from mediapipe.tasks import python as mp_tasks
from mediapipe.tasks.python import vision

app = Flask(__name__)
app.config['SECRET_KEY'] = 'ar_mukbang_secret'
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading', logger=False, engineio_logger=False)

MODELS_DIR = os.path.join(os.path.dirname(__file__), 'models')
HAND_MODEL_PATH = os.path.join(MODELS_DIR, 'hand_landmarker.task')
FACE_MODEL_PATH = os.path.join(MODELS_DIR, 'face_landmarker.task')

HAND_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task"
FACE_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task"

latest_frame = None
frame_lock = threading.Lock()
is_running = True
hand_landmarker = None
face_landmarker = None
connected_clients = 0

drawing_points = []
drawing_state = 'IDLE'
CIRCLE_DETECTION_THRESHOLD = 0.7
last_shape_check_time = 0

def download_models():
    os.makedirs(MODELS_DIR, exist_ok=True)
    
    if not os.path.exists(HAND_MODEL_PATH):
        print(f"Downloading hand landmarker model...")
        urllib.request.urlretrieve(HAND_MODEL_URL, HAND_MODEL_PATH)
        print(f"Hand model downloaded to {HAND_MODEL_PATH}")
    
    if not os.path.exists(FACE_MODEL_PATH):
        print(f"Downloading face landmarker model...")
        urllib.request.urlretrieve(FACE_MODEL_URL, FACE_MODEL_PATH)
        print(f"Face model downloaded to {FACE_MODEL_PATH}")

def initialize_mediapipe():
    global hand_landmarker, face_landmarker
    
    download_models()
    
    hand_base_options = mp_tasks.BaseOptions(model_asset_path=HAND_MODEL_PATH)
    hand_options = vision.HandLandmarkerOptions(
        base_options=hand_base_options,
        num_hands=1,
        min_hand_detection_confidence=0.4,
        min_tracking_confidence=0.3,
        running_mode=vision.RunningMode.IMAGE
    )
    hand_landmarker = vision.HandLandmarker.create_from_options(hand_options)
    
    face_base_options = mp_tasks.BaseOptions(model_asset_path=FACE_MODEL_PATH)
    face_options = vision.FaceLandmarkerOptions(
        base_options=face_base_options,
        num_faces=1,
        min_face_detection_confidence=0.5,
        min_tracking_confidence=0.5,
        running_mode=vision.RunningMode.IMAGE
    )
    face_landmarker = vision.FaceLandmarker.create_from_options(face_options)
    
    print("MediaPipe models initialized!")

def calculate_distance(p1, p2):
    return math.sqrt((p1.x - p2.x)**2 + (p1.y - p2.y)**2 + (p1.z - p2.z)**2)

def calculate_distance_2d(p1, p2):
    return math.sqrt((p1[0] - p2[0])**2 + (p1[1] - p2[1])**2)

def is_finger_extended(landmarks, finger_tip_id, finger_pip_id, wrist):
    tip = landmarks[finger_tip_id]
    pip = landmarks[finger_pip_id]
    tip_dist = calculate_distance(tip, wrist)
    pip_dist = calculate_distance(pip, wrist)
    return tip_dist > pip_dist

def detect_index_pointing(landmarks):
    wrist = landmarks[0]
    
    index_extended = is_finger_extended(landmarks, 8, 6, wrist)
    middle_extended = is_finger_extended(landmarks, 12, 10, wrist)
    ring_extended = is_finger_extended(landmarks, 16, 14, wrist)
    pinky_extended = is_finger_extended(landmarks, 20, 18, wrist)
    
    return index_extended and not middle_extended and not ring_extended and not pinky_extended

def detect_fist(landmarks):
    wrist = landmarks[0]
    
    index_extended = is_finger_extended(landmarks, 8, 6, wrist)
    middle_extended = is_finger_extended(landmarks, 12, 10, wrist)
    ring_extended = is_finger_extended(landmarks, 16, 14, wrist)
    pinky_extended = is_finger_extended(landmarks, 20, 18, wrist)
    
    return not index_extended and not middle_extended and not ring_extended and not pinky_extended

def check_circle_shape(points):
    if len(points) < 10:
        return False, None
    
    points_array = np.array(points, dtype=np.float32)
    
    x_coords = points_array[:, 0]
    y_coords = points_array[:, 1]
    
    width = np.max(x_coords) - np.min(x_coords)
    height = np.max(y_coords) - np.min(y_coords)
    
    if width < 0.05 or height < 0.05:
        return False, None
    
    aspect_ratio = min(width, height) / max(width, height)
    
    if aspect_ratio < 0.6:
        return False, None
    
    center_x = (np.min(x_coords) + np.max(x_coords)) / 2
    center_y = (np.min(y_coords) + np.max(y_coords)) / 2
    
    start_point = points[0]
    end_point = points[-1]
    closure_distance = calculate_distance_2d(start_point, end_point)
    
    avg_radius = (width + height) / 4
    
    if closure_distance > avg_radius * 0.5:
        return False, None
    
    distances = [calculate_distance_2d((p[0], p[1]), (center_x, center_y)) for p in points]
    mean_distance = np.mean(distances)
    distance_variance = np.std(distances) / mean_distance if mean_distance > 0 else 1
    
    is_circle = distance_variance < 0.5
    
    return is_circle, (center_x, center_y) if is_circle else None

def check_crescent_shape(points):
    if len(points) < 8:
        return False, None
    
    points_array = np.array(points)
    x_coords = points_array[:, 0]
    y_coords = points_array[:, 1]
    
    width = np.max(x_coords) - np.min(x_coords)
    height = np.max(y_coords) - np.min(y_coords)
    
    if width < 0.03 or height < 0.03:
        return False, None
    
    aspect_ratio = min(width, height) / max(width, height)
    
    if aspect_ratio < 0.2 or aspect_ratio > 0.75:
        return False, None
    
    center_x = (np.min(x_coords) + np.max(x_coords)) / 2
    center_y = (np.min(y_coords) + np.max(y_coords)) / 2
    
    start_point = points[0]
    end_point = points[-1]
    closure_distance = calculate_distance_2d(start_point, end_point)
    
    avg_size = (width + height) / 2
    
    if closure_distance < avg_size * 0.15:
        return False, None
    
    mid_idx = len(points) // 2
    mid_point = points[mid_idx]
    
    line_mx = (start_point[0] + end_point[0]) / 2
    line_my = (start_point[1] + end_point[1]) / 2
    mid_offset = calculate_distance_2d((mid_point[0], mid_point[1]), (line_mx, line_my))
    
    if mid_offset < avg_size * 0.08:
        return False, None
    
    is_crescent = True
    
    return is_crescent, (center_x, center_y) if is_crescent else None

def draw_hand_landmarks(frame, landmarks, h, w):
    connections = [
        (0, 1), (1, 2), (2, 3), (3, 4),
        (0, 5), (5, 6), (6, 7), (7, 8),
        (0, 9), (9, 10), (10, 11), (11, 12),
        (0, 13), (13, 14), (14, 15), (15, 16),
        (0, 17), (17, 18), (18, 19), (19, 20),
        (5, 9), (9, 13), (13, 17)
    ]
    
    for start_idx, end_idx in connections:
        start = landmarks[start_idx]
        end = landmarks[end_idx]
        pt1 = (int(start.x * w), int(start.y * h))
        pt2 = (int(end.x * w), int(end.y * h))
        cv2.line(frame, pt1, pt2, (0, 255, 0), 2)
    
    for lm in landmarks:
        pt = (int(lm.x * w), int(lm.y * h))
        cv2.circle(frame, pt, 5, (255, 0, 0), -1)

def process_frame(frame):
    global drawing_points, drawing_state, last_shape_check_time
    
    frame = cv2.flip(frame, 1)
    h, w = frame.shape[:2]
    
    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
    
    data = {
        'hand': None,
        'mouth': None,
        'timestamp': time.time()
    }
    
    spawn_fruit = None
    spawn_banana = None
    
    if hand_landmarker:
        hand_result = hand_landmarker.detect(mp_image)
        
        if hand_result.hand_landmarks and len(hand_result.hand_landmarks) > 0:
            landmarks = hand_result.hand_landmarks[0]
            
            index_tip = landmarks[8]
            thumb_tip = landmarks[4]
            
            pinch_distance = calculate_distance(index_tip, thumb_tip)
            is_pinching = pinch_distance < 0.05
            
            data['hand'] = {
                'x': index_tip.x,
                'y': index_tip.y,
                'z': index_tip.z,
                'thumb_x': thumb_tip.x,
                'thumb_y': thumb_tip.y,
                'thumb_z': thumb_tip.z,
                'is_pinching': is_pinching,
                'pinch_distance': pinch_distance
            }
            
            is_pointing = detect_index_pointing(landmarks)
            is_fist = detect_fist(landmarks)
            
            if drawing_state == 'IDLE':
                if is_pointing:
                    drawing_state = 'DRAWING'
                    drawing_points = [(index_tip.x, index_tip.y)]
            
            elif drawing_state == 'DRAWING':
                if is_pointing:
                    drawing_points.append((index_tip.x, index_tip.y))
                    if len(drawing_points) > 200:
                        drawing_points = drawing_points[-200:]
                elif is_fist:
                    is_crescent, crescent_center = check_crescent_shape(drawing_points)
                    is_circle, circle_center = check_circle_shape(drawing_points)
                    
                    if is_crescent and crescent_center:
                        spawn_banana = {'x': crescent_center[0], 'y': crescent_center[1]}
                    elif is_circle and circle_center:
                        spawn_fruit = {'x': circle_center[0], 'y': circle_center[1]}
                    
                    drawing_points = []
                    drawing_state = 'IDLE'
            
            draw_hand_landmarks(frame, landmarks, h, w)
        else:
            if drawing_state == 'DRAWING' and len(drawing_points) > 10:
                is_circle, center = check_circle_shape(drawing_points)
                if is_circle and center:
                    spawn_fruit = {'x': center[0], 'y': center[1]}
            drawing_points = []
            drawing_state = 'IDLE'
    
    if face_landmarker:
        face_result = face_landmarker.detect(mp_image)
        
        if face_result.face_landmarks and len(face_result.face_landmarks) > 0:
            landmarks = face_result.face_landmarks[0]
            
            upper_lip = landmarks[13]
            lower_lip = landmarks[14]
            
            data['mouth'] = {
                'top_x': upper_lip.x,
                'top_y': upper_lip.y,
                'bottom_x': lower_lip.x,
                'bottom_y': lower_lip.y,
                'is_open': (lower_lip.y - upper_lip.y) > 0.02
            }
            
            lip_indices = [13, 14, 78, 308, 191, 80, 81, 82, 312, 311, 310, 415]
            for idx in lip_indices:
                if idx < len(landmarks):
                    pt = landmarks[idx]
                    cv2.circle(frame, (int(pt.x * w), int(pt.y * h)), 2, (0, 255, 0), -1)
    
    if len(drawing_points) > 1:
        for i in range(1, len(drawing_points)):
            pt1 = (int(drawing_points[i-1][0] * w), int(drawing_points[i-1][1] * h))
            pt2 = (int(drawing_points[i][0] * w), int(drawing_points[i][1] * h))
            cv2.line(frame, pt1, pt2, (255, 0, 255), 3)
    
    state_text = f"State: {drawing_state}"
    cv2.putText(frame, state_text, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
    
    return frame, data, spawn_fruit, spawn_banana

def camera_loop():
    global latest_frame, is_running
    
    time.sleep(2)
    
    initialize_mediapipe()
    
    cap = None
    for camera_idx in [0, 1, 2]:
        print(f"Trying camera index {camera_idx}...")
        test_cap = cv2.VideoCapture(camera_idx, cv2.CAP_DSHOW)
        if test_cap.isOpened():
            ret, test_frame = test_cap.read()
            if ret:
                cap = test_cap
                print(f"✅ Camera {camera_idx} opened successfully!")
                break
            test_cap.release()
    
    if cap is None or not cap.isOpened():
        print("❌ ERROR: Could not open camera! Please check:")
        print("  1. Close all browser tabs that might be using the camera")
        print("  2. Camera permissions are granted")
        print("  3. Camera is properly connected")
        is_running = False
        return
    
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    cap.set(cv2.CAP_PROP_FPS, 30)
    
    print("Camera started! Processing frames...")
    
    failed_reads = 0
    local_last_emit = 0
    
    while is_running:
        ret, frame = cap.read()
        if not ret:
            failed_reads += 1
            if failed_reads > 30:
                print("❌ Too many failed reads, stopping camera...")
                break
            time.sleep(0.1)
            continue
        
        failed_reads = 0
        
        processed_frame, data, spawn_fruit, spawn_banana = process_frame(frame)
        
        with frame_lock:
            latest_frame = processed_frame.copy()
        
        if connected_clients > 0:
            current_time = time.time()
            
            if current_time - local_last_emit >= 0.1:
                try:
                    socketio.emit('update_data', data, namespace='/')
                    local_last_emit = current_time
                except Exception as e:
                    pass
            
            if spawn_fruit:
                try:
                    fruit_data = {
                        'x': float(spawn_fruit['x']),
                        'y': float(spawn_fruit['y'])
                    }
                    socketio.emit('spawn_fruit', fruit_data, namespace='/')
                    print(f"🍎 Circle detected! Spawning fruit at: ({fruit_data['x']:.2f}, {fruit_data['y']:.2f})")
                except Exception as e:
                    pass
            
            if spawn_banana:
                try:
                    banana_data = {
                        'x': float(spawn_banana['x']),
                        'y': float(spawn_banana['y'])
                    }
                    socketio.emit('spawn_banana', banana_data, namespace='/')
                    print(f"🍌 Crescent detected! Spawning banana at: ({banana_data['x']:.2f}, {banana_data['y']:.2f})")
                except Exception as e:
                    pass
        
        time.sleep(0.05)
    
    cap.release()
    print("Camera stopped!")

def generate_frames():
    global latest_frame
    
    while is_running:
        with frame_lock:
            if latest_frame is None:
                time.sleep(0.1)
                continue
            frame = latest_frame.copy()
        
        ret, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
        if not ret:
            time.sleep(0.1)
            continue
        
        frame_bytes = buffer.tobytes()
        
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
        
        time.sleep(0.066)


@app.route('/')
def index():
    return render_template('index.html')

@app.route('/test')
def test():
    return render_template('test.html')

@app.route('/video_feed')
def video_feed():
    return Response(
        generate_frames(),
        mimetype='multipart/x-mixed-replace; boundary=frame'
    )


@socketio.on('connect')
def handle_connect():
    global connected_clients
    connected_clients += 1
    print(f'Client connected! Total clients: {connected_clients}')
    emit('connected', {'status': 'ok', 'message': 'Connected to AR Mukbang server'})

@socketio.on('disconnect')
def handle_disconnect():
    global connected_clients
    connected_clients = max(0, connected_clients - 1)
    print(f'Client disconnected! Total clients: {connected_clients}')

@socketio.on('eaten')
def handle_eaten(data):
    print(f"Fruit eaten! Data: {data}")


if __name__ == '__main__':
    print("Starting AR Mukbang server...")
    print("Open http://localhost:5000 in your browser")
    
    camera_thread = threading.Thread(target=camera_loop, daemon=True)
    camera_thread.start()
    
    socketio.run(app, host='0.0.0.0', port=5000, debug=False, use_reloader=False)
