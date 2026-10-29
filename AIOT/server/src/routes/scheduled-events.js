import express from 'express';
import crypto from 'node:crypto';
import db from '../db.js';
import {requireAdmin, requireDeviceKey} from '../middleware/auth.js';
import {validateSchedule, overlap, validDay} from '../attendance-schedule.js';

export const listEvents = () => db.prepare("SELECT definition FROM scheduled_events WHERE schedule_id!='__initialized__' ORDER BY schedule_id").all().map(r=>JSON.parse(r.definition));
const router = express.Router();
router.get('/scheduled-events', requireAdmin, (_req,res)=>res.json({status:'success',data:listEvents()}));
function save(req,res,update) {
  try {
    const result = db.transaction(()=> {
      const all = listEvents();
      const old = update ? all.find(e=>e.schedule_id===req.params.id) : null;
      if (update && !old) return null;
      const value = validateSchedule({...old,...req.body,schedule_id:update ? old.schedule_id : crypto.randomUUID()});
      if (all.some(e=>e.schedule_id!==value.schedule_id && overlap(e,value))) throw new Error('Sự kiện chồng lịch đang bật. Tắt/đổi lịch cũ trước.');
      db.prepare('INSERT INTO scheduled_events VALUES (?,?) ON CONFLICT(schedule_id) DO UPDATE SET definition=excluded.definition').run(value.schedule_id,JSON.stringify(value));
      return value;
    })();
    if (!result) return res.status(404).json({status:'error',message:'Không tìm thấy sự kiện.'});
    res.status(update ? 200 : 201).json({status:'success',data:result});
  } catch (error) { res.status(400).json({status:'error',message:error.message}); }
}
router.post('/scheduled-events',requireAdmin,(req,res)=>save(req,res,false));
router.patch('/scheduled-events/:id',requireAdmin,(req,res)=>save(req,res,true));
router.get('/attendance-policy',requireDeviceKey,(req,res)=> {
  const day = req.query.day;
  if (!validDay(day)) return res.status(400).json({status:'error',message:'Ngày phải theo YYYY-MM-DD.'});
  const confirmed = db.prepare(`SELECT u.user_code,e.occurrence_key,e.event_id FROM access_events e JOIN users u ON u.user_id=e.user_id
    WHERE e.event_type='check_in' AND e.occurrence_key IS NOT NULL AND date(e.event_time,'+7 hours')=?`).all(day);
  res.json({status:'success',day,data:{events:listEvents(),confirmed}});
});
export default router;
