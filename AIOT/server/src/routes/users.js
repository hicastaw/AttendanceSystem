import express from 'express';
import axios from 'axios';
import FormData from 'form-data';
import db from '../db.js';
import { requireAdmin } from '../middleware/auth.js';
import { uploadMemory } from '../upload.js';
import {contract, contractJson, mode, normalizeEmbedding, sameContract} from '../runtime.js';
import {cpuTestScope} from '../cpu-test-scope.js';

const router = express.Router();
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8001';

// GET /api/users — danh sách người dùng + đã có hồ sơ khuôn mặt hay chưa
router.get('/', requireAdmin, (req, res) => {
  // The isolated worker consumes only its active candidate contract; a legacy
  // profile or another candidate contract cannot satisfy enrollment status.
  const rows = cpuTestScope ? db.prepare(`
    SELECT
      u.user_id, u.user_code, u.full_name, u.email, u.status, u.created_at,
      CASE WHEN fp.user_id IS NOT NULL THEN 1 ELSE 0 END AS has_face_profile,
      NULL AS face_updated_at
    FROM users u
    LEFT JOIN candidate_profiles fp ON fp.user_id = u.user_id AND fp.contract_id = ?
    ORDER BY u.user_code
  `).all(cpuTestScope.active.contract_id) : db.prepare(`
    SELECT
      u.user_id, u.user_code, u.full_name, u.email, u.status, u.created_at,
      CASE WHEN fp.user_id IS NOT NULL THEN 1 ELSE 0 END AS has_face_profile,
      fp.updated_at AS face_updated_at
    FROM users u
    LEFT JOIN face_profiles fp ON fp.user_id = u.user_id
    ORDER BY u.user_code
  `).all();
  res.json({ status: 'success', data: rows });
});

// POST /api/users — tạo người dùng mới (chưa có khuôn mặt)
router.post('/', requireAdmin, (req, res) => {
  const { user_code, full_name, email } = req.body || {};
  if (typeof user_code!=='string' || !/^[A-Z0-9_-]{1,64}$/i.test(user_code.trim()) ||
      typeof full_name!=='string' || !full_name.trim() || full_name.length>200 ||
      (email != null && (typeof email!=='string' || email.length>254))) {
    return res.status(400).json({ status: 'error', code:'invalid_member', message: 'Thiếu hoặc không hợp lệ user_code/full_name.' });
  }
  const canonicalCode=user_code.trim().toUpperCase(),canonicalName=full_name.trim().replace(/\s+/gu,' ');
  try {
    const info = db.prepare(`
      INSERT INTO users (user_code, full_name, email) VALUES (?, ?, ?)
    `).run(canonicalCode, canonicalName, email || null);
    res.status(201).json({ status: 'success', data: { user_id: info.lastInsertRowid,user_code:canonicalCode,
      full_name:canonicalName,status:'active',has_face_profile:0 } });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ status: 'error',code:'duplicate_member_code', message: `user_code ${canonicalCode} đã tồn tại.` });
    }
    res.status(500).json({ status: 'error', message: err.message });
  }
});

router.patch('/:code',requireAdmin,(req,res)=> {
  const {full_name,email,status}=req.body || {};
  if ((full_name !== undefined && (typeof full_name!=='string'||!full_name.trim()||full_name.length>200)) ||
      (email !== undefined && email !== null && (typeof email!=='string'||email.length>254)) ||
      (status !== undefined && !['active','inactive'].includes(status))) return res.status(400).json({status:'error',message:'Thông tin thành viên không hợp lệ.'});
  const user=db.prepare('SELECT * FROM users WHERE user_code=?').get(req.params.code.trim().toUpperCase());
  if (!user) return res.status(404).json({status:'error',message:'Không tìm thấy thành viên.'});
  db.prepare('UPDATE users SET full_name=?,email=?,status=? WHERE user_id=?')
    .run(full_name?.trim() ?? user.full_name,email===undefined?user.email:email,status ?? user.status,user.user_id);
  res.json({status:'success'});
});

// Synthetic enrollment is explicit, authenticated, isolated, and never calls a model.
router.post('/:code/mock-face',requireAdmin,(req,res)=> {
  if (mode!=='mock') return res.sendStatus(404);
  const user=db.prepare('SELECT user_id FROM users WHERE user_code=? AND status=\'active\'').get(req.params.code.trim().toUpperCase());
  if (!user) return res.status(404).json({status:'error',message:'Không tìm thấy thành viên đang hoạt động.'});
  const embedding=Array(512).fill(0); embedding[(user.user_id-1)%511]=1;
  db.prepare(`INSERT INTO face_profiles(user_id,embedding,embedding_contract,quality_score) VALUES (?,?,?,NULL)
    ON CONFLICT(user_id) DO UPDATE SET embedding=excluded.embedding,embedding_contract=excluded.embedding_contract,quality_score=NULL,
      updated_at=strftime('%Y-%m-%dT%H:%M:%S','now')`).run(user.user_id,JSON.stringify(embedding),contractJson);
  res.json({status:'success',mode,embedding_contract:contract,message:'Đã lưu hồ sơ mô phỏng, không phải khuôn mặt thật.'});
});

// POST /api/users/:code/face — upload ảnh, validate qua AI Service, lưu embedding
router.post('/:code/face', requireAdmin, uploadMemory.single('face_image'), async (req, res) => {
  if (cpuTestScope) return res.status(409).json({status:'error',message:'Đăng ký R50: mở /r50-capture.html, chọn thành viên, lấy 3–8 mẫu từ camera và xác nhận lưu.'});
  if (mode==='mock') return res.status(409).json({status:'error',message:'Mock chỉ dùng hồ sơ mô phỏng.'});
  if (!req.file) {
    return res.status(400).json({ status: 'error', message: 'Thiếu file ảnh.' });
  }
  const code = String(req.params.code).trim().toUpperCase();
  const user = db.prepare('SELECT user_id FROM users WHERE user_code = ?').get(code);
  if (!user) {
    return res.status(404).json({ status: 'error', message: `Không tìm thấy người dùng ${code}.` });
  }

  try {
    const form = new FormData();
    form.append('face_image', req.file.buffer, {
      filename: req.file.originalname || 'face.jpg',
      contentType: req.file.mimetype,
    });

    const aiResponse = await axios.post(`${AI_SERVICE_URL}/ai/face/validate`, form, {
      headers: form.getHeaders(),
      timeout: 30000,
      maxRedirects: 0,
      maxContentLength: 1024*1024,
    });
    const aiData = aiResponse.data;

    if (!aiData.is_valid) {
      return res.status(400).json({
        status: 'error',
        code: aiData.error_code,
        message: aiData.message,
        sharpness_score: aiData.sharpness_score,
      });
    }
    if (!sameContract(aiData.embedding_contract)) return res.status(409).json({status:'error',message:'Model contract không tương thích. Chưa lưu hồ sơ.'});
    const embeddingJson = JSON.stringify(normalizeEmbedding(aiData.embedding));
    db.prepare(`
      INSERT INTO face_profiles (user_id, embedding, quality_score, embedding_contract, updated_at)
      VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime'))
      ON CONFLICT(user_id) DO UPDATE SET
        embedding = excluded.embedding,
        quality_score = excluded.quality_score,
        embedding_contract = excluded.embedding_contract,
        updated_at = excluded.updated_at
    `).run(user.user_id, embeddingJson, aiData.sharpness_score || null, contractJson);

    res.json({
      status: 'success',
      message: 'Đã đăng ký khuôn mặt thành công.',
      data: { sharpness_score: aiData.sharpness_score },
    });
  } catch (err) {
    console.error('Enrollment failed:',err.code || 'invalid_response');
    res.status(503).json({ status: 'error', message: 'Chưa lưu hồ sơ: AI Service hoặc cơ sở dữ liệu chưa sẵn sàng.' });
  }
});

export default router;
