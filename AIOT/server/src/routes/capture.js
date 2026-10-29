// Admin-only proxy to the single local camera owner. Never accept browser embeddings.
import express from 'express';
import db from '../db.js';
import {requireAdmin} from '../middleware/auth.js';
import {mode,contract,normalizeEmbedding,sameContract,contractJson} from '../runtime.js';

const router=express.Router({mergeParams:true});
router.use(requireAdmin);
function member(code){return db.prepare("SELECT user_id FROM users WHERE user_code=? AND status='active'").get(code);}
function code(req){return String(req.params.code).trim().toUpperCase();}
function workerUrl(route,baseUrl){
  const url=new URL(baseUrl || process.env.WORKER_BASE_URL || 'http://127.0.0.1:5000');
  if(url.protocol!=='http:' || !['127.0.0.1','[::1]'].includes(url.hostname) || url.username || url.password || url.pathname!=='/' || url.search || url.hash)
    throw new Error('Worker must be explicit local loopback');
  return new URL(route,url);
}
export async function worker(route,{method='GET',body,form,baseUrl,allowValidationErrors=false}={}){
  const key=process.env.EDGE_DEVICE_KEY;
  if(!key || key.length<24 || key.startsWith('change-me'))throw new Error('Worker credentials missing');
  const response=await fetch(workerUrl(route,baseUrl),{method,headers:{'X-Device-Key':key,...(form?{}:{'Content-Type':'application/json'})},
    ...(form?{body:form}:body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(5000)});
  // Stream bounds apply before buffering: an erroneous peer must not exhaust memory.
  const reader=response.body?.getReader();let size=0;const chunks=[];
  if(reader)try {while(true){const {done,value}=await reader.read();if(done)break;
    size+=value.byteLength;if(size>1024*1024)throw new Error('Worker response too large');chunks.push(Buffer.from(value));}}
  finally {await reader.cancel().catch(()=>{});}
  const buffer=Buffer.concat(chunks);
  if(!response.ok){
    const error=new Error('Worker unavailable');
    error.status=(allowValidationErrors?[400,404,409,413,415,422]:[404,409]).includes(response.status)?response.status:503;
    if(allowValidationErrors)try {
      const code=JSON.parse(buffer).code;
      if(['invalid_image','image_too_large','unsupported_format','invalid_capture_request','capture_busy',
          'incompatible_model','capture_not_found','preview_not_ready'].includes(code))error.code=code;
    } catch {}
    throw error;
  }
  return {buffer,type:response.headers.get('content-type')||''};
}
function safe(handler){return async(req,res)=>{
  if(mode!=='production')return res.status(409).json({status:'error',message:'Capture requires the real legacy contract; no mock fallback.'});
  try {await handler(req,res);} catch(error){
    console.error('Capture failed:',Number.isInteger(error.status)?error.status:'worker_or_storage_error');
    res.status(error.status || 503).json({status:'error',message:'Capture unavailable; no new profile confirmed.'});
  }
};}
router.get('/preview',safe(async(_req,res)=>{
  const result=await worker('/preview.jpg');
  if(!result.type.startsWith('image/jpeg'))throw new Error('Invalid preview');
  res.type('jpg').send(result.buffer);
}));
router.post('/',safe(async(req,res)=>{
  const user=code(req);
  if(!member(user))return res.status(404).json({status:'error',message:'Active member not found.'});
  const frames=req.body?.frames??5;
  if(!Number.isInteger(frames)||frames<3||frames>8)return res.status(400).json({status:'error',message:'Expected 3..8 frames.'});
  const result=JSON.parse((await worker('/capture-sessions',{method:'POST',body:{user_code:user,embedding_contract:contract,frames}})).buffer);
  if(result.user_code!==user || !sameContract(result.embedding_contract) || !/^[a-f0-9]{32}$/.test(result.session_id))throw new Error('Invalid capture response');
  delete result.embedding;res.status(201).json({status:'success',data:result});
}));
router.use('/:session',(req,res,next)=>{
  if(!/^[a-f0-9]{32}$/.test(req.params.session))return res.status(400).json({status:'error',message:'Invalid session id.'});
  next();
});
async function resultFor(req){
  const result=JSON.parse((await worker('/capture-sessions/'+req.params.session)).buffer);
  if(result.session_id!==req.params.session || result.user_code!==code(req) || !sameContract(result.embedding_contract))throw new Error('Capture binding mismatch');
  return result;
}
router.get('/:session',safe(async(req,res)=>{const result=await resultFor(req);delete result.embedding;res.json({status:'success',data:result});}));
router.delete('/:session',safe(async(req,res)=>{await resultFor(req);await worker('/capture-sessions/'+req.params.session,{method:'DELETE'});res.json({status:'success'});}));
router.post('/:session/commit',safe(async(req,res)=>{
  if(req.body?.confirm_same_member!==true)return res.status(400).json({status:'error',message:'Explicit subject confirmation required.'});
  const user=member(code(req));
  if(!user)return res.status(404).json({status:'error',message:'Active member not found.'});
  const receipt=db.prepare('SELECT user_id FROM capture_receipts WHERE session_id=?').get(req.params.session);
  if(receipt){if(receipt.user_id!==user.user_id)throw new Error('Capture receipt binding mismatch');return res.json({status:'success',already_saved:true});}
  let result;
  try {result=await resultFor(req);} catch(error){
    // Concurrent commit may have erased worker RAM after our first receipt read.
    const completed=db.prepare('SELECT user_id FROM capture_receipts WHERE session_id=?').get(req.params.session);
    if(completed?.user_id===user.user_id)return res.json({status:'success',already_saved:true});
    throw error;
  }
  if(result.state!=='ready' || !Number.isInteger(result.required) || result.required<3 || result.required>8 || result.samples!==result.required)
    return res.status(409).json({status:'error',message:'Capture not ready.'});
  const embedding=JSON.stringify(normalizeEmbedding(result.embedding));
  const saved=db.transaction(()=>{
    const concurrent=db.prepare('SELECT user_id FROM capture_receipts WHERE session_id=?').get(req.params.session);
    if(concurrent){if(concurrent.user_id!==user.user_id)throw new Error('Capture receipt binding mismatch');return false;}
    if(!member(code(req)))throw new Error('Member no longer active');
    db.prepare(`INSERT INTO face_profiles(user_id,embedding,embedding_contract,quality_score) VALUES (?,?,?,NULL)
      ON CONFLICT(user_id) DO UPDATE SET embedding=excluded.embedding,embedding_contract=excluded.embedding_contract,
      quality_score=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%S','now')`).run(user.user_id,embedding,contractJson);
    db.prepare('INSERT INTO capture_receipts(session_id,user_id) VALUES (?,?)').run(req.params.session,user.user_id);
    return true;
  })();
  // A lost response/retry is resolved by the receipt, never by saving a second profile.
  await worker('/capture-sessions/'+req.params.session,{method:'DELETE'}).catch(()=>{});
  res.json({status:'success',already_saved:!saved});
}));
export default router;
