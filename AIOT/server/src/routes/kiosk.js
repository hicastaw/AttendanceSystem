import express from 'express';
import db from '../db.js';
import {requireDeviceKey} from '../middleware/auth.js';
import {mode,contract,sameContract} from '../runtime.js';
import {cpuTestScope,equalContract} from '../cpu-test-scope.js';

const router=express.Router();
let latest=null,sequence=0;
let statusSource=null,statusSequence=0;
const retiredSources=new Set();
const states=new Set(['idle','evaluating','unknown','pending','camera_unavailable','model_unavailable','storage_error','enrollment']);
export function pipelineReady(now=Date.now()) {
  return Boolean(latest && now-latest.received_at<=10000 && latest.frame_age_seconds+(now-latest.received_at)/1000<=5 && latest.pipeline_ready===true && latest.camera_ok && latest.model_ok);
}
router.get('/system-ready',(_req,res)=>{
  try {
    db.prepare('SELECT count(*) FROM users').get();
    const ready=pipelineReady();
    res.status(ready?200:503).json({status:ready?'ready':'unavailable',scope:'local_pipeline',database:true,pipeline_ready:ready});
  } catch {res.status(503).json({status:'unavailable',scope:'local_pipeline',database:false,pipeline_ready:false});}
});
router.post('/worker-state',requireDeviceKey,(req,res)=> {
  const input=req.body;
  const ordered=input?.status_source!==undefined || input?.status_sequence!==undefined;
  if (!input || input.mode!==mode || !(cpuTestScope ? equalContract(input.embedding_contract,cpuTestScope.active) : sameContract(input.embedding_contract)) || !states.has(input.state) ||
      (input.event_id!=null && (typeof input.event_id!=='string'||input.event_id.length>200)) ||
      (input.pipeline_ready!==undefined && typeof input.pipeline_ready!=='boolean') ||
      (ordered && (typeof input.status_source!=='string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.status_source) ||
        !Number.isSafeInteger(input.status_sequence) || input.status_sequence<1)) ||
      (input.frame_age_seconds!=null && (typeof input.frame_age_seconds!=='number'||!Number.isFinite(input.frame_age_seconds)||input.frame_age_seconds<0))) {
    return res.status(400).json({status:'error',message:'Worker state/contract không hợp lệ.'});
  }
  if (ordered) {
    // Per-process ordering is separate from the public server heartbeat
    // sequence. Retire a replaced process so late posts cannot undo restart.
    if (retiredSources.has(input.status_source) ||
        (input.status_source===statusSource && input.status_sequence<=statusSequence))
      return res.json({status:'success',ignored:true});
    if (statusSource && input.status_source!==statusSource) retiredSources.add(statusSource);
    statusSource=input.status_source;statusSequence=input.status_sequence;
  }
  // Whitelist; no embeddings, free-form HTML, client names or optimistic success.
  latest={state:input.state,event_id:input.event_id || null,camera_ok:input.camera_ok===true,
    model_ok:input.model_ok===true,pipeline_ready:input.pipeline_ready===true && input.frame_age_seconds!=null && input.frame_age_seconds<=5,
    frame_age_seconds:input.frame_age_seconds??null,received_at:Date.now(),sequence:++sequence};
  res.json({status:'success'});
});
router.get('/kiosk-state',(_req,res)=> {
  const stale=!latest || Date.now()-latest.received_at>10000;
  const value=stale ? {state:'worker_unavailable',sequence,received_at:latest?.received_at || null} : {...latest};
  if (!stale && value.frame_age_seconds!=null) {
    value.frame_age_seconds+=(Date.now()-latest.received_at)/1000;
    if(value.frame_age_seconds>5)value.state='camera_unavailable';
  }
  if (!stale && value.state==='pending' && value.event_id) {
    const row=db.prepare(`SELECT e.event_id,e.event_time,e.event_type,u.user_code,u.full_name
      FROM access_events e JOIN users u ON u.user_id=e.user_id WHERE e.event_id=? OR e.event_id=(
        SELECT attendance_event_id FROM event_receipts WHERE event_id=?)`).get(value.event_id,value.event_id);
    if (row) {
      value.state='confirmed';value.attendance=row;
      if(cpuTestScope?.purpose==='isolated-r50-laptop-test')
        value.attendance_result=value.event_id===row.event_id?'CHECK_IN_SUCCESS':'ALREADY_CHECKED_IN';
    }
  }
  delete value.event_id;
  res.json({status:'success',mode,model_id:(cpuTestScope?.active || contract).model_id,...value});
});
export default router;
