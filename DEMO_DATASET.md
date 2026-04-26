# Bo du lieu demo quy mo lon

Bo du lieu nay duoc tao de chay va demo he thong diem danh voi quy mo lon hon ban truoc.

## Thanh phan
- 8 lop hoc
- 10 mon hoc
- 8 giang vien
- 160 sinh vien
- 108 sinh vien da co face profile
- 52 sinh vien chua co face profile
- 16 hoc phan
- 64 phien diem danh
  - 16 phien `submitted`
  - 16 phien `closed`
  - 16 phien `open`
  - 16 phien `draft`
- Ban ghi diem danh co du cac tinh huong:
  - `early`
  - `on_time`
  - `late`
  - `absent`
  - `manual_marked`
  - `unknown`
  - `blurry_rejected`

## Muc dich
- Demo Teacher Dashboard voi du lieu lon hon
- Demo thong ke theo nhieu lop va hoc phan
- Demo danh sach sinh vien da/chua co face profile
- Demo bao cao diem danh va export CSV
- Demo su khac nhau giua phien `open`, `closed`, `submitted`, `draft`

## File lien quan
- `backend/database/database/seeds/001_seed_demo.sql`
- `backend/database/docker-entrypoint-initdb.d/005_seed_demo.sql`
- `backend/database/database/scripts/reseed_demo.sql`

## Cach nap lai du lieu demo
Neu ban chay bang Docker tu dau:

```bash
docker compose down -v
docker compose up --build
```

Neu muon nap lai khi database dang chay:

```bash
docker compose exec postgres psql -U attendance_user -d attendance_db -f /docker-entrypoint-initdb.d/005_seed_demo.sql
```
