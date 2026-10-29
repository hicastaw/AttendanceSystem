// Candidate enrollment uses the REAL single camera owner, never browser vectors.
// Absent a validated named test run every endpoint returns 404.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import db from '../db.js';
import {requireAdmin,requireDeviceKey} from '../middleware/auth.js';
import {normalizeEmbedding} from '../runtime.js';
import {cpuTestScope as scope,equalContract} from '../cpu-test-scope.js';
import {migrateVersionedGallery,saveCandidate,candidateGallery} from '../versioned-gallery.js';
import {worker} from './capture.js';
import {receiveR50Image} from '../upload.js';

const router=express.Router();
if(scope)migrateVersionedGallery(db,scope.contracts);
router.use((_req,res,next)=>scope?next():res.sendStatus(404));
router.get('/scope',requireDeviceKey,(_req,res)=>res.json({run_id:scope.runId,embedding_contract:scope.active,scope:'isolated-cpu-test'}));
// No device key, model path, embedding, or image leaves this endpoint. It only
// lets the isolated R50 admin page bind enrollment to the active contract.
router.get('/admin-scope',requireAdmin,(_req,res)=>res.json({run_id:scope.runId,embedding_contract:scope.active,
  scope:scope.purpose==='isolated-r50-laptop-test'?'isolated-r50-laptop-test':'isolated-cpu-test',
  production_activated:false}));
router.get('/camera/diagnostics',requireAdmin,safe(async(_req,res)=>{
  const value=await peer('/cpu-test-diagnostics');
  if(value.scope!=='isolated-r50-laptop-test'||value.contract_id!==scope.active.contract_id||value.production_activated!==false)
    throw new Error('Worker diagnostics scope mismatch');
  res.json({status:'success',data:value});
}));
router.get('/camera/preview',requireAdmin,safe(async(_req,res)=>{
  const value=await preview();
  if(!value.type.startsWith('image/jpeg'))throw new Error('Invalid worker preview');
  res.type('jpg').send(value.buffer);
}));
router.use('/contracts/:id',(req,res,next)=>{
  const contract=scope.contracts.get(req.params.id);
  if(!contract)return res.status(404).json({status:'error',code:'incompatible_model',message:'Unregistered model contract'});
  req.candidateContract=contract;next();
});
router.get('/contracts/:id/gallery',requireDeviceKey,(req,res)=>{
  res.json({status:'success',embedding_contract:req.candidateContract,data:candidateGallery(db,req.params.id)});
});
const capture=express.Router({mergeParams:true});
capture.use(requireAdmin);
capture.use((req,res,next)=>{
  if(req.params.id!==scope.active.contract_id)return res.status(409).json({status:'error',code:'incompatible_model',message:'Capture model differs from active worker'});
  if(!/^[A-Z0-9_-]{1,64}$/.test(req.params.code))return res.status(400).json({status:'error',code:'invalid_member_code'});
  req.member=db.prepare('SELECT user_id,status FROM users WHERE user_code=?').get(req.params.code);
  if(!req.member)return res.status(404).json({status:'error',code:'member_not_found'});
  if(req.member.status!=='active')return res.status(409).json({status:'error',code:'member_inactive'});
  next();
});
function safe(action) {return async(req,res)=>{
  try {await action(req,res);} catch(error) {
    console.error('CPU test capture failed:',Number.isInteger(error.status)?error.status:'binding_or_worker_or_storage');
    res.status(error.status || 503).json({status:'error',code:error.code || 'enrollment_unavailable',message:'Candidate capture unavailable; nothing confirmed'});
  }
};}
function workerBaseUrl() {
  const portFile=path.join(scope.root,'cpu-worker-port.json');
  if(fs.realpathSync(portFile)!==portFile || fs.statSync(portFile).size>1024)throw new Error('Invalid worker discovery');
  const discovery=JSON.parse(fs.readFileSync(portFile,'utf8'));
  if(discovery.run_id!==scope.runId || !Number.isInteger(discovery.port) || discovery.port<1 || discovery.port>65535)
    throw new Error('Invalid worker discovery binding');
  return `http://127.0.0.1:${discovery.port}`;
}
async function peer(route,options={}) {
  return JSON.parse((await worker(route,{...options,baseUrl:workerBaseUrl(),allowValidationErrors:true})).buffer);
}
async function preview(route='/preview.jpg') {
  return worker(route,{baseUrl:workerBaseUrl(),allowValidationErrors:true});
}
async function resultFor(req) {
  const value=await peer('/capture-sessions/'+req.params.session);
  if(value.session_id!==req.params.session || value.user_code!==req.params.code || !equalContract(value.embedding_contract,req.candidateContract))
    throw Object.assign(new Error('Capture subject/model binding mismatch'),{status:409,code:'capture_binding_mismatch'});
  return value;
}
async function cancelWorkerSession(sessionId) {
  try {
    await peer('/capture-sessions/'+sessionId,{method:'DELETE'});
    return 'cancelled';
  } catch(error) {
    // Expiry between status and DELETE, or a retry after a lost response, is
    // already a confirmed terminal state for this session id.
    if(error.status===404)return 'already_absent';
    throw error;
  }
}
function cancellationConfirmed(res,state) {
  return res.json({status:'success',data:{cancellation:state,confirmed:true}});
}
function cancellationUnconfirmed(res,error,remainingSeconds) {
  console.error('CPU test capture cancellation unconfirmed:',Number.isInteger(error?.status)?error.status:'worker_or_transport_error');
  const data={cancellation:'unconfirmed',confirmed:false};
  if(Number.isFinite(remainingSeconds))data.recovery_deadline_seconds=Math.max(0,Math.ceil(remainingSeconds));
  return res.status(error?.status || 503).json({status:'error',data});
}
function existing(req) {
  const receipt=db.prepare('SELECT * FROM candidate_capture_receipts WHERE session_id=?').get(req.params.session);
  if(receipt && (receipt.user_id!==req.member.user_id || receipt.contract_id!==req.params.id))
    throw Object.assign(new Error('Receipt subject/model mismatch'),{status:409,code:'capture_binding_mismatch'});
  return receipt;
}
capture.post('/',receiveR50Image,async(req,res)=>{
  if(!req.file && !req.is('application/json'))return res.status(415).json({status:'error',code:'unsupported_format'});
  if(!req.file && (!req.body || typeof req.body!=='object' || Array.isArray(req.body) ||
      Object.keys(req.body).some(key=>!['source','frames'].includes(key))))
    return res.status(400).json({status:'error',code:'invalid_capture_request'});
  const source=req.file?'upload':'camera';
  const frames=source==='upload'?1:req.body?.frames ?? 1;
  if(!Number.isInteger(frames) || !(frames===1 || frames>=3&&frames<=8) || req.body?.source!==undefined && req.body.source!=='camera')
    return res.status(400).json({status:'error',code:'invalid_capture_request'});
  let disconnected=false,sessionId=null,cleanupTask=null;
  const cleanupOrphan=()=>{
    if(!sessionId)return Promise.resolve('unconfirmed');
    if(!cleanupTask)cleanupTask=cancelWorkerSession(sessionId).catch(error=>{
      console.error('Orphaned isolated capture cleanup unconfirmed:',Number.isInteger(error?.status)?error.status:'worker_or_transport_error');
      return 'unconfirmed';
    });
    return cleanupTask;
  };
  const onClose=()=>{
    if(!res.writableFinished) {
      disconnected=true;
      if(sessionId)void cleanupOrphan();
    }
  };
  res.once('close',onClose);
  try {
    let form;
    if(req.file) {
      form=new FormData();
      form.set('user_code',req.params.code);form.set('embedding_contract',JSON.stringify(req.candidateContract));
      form.set('face_image',new Blob([req.file.buffer],{type:req.file.mimetype}),'enrollment-image');
    }
    const value=await peer('/capture-sessions',{method:'POST',...(form?{form}:{body:{user_code:req.params.code,embedding_contract:req.candidateContract,frames}})});
    if(!/^[a-f0-9]{32}$/.test(value.session_id) || value.user_code!==req.params.code || !equalContract(value.embedding_contract,req.candidateContract))
      throw new Error('Capture binding mismatch');
    sessionId=value.session_id;
    if(value.required!==frames || value.source && value.source!==source)throw new Error('Capture source/sample binding mismatch');
    if(disconnected || res.destroyed) {
      await cleanupOrphan();
      return;
    }
    delete value.embedding;res.status(201).json({status:'success',data:value});
  } catch(error) {
    console.error('CPU test capture failed:',Number.isInteger(error.status)?error.status:'binding_or_worker_or_storage');
    if(sessionId)await cleanupOrphan();
    if(!res.destroyed)res.status(error.status || 503).json({status:'error',code:error.code || 'enrollment_unavailable',message:'Candidate capture unavailable; nothing confirmed'});
  } finally {
    req.file?.buffer?.fill(0);
  }
});
capture.get('/preview',safe(async(_req,res)=>{
  const value=await preview();
  if(!value.type.startsWith('image/jpeg'))throw new Error('Invalid worker preview');
  res.type('jpg').send(value.buffer);
}));
capture.use('/:session',(req,res,next)=>/^[a-f0-9]{32}$/.test(req.params.session)?next():res.sendStatus(400));
capture.get('/:session',safe(async(req,res)=>{
  const value=await resultFor(req);delete value.embedding;res.json({status:'success',data:value});
}));
capture.get('/:session/preview',safe(async(req,res)=>{
  await resultFor(req);
  const value=await preview('/capture-sessions/'+req.params.session+'/preview');
  if(!value.type.startsWith('image/jpeg'))throw new Error('Invalid worker preview');
  res.type('jpg').send(value.buffer);
}));
capture.delete('/:session',async(req,res)=>{
  let value;
  try {
    value=await resultFor(req);
  } catch(error) {
    if(error.status===404)return cancellationConfirmed(res,'already_absent');
    return cancellationUnconfirmed(res,error);
  }
  try {
    return cancellationConfirmed(res,await cancelWorkerSession(req.params.session));
  } catch(error) {
    return cancellationUnconfirmed(res,error,value.remaining_seconds);
  }
});
capture.post('/:session/commit',safe(async(req,res)=>{
  if(req.body?.confirm_same_member!==true)return res.status(400).json({status:'error',code:'identity_confirmation_required'});
  const committed=alreadySaved=>res.json({status:'success',already_saved:alreadySaved,data:{has_face_profile:1,
    receipt:{session_id:req.params.session,user_code:req.params.code,contract_id:req.params.id}}});
  if(existing(req))return committed(true);
  let value;
  try {value=await resultFor(req);} catch(error) {
    if(existing(req))return committed(true);
    throw error;
  }
  if(value.state!=='ready' || !Number.isInteger(value.required) || !(value.required===1 || value.required>=3&&value.required<=8) || value.samples!==value.required)
    return res.status(409).json({status:'error',code:'capture_not_ready'});
  let saved;
  try {
    saved=saveCandidate(db,{userId:req.member.user_id,contractId:req.params.id,sessionId:req.params.session,embedding:normalizeEmbedding(value.embedding)});
  } finally {
    // A failed storage commit must not leave the camera owner in enrollment
    // mode, where attendance stays paused until the session deadline.
    await peer('/capture-sessions/'+req.params.session,{method:'DELETE'}).catch(()=>{});
  }
  committed(!saved);
}));
router.post('/contracts/:id/users//capture',requireAdmin,(_req,res)=>res.status(400).json({status:'error',code:'invalid_member_code',message:'Create/select an active member first.'}));
router.use('/contracts/:id/users/:code/capture',capture);
export default router;
