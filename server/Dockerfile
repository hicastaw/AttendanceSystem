# Image "web": build frontend (React/Vite) rồi chạy backend Express phục vụ cả
# API lẫn bản build giao diện trên 1 port. Build context là thư mục server/.
# Layout trong image giữ đúng như repo (/app/backend, /app/frontend/dist) vì
# backend/src/index.js tìm giao diện ở ../../frontend/dist.

# --- 1. Build frontend ---
FROM node:22-bookworm-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- 2. Cài dependency backend (better-sqlite3 là native module, cần toolchain
#        nếu không tải được bản prebuilt) ---
FROM node:22-bookworm-slim AS backend-deps
WORKDIR /app/backend
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

# --- 3. Runtime ---
FROM node:22-bookworm-slim
# tzdata: schema.sql dùng strftime(..., 'localtime') nên container cần đúng múi giờ.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tzdata \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    TZ=Asia/Ho_Chi_Minh \
    PORT=3001 \
    DB_DIR=/app/backend/data

WORKDIR /app/backend
COPY --from=backend-deps /app/backend/node_modules ./node_modules
COPY backend/ ./
COPY --from=frontend /app/frontend/dist /app/frontend/dist

RUN mkdir -p /app/backend/data && chown -R node:node /app/backend/data
USER node

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
