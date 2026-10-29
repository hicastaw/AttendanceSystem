import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const tracked=new WeakMap();

export async function withDeadline(promise,ms,label) {
  let timer;
  try {return await Promise.race([promise,new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(new Error(`${label} timed out after ${ms}ms`)),ms);
  })]);} finally {clearTimeout(timer);}
}

export function spawnTestProcess(command,args,options={},secrets=[]) {
  const child=spawn(command,args,options);
  const record={output:'',error:null,closed:false};
  record.redact=value=>{
    let safe=String(value);
    for(const secret of secrets)if(secret)safe=safe.split(secret).join('[REDACTED]');
    return safe.replace(/Mock admin password:[^\r\n]*/gi,'Mock admin password: [REDACTED]')
      .replace(/("(?:password|key|token|access_token)"\s*:\s*")[^"]*/gi,'$1[REDACTED]');
  };
  for(const stream of [child.stdout,child.stderr])stream?.on('data',b=>{record.output=(record.output+b.toString()).slice(-16384);});
  child.on('error',error=>{record.error=error;});
  record.ended=new Promise(resolve=>child.once('close',(code,signal)=>{
    record.closed=true;resolve({code,signal,error:record.error});
  }));
  tracked.set(child,record);return child;
}

export function childDiagnostics(child) {
  const record=tracked.get(child);
  return record ? `pid=${child.pid || 'not-started'} exit=${child.exitCode} signal=${child.signalCode}; `+
    record.redact((record.error?.message || '')+'\n'+record.output).slice(-4000) : 'untracked child';
}

export async function waitForChild(child,{timeoutMs=15000,label='child process'}={}) {
  const record=tracked.get(child);
  if(!record)throw new Error('Child must be created with spawnTestProcess');
  try {
    const result=await withDeadline(record.ended,timeoutMs,label);
    if(result.error)throw result.error;
    return result.code;
  } catch(error){throw new Error(`${label}: ${error.message}; ${childDiagnostics(child)}`,{cause:error});}
}

export async function stopChild(child,{timeoutMs=3000,graceful}={}) {
  const record=tracked.get(child);if(!record || record.closed)return;
  if(graceful && child.stdin?.writable)child.stdin.write(graceful);else child.kill();
  try {await withDeadline(record.ended,timeoutMs,'child shutdown');}
  catch {child.kill('SIGKILL');await withDeadline(record.ended,timeoutMs,'forced child shutdown');}
}

export async function closeHttpServer(server) {
  if(!server?.listening)return;
  const closed=new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  server.closeAllConnections();
  await withDeadline(closed,3000,'test HTTP server shutdown');
}

export async function listenHttp(server) {
  await withDeadline(new Promise((resolve,reject)=>{
    const error=e=>{server.off('listening',listening);reject(e);};
    const listening=()=>{server.off('error',error);resolve();};
    server.once('error',error);server.once('listening',listening);server.listen(0,'127.0.0.1');
  }),3000,'test HTTP server listen');
}

function assertTemporary(directory) {
  if(path.dirname(path.resolve(directory))!==path.resolve(os.tmpdir()) ||
     !path.basename(directory).startsWith('aiot-software-test-'))throw new Error('Unexpected test directory');
}

export async function bootBackend({mode='production',directory,extra={},startupTimeoutMs=10000,
                                   serverArgs=[path.join(root,'AIOT/server/src/index.js')]}={}) {
  const owned=!directory;directory ||= await mkdtemp(path.join(os.tmpdir(),'aiot-software-test-'));
  assertTemporary(directory);
  const key=crypto.randomBytes(24).toString('hex'),password=crypto.randomBytes(24).toString('hex');
  const child=spawnTestProcess(process.execPath,serverArgs,{cwd:directory,
    env:{...process.env,APP_MODE:mode,HOST:'127.0.0.1',PORT:'0',DB_DIR:directory,
      DOTENV_CONFIG_PATH:path.join(directory,'absent-test.env'),ADMIN_TOKEN_TTL_SECONDS:'3600',
      DB_PATH:path.join(directory,'test.db'),EDGE_DEVICE_KEY:key,ADMIN_PASSWORD:password,...extra},
    stdio:['ignore','pipe','pipe','ipc']},[key,password]);
  let url,phase='listen IPC';const record=tracked.get(child);
  const request=async(route,{body,headers={},method=body===undefined?'GET':'POST'}={})=>{
    try {
      const response=await fetch(url+route,{method,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},
        body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
      const raw=await response.text();let value;try{value=JSON.parse(raw);}catch{value={message:raw};}
      return {status:response.status,body:value};
    } catch(error){throw new Error(`${method} ${route} failed: ${error.name}; ${childDiagnostics(child)}`,{cause:error});}
  };
  async function stop(){await stopChild(child);}
  async function dispose(){await stop();assertTemporary(directory);await rm(directory,{recursive:true,force:true});}
  let onMessage;
  try {
    const logged=await withDeadline((async()=>{
      const port=await Promise.race([
        new Promise(resolve=>{onMessage=message=>{
          if(message?.type==='aiot-listening' && Number.isInteger(message.port) && message.port>0)resolve(message.port);
        };child.on('message',onMessage);}),
        record.ended.then(()=>{throw new Error('Backend exited before listening');}),
      ]);
      url=`http://127.0.0.1:${port}`;phase='readiness';
      if((await request('/api/ready')).status!==200)throw new Error('Backend not ready');
      phase='admin login';
      const result=await request('/api/auth/login',{body:{password}});
      if(result.status!==200 || typeof result.body?.data?.token!=='string')throw new Error('Test admin login failed');
      return result;
    })(),startupTimeoutMs,'backend startup');
    return {url,child,directory,key,password,request,stop,dispose,
      admin:{Authorization:`Bearer ${logged.body.data.token}`},device:{'X-Device-Key':key}};
  } catch(error) {
    await stop();if(owned)await rm(directory,{recursive:true,force:true});
    throw new Error(`Backend startup (${phase}): ${record.redact(error.message)}; ${childDiagnostics(child)}`,{cause:error});
  } finally {if(onMessage)child.off('message',onMessage);}
}
