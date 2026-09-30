# Bank Van Hung Bian – Android App

Ứng dụng Android (Java) bọc WebView, giữ **đầy đủ tính năng** của bản web:

- Đăng nhập / Đăng ký Email + Google (Firebase Auth)
- Realtime Database
- Upload & Deep-merge JSON
- Tree view ảo hoá (virtual scroll)
- Tìm kiếm & bộ lọc nâng cao (key/value, contains/exact/regex, kiểu dữ liệu, phân trang)
- Popup chi tiết node + tìm trong node + copy JSON

Giao diện đã tối ưu mobile (viewport, responsive CSS).

## Yêu cầu

- Android Studio Hedgehog (2023.1.1) trở lên hoặc JDK 17
- minSdk 24 / targetSdk 34

## Cấu trúc dự án

```
BankVanHungBianAndroid/
├── app/
│   ├── build.gradle
│   ├── src/main/
│   │   ├── AndroidManifest.xml
│   │   ├── java/com/bankvanhungbian/app/MainActivity.java
│   │   ├── assets/          ← toàn bộ HTML/CSS/JS gốc
│   │   └── res/
├── build.gradle
├── settings.gradle
├── gradle.properties
└── .github/workflows/build-apk.yml
```

## Build trên máy local

```bash
# Clone repo
git clone <your-repo-url>
cd BankVanHungBianAndroid

# Tạo Gradle Wrapper (nếu chưa có)
gradle wrapper --gradle-version 8.2.1

# Build debug APK
./gradlew assembleDebug

# APK nằm tại:
# app/build/outputs/apk/debug/app-debug.apk
```

Hoặc mở bằng **Android Studio** → Run / Build APK.

## Build tự động trên GitHub Actions

1. Push code lên GitHub (branch `main` hoặc `master`)
2. Vào tab **Actions** → workflow **Build APK** sẽ chạy
3. Tải APK từ mục **Artifacts** (BankVanHungBian-debug)

Có thể kích hoạt thủ công bằng **workflow_dispatch**.

## Lưu ý quan trọng

1. **Firebase config** nằm trong `app/src/main/assets/app.js` (đã copy từ bản web).  
   Nếu cần đổi project Firebase, sửa trực tiếp file đó.

2. **Google Sign-In trong WebView**:  
   Trên một số thiết bị Google có thể chặn đăng nhập trong WebView.  
   Nếu gặp lỗi, người dùng có thể dùng đăng nhập Email/Password.

3. **Upload file JSON**:  
   WebView đã hỗ trợ `input[type=file]` qua `onShowFileChooser`.

4. **Nút Back**:  
   - Đóng popup chi tiết nếu đang mở  
   - Quay lại lịch sử WebView  
   - Thoát app

## Giấy phép

Dự án nội bộ – Bank Van Hung Bian.
