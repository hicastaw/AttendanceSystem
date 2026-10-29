import express from 'express';
import db from '../db.js';
import {requireAdmin} from '../middleware/auth.js';
import {cpuTestScope} from '../cpu-test-scope.js';
import {attendanceSummary} from '../lab-attendance-store.js';

const router = express.Router();
router.get('/lab-attendance', (req,res,next) => cpuTestScope?.purpose === 'isolated-r50-laptop-test'
  ? next() : res.sendStatus(404), requireAdmin, (req,res) => {
  const week = req.query.week;
  const month = req.query.month;
  if (typeof week !== 'string' || typeof month !== 'string') {
    return res.status(400).json({status:'error',message:'Cần week=YYYY-MM-DD và month=YYYY-MM.'});
  }
  try {
    return res.json({status:'success',...attendanceSummary(db,{week,month})});
  } catch {
    return res.status(400).json({status:'error',message:'Khoảng tuần hoặc tháng không hợp lệ.'});
  }
});

export default router;
