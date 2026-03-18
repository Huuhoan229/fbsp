# 🛍 Shopee Affiliate Tool — Hướng dẫn Deploy lên Vercel

## Cấu trúc project
```
shopee-affiliate/
├── api/
│   └── generate.js      ← Backend serverless (xử lý link)
├── public/
│   └── index.html       ← Giao diện website
├── vercel.json          ← Cấu hình Vercel
├── package.json
└── DEPLOY.md            ← File này
```

---

## Bước 1 — Tạo tài khoản Vercel
1. Vào https://vercel.com → Đăng ký bằng GitHub (miễn phí)

---

## Bước 2 — Cài Vercel CLI (chọn 1 trong 2 cách)

**Cách A — Dùng GitHub (dễ nhất, không cần terminal):**
1. Tạo repo trên GitHub, upload toàn bộ thư mục này lên
2. Vào https://vercel.com/new → Import repo đó → Deploy

**Cách B — Dùng terminal:**
```bash
npm install -g vercel
cd shopee-affiliate
vercel login
vercel --prod
```

---

## Bước 3 — Thiết lập Environment Variable
Sau khi deploy, vào **Vercel Dashboard → Project → Settings → Environment Variables**:

| Key            | Value           |
|----------------|-----------------|
| `AFFILIATE_ID` | `17359570151`   |

→ Nhấn **Save** → Vào **Deployments** → **Redeploy**

---

## Bước 4 — Xong! 🎉
Vercel sẽ cấp cho bạn một domain dạng:
`https://shopee-affiliate-xxx.vercel.app`

Bạn có thể dùng domain tùy chỉnh (miễn phí) trong Settings → Domains.

---

## Cách hoạt động

```
User nhập link
     ↓
[Nếu là shope.ee] → Server follow redirect → Lấy URL đầy đủ
     ↓
Trích xuất shopid + itemid
     ↓
Gọi Shopee API → Lấy tên, giá, ảnh sản phẩm
     ↓
Gắn affiliate ID vào URL → Trả về link hoàn chỉnh
```

---

## Muốn đổi Affiliate ID?
Sửa trong `vercel.json`:
```json
"env": {
  "AFFILIATE_ID": "ID_CỦA_BẠN"
}
```
Hoặc sửa trực tiếp trên Vercel Dashboard → Environment Variables.

---

## Lưu ý quan trọng
- Link affiliate được tạo theo format chuẩn của chương trình Shopee Affiliate
- Để đảm bảo hoa hồng được ghi nhận đúng, hãy kiểm tra với nền tảng affiliate bạn đang dùng
- Tool hoàn toàn miễn phí, không giới hạn lượt tạo link trên Vercel free tier
