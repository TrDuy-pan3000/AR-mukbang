# AR MUKBANG - Hướng dẫn khắc phục sự cố

## Vấn đề hiện tại

- Loading screen không biến mất
- Socket.IO không kết nối
- Không spawn được fruit

## Cách khắc phục

### Bước 1: Dừng tất cả tiến trình

```powershell
Get-Process python -ErrorAction SilentlyContinue | Stop-Process -Force
```

### Bước 2: Khởi động server

```powershell
cd "d:\Visual Code\Fruit"
.\venv\Scripts\python.exe app.py
```

### Bước 3: Mở browser NGOÀI (KHÔNG DÙNG Simple Browser)

- Mở Chrome hoặc Edge
- Vào: `http://localhost:5000`
- Nhấn F12 mở DevTools
- Vào tab Console

### Bước 4: Kiểm tra

Trong Console phải thấy:

```
🔌 Socket.IO initializing...
✅ Connected to AR Mukbang server
```

Trong Terminal phải thấy:

```
Client connected! Total clients: 1
```

### Bước 5: Test

1. Nhấn phím **D** -> phải xuất hiện quả táo màu đỏ
2. Giơ tay lên camera -> thấy skeleton màu xanh lá
3. Giơ ngón trỏ (các ngón khác nắm) -> vẽ vệt tím
4. Vẽ hình tròn -> nắm tay -> quả táo xuất hiện

## Nếu vẫn lỗi

Kiểm tra Console có lỗi gì không và gửi cho tôi.

## Port đang dùng

- Server: http://localhost:5000
- Video feed: http://localhost:5000/video_feed
- Test page: http://localhost:5000/test
