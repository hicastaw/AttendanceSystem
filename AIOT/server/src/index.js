import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import authRouter from './routes/auth.js';
import usersRouter from './routes/users.js';
import accessEventsRouter from './routes/access-events.js';
import scheduledEventsRouter from './routes/scheduled-events.js';
import kioskRouter from './routes/kiosk.js';
import captureRouter from './routes/capture.js';
import cpuTestRouter from './routes/cpu-test.js';
import labAttendanceRouter from './routes/lab-attendance.js';
import {mode} from './runtime.js';

// Đảm bảo file DB + schema được tạo trước khi routes dùng tới.
import db from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.disable('x-powered-by');
app.set('query parser','simple');
app.use(cors({origin:false}));
app.use((req,res,next)=> {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control','no-store');
  next();
});
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'AIOT Lab Access Server', mode, timestamp: new Date().toISOString() });
});
app.get('/api/ready',(_req,res)=> {
  try {
    db.prepare('SELECT count(*) FROM users').get();
    res.json({status:'ready',scope:'database',mode,database:true});
  } catch {res.status(503).json({status:'unavailable',database:false});}
});

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/users/:code/capture',captureRouter);
app.use('/api/cpu-test',cpuTestRouter);
app.use('/api',labAttendanceRouter);
app.use('/api', accessEventsRouter); // /api/access-events, /api/last-state, /api/face-data
app.use('/api', scheduledEventsRouter);
app.use('/api', kioskRouter);

// Trang quản lý tĩnh (đăng nhập, đăng ký khuôn mặt, xem log) — 1 process duy nhất
// phục vụ cả API lẫn giao diện, không cần build tool/dev server riêng cho frontend.
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((error,_req,res,_next)=> {
  const status=error.code==='LIMIT_FILE_SIZE'?413:error.name==='MulterError'?400:(error.status>=400 && error.status<500?error.status:500);
  console.error('Request failed:',error.code || status);
  res.status(status).json({status:'error',message:status===500?'Lỗi dịch vụ.':status===413?'Ảnh quá lớn.': 'Dữ liệu yêu cầu không hợp lệ.'});
});
const server=app.listen(PORT, process.env.HOST || '127.0.0.1', () => {
  console.log(`✅ AIOT Lab Access Server: http://localhost:${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/api/health`);
  // Test fixtures use OS-assigned port 0 and IPC, avoiding probe/rebind races.
  process.send?.({type:'aiot-listening',port:server.address().port});
});
let stopping=false;
function shutdown() {
  if(stopping)return;stopping=true;
  const force=setTimeout(()=>server.closeAllConnections(),10000);force.unref();
  server.close(()=> {clearTimeout(force);db.close();process.exit(0);});
  server.closeIdleConnections();
}
process.on('SIGTERM',shutdown);
process.on('SIGINT',shutdown);
