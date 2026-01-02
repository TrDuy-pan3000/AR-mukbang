import mediapipe as mp
from mediapipe.tasks import python as mp_tasks
from mediapipe.tasks.python import vision

print("✓ MediaPipe import OK")

try:
    hand_landmarker = vision.HandLandmarker.create_from_options(
        vision.HandLandmarkerOptions(
            base_options=mp_tasks.BaseOptions(model_asset_path='models/hand_landmarker.task'),
            num_hands=2
        )
    )
    print("✓ Hand landmarker created")
except Exception as e:
    print(f"✗ Hand landmarker error: {e}")

try:
    face_landmarker = vision.FaceLandmarker.create_from_options(
        vision.FaceLandmarkerOptions(
            base_options=mp_tasks.BaseOptions(model_asset_path='models/face_landmarker.task'),
            output_face_blendshapes=False,
            output_facial_transformation_matrixes=False,
            num_faces=1
        )
    )
    print("✓ Face landmarker created")
except Exception as e:
    print(f"✗ Face landmarker error: {e}")

print("All OK!")
