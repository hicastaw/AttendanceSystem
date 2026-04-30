import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import studentsRouter from './routes/students.js';
import attendanceRouter from './routes/attendance.js';
import lecturersRouter from './routes/lecturers.js';
import authRouter from './routes/auth.js';
import { attachActor } from './middleware/auth.js';
import { bootstrapAuthSystem } from './services/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-User-Role', 'X-Lecturer-Code', 'X-Student-Code'],
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(attachActor);

// Disable caching for all API responses to prevent polling issues
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  next();
});
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/students', studentsRouter);
app.use('/api/v1/attendance', attendanceRouter);
app.use('/api/v1/lecturers', lecturersRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'AttendanceSystem Backend', timestamp: new Date().toISOString() });
});

bootstrapAuthSystem()
  .then(() => {
    console.log('🔐 Auth bootstrap hoàn tất');
  })
  .catch((err) => {
    console.error('⚠️ Không thể bootstrap auth:', err.message);
  })
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`✅ Backend đang chạy tại http://localhost:${PORT}`);
      console.log(`📋 Health check: http://localhost:${PORT}/api/health`);
    });
  });
