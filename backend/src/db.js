import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'attendance_db',
  user: process.env.DB_USER || 'attendance_user',
  password: process.env.DB_PASSWORD || 'attendance_pass',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('connect', (client) => {
  client.query("SET TIME ZONE 'Asia/Ho_Chi_Minh'");
});

pool.on('error', (err) => {
  console.error('❌ Lỗi kết nối PostgreSQL:', err.message);
});

pool.connect().then(() => {
  console.log('✅ Kết nối PostgreSQL thành công');
}).catch((err) => {
  console.error('❌ Không thể kết nối PostgreSQL:', err.message);
});

export default pool;
