# FB Auto Ảnh + Caption

Mở hộp **Tạo bài viết** trên Facebook → tự điền 1 ảnh + 1 caption ngẫu nhiên, không trùng. **Không tự bấm Đăng.**

## Cài đặt
1. Bấm **Code → Download ZIP**, giải nén, để thư mục ở chỗ cố định (đừng xóa).
2. Vào `chrome://extensions` → bật **Developer mode** → **Load unpacked** → chọn thư mục vừa giải nén.
3. Bấm **Details** của extension → bật **Allow access to file URLs** (bắt buộc).
4. Bấm vào icon extension 1 lần → tự tạo thư mục `Downloads/fb-anh` có sẵn `captions.txt`.

## Dùng
- Chép ảnh vào `Downloads/fb-anh`, sửa `captions.txt` (**mỗi dòng 1 caption**).
- Vào Facebook → bấm "Bạn đang nghĩ gì?" → tự có ảnh + caption → kiểm tra rồi bấm **Đăng**.
- Ảnh ghép nhiều khung được tự cắt thành từng ô; mỗi bài lấy 2 ô (ưu tiên cùng 1 ảnh ghép), không trùng.
- Đã đăng thì ghi vào `Downloads/fb-anh/da-dang/` → mọi profile trên máy không đăng lại. Xóa file trong đó để dùng lại.
- Nhiều profile mở hộp tạo bài cùng lúc: ảnh + caption vừa điền được giữ chỗ trong `fb-anh/giu-cho/` (tự xóa khi đăng xong / đóng hộp, tự hết hạn sau 10 phút) → các profile không lấy trùng nhau.

## Tùy chỉnh (`settings.json` trong thư mục extension)
- `"delaySeconds": 2` — mở hộp tạo bài xong chờ bao nhiêu giây mới điền (có đếm ngược + nút Hủy). `0` = điền ngay.
- `"imagesPerPost": 2` — số ảnh mỗi bài (1–10).
- `"splitCollage": false` — không cắt ảnh ghép.
- Sửa xong bấm ↻ Reload extension.

## Cập nhật bản mới
Tải ZIP mới, chép đè vào thư mục cũ → vào `chrome://extensions` bấm **↻ (Reload)** của extension.

## Lỗi hay gặp
- Bấm "Bạn đang nghĩ gì?" mà không thấy gì → bấm ↻ Reload extension rồi **F5 trang Facebook**. Nhận được hộp tạo bài thì sẽ hiện chữ "FB Auto Ảnh: đang lấy ảnh…" ở cuối màn hình.
- Không đọc được ảnh → chưa bật **Allow access to file URLs**.
- Hiện hộp **lưu file README.txt** / không ghi được `da-dang` → Chrome đang bật "Hỏi vị trí lưu từng tệp trước khi tải xuống". Vào `chrome://settings/downloads` **tắt** mục đó rồi bấm icon extension.
