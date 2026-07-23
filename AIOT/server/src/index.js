import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import authRouter from './routes/auth.js';
import usersRouter from './routes/users.js';
import accessEventsRouter from './routes/access-events.js';

// Đảm bảo file DB + schema được tạo trước khi routes dùng tới.
import './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'AIOT Lab Access Server', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api', accessEventsRouter); // /api/access-events, /api/last-state, /api/face-data

// Trang quản lý tĩnh (đăng nhập, đăng ký khuôn mặt, xem log) — 1 process duy nhất
// phục vụ cả API lẫn giao diện, không cần build tool/dev server riêng cho frontend.
app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, () => {
  console.log(`✅ AIOT Lab Access Server: http://localhost:${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/api/health`);
});
