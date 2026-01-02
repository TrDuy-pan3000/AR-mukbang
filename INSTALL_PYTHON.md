# Hướng dẫn cài đặt Python 3.11 cho AR Mukbang

## Vấn đề hiện tại

- Python 3.14 không tương thích với MediaPipe
- Lỗi: `AttributeError: function 'free' not found`
- Không thể nhận diện tay/mặt

## Giải pháp

### Bước 1: Tải Python 3.11

1. Mở: https://www.python.org/downloads/release/python-3118/
2. Tải: **Windows installer (64-bit)** - python-3.11.8-amd64.exe
3. Chạy installer:
   - ✅ Chọn "Add Python 3.11 to PATH"
   - Chọn "Customize installation"
   - Chọn đường dẫn: `C:\Python311` (để dễ tìm)

### Bước 2: Tạo lại Virtual Environment

```powershell
# Xóa venv cũ
cd "d:\Visual Code\Fruit"
Remove-Item -Recurse -Force .venv

# Tạo venv mới với Python 3.11
C:\Python311\python.exe -m venv .venv

# Kích hoạt
.\.venv\Scripts\Activate.ps1

# Cài đặt packages
pip install flask flask-socketio opencv-python mediapipe numpy trimesh
```

### Bước 3: Chạy server

```powershell
cd "d:\Visual Code\Fruit"
.\.venv\Scripts\Activate.ps1
python app.py
```

## Kiểm tra hoạt động

1. Mở http://localhost:5000
2. Cho phép camera
3. Thử các gesture:
   - **Vẽ hình TRÒN** → spawn táo 🍎
   - **Vẽ hình BÁN NGUYỆT** (hình C dài) → spawn chuối 🍌
   - **Chụm ngón tay** (pinch) → cầm trái cây
   - **Đưa vào miệng** → ăn và tạo bite mark

## Lưu ý về gesture

- Chỉ trỏ ngón trỏ ra để vẽ
- Nắm tay lại để kết thúc vẽ và detect shape
- Vẽ BÁN NGUYỆT trước sẽ ra chuối (ưu tiên hơn táo)
