# Psyche Backend — API Documentation

Dokumentasi ini menjelaskan endpoint yang tersedia di backend (Express) beserta format request/response dan contoh pemakaian.

## Base URL
- Local: `http://localhost:3000`
- Production (contoh dari repo): `https://psyche-backend-plum.vercel.app`

## Format Umum
- Request body umumnya **JSON**
- Header yang dipakai:
  - `Content-Type: application/json`

## Bentuk Error Umum
1) Validasi (`express-validator`) biasanya mengembalikan:
```json
{ "errors": [ { "type": "field", "msg": "...", "path": "fieldName", "location": "body" } ] }
```
2) Error lain biasanya:
```json
{ "message": "..." }
```
atau
```json
{ "error": "..." }
```

## Environment Variables (digunakan oleh server)
Auth (email & JWT):
- `EMAIL_USER` (Email pengirim)
- `EMAIL_PASS` (App password / credential Email)
- `JWT_SECRET` (default: `dev-secret`)
- `BASE_URL` (dipakai untuk membuat link verifikasi email; default `http://localhost:3000`)

AI / ML:
- `GEMINI_API_KEY` (wajib untuk Gemini)
- `GEMINI_MODEL` (default: `gemini-3-flash-preview`)

---

# 1) Auth API (`/auth`)

## 1.1 Register
**POST** `/auth/register`

Membuat user baru dan mengirim email verifikasi.

### Body
```json
{
  "username": "string (required)",
  "email": "string email (required)",
  "password": "string min 6 (required)"
}
```

### Response
- **201**
```json
{
  "message": "User created. Please check your email to verify your account.",
  "userId": 1
}
```

### Error yang mungkin
- **400** validasi / email sudah dipakai
- **500** registrasi gagal

### Contoh
```http
POST {{BASE_URL}}/auth/register
Content-Type: application/json

{
  "username": "budi",
  "email": "budi@example.com",
  "password": "secret123"
}
```

---

## 1.2 Verify Email (via link)
**GET** `/auth/verify-email?code=...`

Endpoint ini dibuka dari link email verifikasi. Response berupa **HTML** (bukan JSON).

### Query
- `code`: string base64 dari format `email:token`

### Response
- **200** HTML sukses
- **400/404/500** HTML error

---

## 1.3 Login
**POST** `/auth/login`

Login user. User harus sudah terverifikasi (`isVerified = true`).

### Body
```json
{
  "email": "string email (required)",
  "password": "string (required)"
}
```

### Response
- **200**
```json
{
  "message": "Logged in successfully",
  "email": "user@example.com",
  "username": "budi",
  "userId": 1,
  "token": "<jwt>"
}
```

### Error yang mungkin
- **401** email tidak valid / password salah
- **403** akun belum diverifikasi
- **400** validasi
- **500** login gagal

### Contoh
```http
POST {{BASE_URL}}/auth/login
Content-Type: application/json

{
  "email": "budi@example.com",
  "password": "secret123"
}
```

---

## 1.4 Forgot Password (kirim OTP)
**POST** `/auth/forgot-password`

Mengirim OTP 4 karakter ke email user (berlaku ~15 menit, mengikuti waktu Jakarta di kode).

### Body
```json
{
  "email": "string email (required)"
}
```

### Response
- **200**
```json
{ "message": "OTP has been sent to your email." }
```

### Error yang mungkin
- **404** user tidak ditemukan
- **400** validasi
- **500** gagal memproses

### Contoh (sesuai `test.http` di repo)
```http
POST https://psyche-backend-plum.vercel.app/auth/forgot-password
Content-Type: application/json

{
  "email": "dhikifauzan97@gmail.com"
}
```

---

## 1.5 Verify OTP
**POST** `/auth/verify-otp`

Verifikasi OTP (misalnya sebelum reset password).

### Body
```json
{
  "email": "string email (required)",
  "otp": "string 4 karakter (required)"
}
```

Catatan: OTP akan di-trim spasi oleh sanitizer.

### Response
- **200**
```json
{ "message": "OTP verified successfully." }
```

### Error yang mungkin
- **400** OTP invalid / OTP expired / validasi
- **404** user tidak ditemukan
- **500** gagal verifikasi

### Contoh
```http
POST {{BASE_URL}}/auth/verify-otp
Content-Type: application/json

{
  "email": "budi@example.com",
  "otp": "A1B2"
}
```

---

## 1.6 Change Password (Change / Reset)
**POST** `/auth/change-password`

Bisa dipakai untuk:
- **Change password** (pakai `oldPassword`)
- **Reset password** (pakai `otp` dari forgot-password)

### Body
Wajib:
- `email` (valid email)
- `newPassword` (min 6)

Lalu pilih salah satu:
- `oldPassword` **atau** `otp`

Contoh (change password dengan old password):
```json
{
  "email": "budi@example.com",
  "oldPassword": "secret123",
  "newPassword": "secret456"
}
```

Contoh (reset password dengan OTP):
```json
{
  "email": "budi@example.com",
  "otp": "A1B2",
  "newPassword": "secret456"
}
```

### Response
- **200**
```json
{ "message": "Password updated successfully." }
```

### Error yang mungkin
- **400** validasi / OTP invalid / OTP expired / tidak mengirim `oldPassword` maupun `otp`
- **401** old password salah
- **404** user tidak ditemukan
- **500** gagal update

---

# 2) Mental Health API (`/mental-health`)

## Authentication (JWT)
Endpoint di modul Mental Health di bawah ini membutuhkan header:
- `Authorization: Bearer <token>`

## Field Skor yang Wajib
Semua field ini wajib di body (integer 1–6):
- `appetite`
- `interest`
- `fatigue`
- `worthlessness`
- `concentration`
- `agitation`
- `suicidalIdeation`
- `sleepDisturbance`
- `aggression`
- `panicAttacks`
- `hopelessness`
- `restlessness`

Tambahan:
- `userId` (int > 0)
- `language` (optional: `en` atau `id`, default `en`)

---

## 2.1 Predict Depression
**POST** `/mental-health/predict`

### Auth
Wajib JWT:
- `Authorization: Bearer <token>`

Catatan: `userId` di body harus sama dengan user id di token. Kalau tidak, akan **403 Forbidden**.

Melakukan prediksi menggunakan model TFJS lokal (`api/tfjs_model`) dan membuat saran menggunakan Gemini. Hasilnya juga disimpan ke database (`healthTest`).

### Body
```json
{
  "userId": 1,
  "language": "id",
  "appetite": 1,
  "interest": 2,
  "fatigue": 3,
  "worthlessness": 4,
  "concentration": 5,
  "agitation": 2,
  "suicidalIdeation": 6,
  "sleepDisturbance": 1,
  "aggression": 1,
  "panicAttacks": 2,
  "hopelessness": 3,
  "restlessness": 4
}
```

### Response
- **201**
```json
{
  "message": "Depression state predicted and recorded successfully.",
  "depressionState": 2,
  "suggestion": "...",
  "data": {
    "id": 123,
    "userId": 1,
    "depressionState": 2,
    "generatedSuggestion": "...",
    "language": "id"
  }
}
```

### Error yang mungkin
- **400** validasi body / ada field skor yang missing / skor di luar range
- **500** model ML gagal load atau gagal prediksi
- **400** Prisma foreign key (userId tidak ada): `Invalid userId. User does not exist.`

---

## 2.2 Get Test History by User
**GET** `/mental-health/history/:userId`

### Auth
Wajib JWT:
- `Authorization: Bearer <token>`

Catatan: `:userId` harus sama dengan user id di token. Kalau tidak, akan **403 Forbidden**.

### Path Param
- `userId` (int > 0)

### Response
- **200**
```json
{
  "message": "Test history retrieved successfully.",
  "data": [
    {
      "id": 123,
      "userId": 1,
      "depressionState": 2,
      "generatedSuggestion": "...",
      "healthTestDate": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

Jika belum ada history:
- **200**
```json
{ "message": "No test history found for this user.", "data": [] }
```

### Error yang mungkin
- **400** validasi param
- **404** user tidak ditemukan
- **500** gagal ambil data

---

## 2.3 Get Latest Test History by User
**GET** `/mental-health/latest-history/:userId`

### Auth
Wajib JWT:
- `Authorization: Bearer <token>`

Catatan: `:userId` harus sama dengan user id di token. Kalau tidak, akan **403 Forbidden**.

### Path Param
- `userId` (int > 0)

### Response
Jika ada data:
- **200**
```json
{
  "message": "Latest test history retrieved successfully.",
  "data": {
    "id": 123,
    "userId": 1
  }
}
```

Jika tidak ada data:
- **200**
```json
{ "message": "No test history found for this user.", "data": null }
```

### Error yang mungkin
- **400** validasi param
- **404** user tidak ditemukan
- **500** gagal ambil data

---

# 3) Chatbot API (`/chatbot`)

Catatan: endpoint chatbot memanggil Gemini untuk membuat respons. Pastikan `GEMINI_API_KEY` tersedia.

## Authentication (JWT)
Endpoint berikut membutuhkan header:
- `Authorization: Bearer <token>`

Token bisa didapat dari `POST /auth/login`.

## 3.1 Chat
**POST** `/chatbot/chat`

Mengirim pesan ke chatbot. Jika `sessionId` tidak dikirim, server membuat session baru dan akan membuat judul otomatis dari pesan pertama.

### Body
```json
{
  "userId": 1,
  "message": "string (required)",
  "latitude": -6.2,
  "longitude": 106.8,
  "sessionId": 10
}
```

Keterangan:
- `userId` (required)
- `message` (required)
- `sessionId` (optional) untuk melanjutkan percakapan
- `latitude`, `longitude` (optional) untuk konteks lokasi jika user minta rekomendasi layanan di sekitar

### Response
- **200**
```json
{
  "response": "...jawaban model...",
  "sessionId": 10,
  "title": "..."
}
```

### Error yang mungkin
- **400** jika `userId` atau `message` kosong
- **404** session tidak ditemukan / akses ditolak (jika `sessionId` bukan milik `userId`)
- **500** gagal proses request (Gemini/DB error)

---

## 3.2 Get Chat History
**GET** `/chatbot/history/:userId`

Mengambil daftar session percakapan user. Urutan: pinned dulu, lalu yang terbaru (`updatedAt desc`).

### Auth
Wajib JWT:
- `Authorization: Bearer <token>`

Catatan: `:userId` harus sama dengan user id di token. Kalau tidak, akan **403 Forbidden**.

### Path Param
- `userId` (required)

### Response
- **200** array
```json
[
  {
    "id": 10,
    "title": "New Conversation",
    "updatedAt": "2026-01-01T00:00:00.000Z",
    "isPinned": false,
    "preview": "...last message..."
  }
]
```

### Error yang mungkin
- **401** missing/invalid token
- **403** userId param != userId di token
- **500** gagal fetch

Contoh:
```http
GET {{BASE_URL}}/chatbot/history/1
Authorization: Bearer {{TOKEN}}
```

---

## 3.3 Toggle Pin Session
**PUT** `/chatbot/session/:sessionId/pin`

Toggle pin/unpin. Maksimum pinned session per user: **5**.

### Auth
Wajib JWT:
- `Authorization: Bearer <token>`

### Path Param
- `sessionId` (required)

### Body
Tidak perlu body (boleh kosong):
```json
{}
```

### Response
- **200**
```json
{ "message": "Session pinned", "isPinned": true }
```
atau
```json
{ "message": "Session unpinned", "isPinned": false }
```

### Error yang mungkin
- **401** missing/invalid token
- **404** session tidak ditemukan / bukan milik user
- **400** pinned sudah 5
- **500** gagal toggle

Contoh:
```http
PUT {{BASE_URL}}/chatbot/session/10/pin
Authorization: Bearer {{TOKEN}}
Content-Type: application/json

{}
```

---

# Quick Test (JetBrains HTTP Client)
Kamu bisa pakai file `test.http` yang sudah ada, atau buat request sesuai contoh di atas.

Kalau mau pakai variabel base URL, contoh:
```http
@BASE_URL = http://localhost:3000

### Login
POST {{BASE_URL}}/auth/login
Content-Type: application/json

{
  "email": "budi@example.com",
  "password": "secret123"
}
```
