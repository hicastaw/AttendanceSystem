// Laptop-only launcher. No .env or production DB is opened. Ctrl+C stops children.
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import readline from 'node:readline';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const option=(flag,fallback)=>{
  if(!args.includes(flag))return fallback;
  const value=args[args.indexOf(flag)+1];
  if(!value || value.startsWith('--'))throw new Error(`Missing value for ${flag}`);
  return value;
};
const directory=path.resolve(option('--data-dir',path.join(root,'.venv','mock-demo')));
const port=Number(option('--port','3301'));
if (!Number.isInteger(port)||port<1024||port>65535) throw new Error('Invalid port');
await mkdir(directory,{recursive:true});
const runtimeFile=path.join(directory,'mock-runtime.json');
let settings;
try {settings=JSON.parse(await readFile(runtimeFile,'utf8'));}
catch(error) {
  if(error.code!=='ENOENT')throw error;
  settings={mode:'mock',key:crypto.randomBytes(24).toString('hex'),password:crypto.randomBytes(18).toString('hex')};
}
if(settings.mode!=='mock')throw new Error('Not a mock runtime');
if(![settings.password,settings.key].every(value=>typeof value==='string' && value.length>=24 && !value.startsWith('change-me')))
  throw new Error('Invalid mock runtime credentials; use a new isolated --data-dir');
settings.url=`http://127.0.0.1:${port}`;
await writeFile(runtimeFile,JSON.stringify(settings),{mode:0o600});
const server=spawn(process.execPath,[path.join(root,'AIOT/server/src/index.js')],{
  cwd:directory,env:{...process.env,APP_MODE:'mock',HOST:'127.0.0.1',PORT:String(port),DB_DIR:directory,
    DOTENV_CONFIG_PATH:path.join(directory,'absent-mock.env'),ADMIN_TOKEN_TTL_SECONDS:'3600',
    DB_PATH:path.join(directory,'mock-attendance.db'),ADMIN_PASSWORD:settings.password,EDGE_DEVICE_KEY:settings.key},stdio:['inherit','inherit','inherit','ipc']});
let worker,closing=false;
const input=readline.createInterface({input:process.stdin});
input.on('line',line=>{if(line.trim()==='stop')stop();});
function closeInput(){input.close();process.stdin.pause();process.stdin.unref?.();}
function stop(){if(closing)return;closing=true;closeInput();worker?.kill();server.kill();}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
server.on('exit',code=>{if(!closing)process.exitCode=code||1;closeInput();worker?.kill();});
// Confirm this child's listener before sending credentials or seed requests.
// A port occupied by another service must never be treated as our backend.
async function waitForListener(){
  let timer,onMessage,onExit,onError;
  try {
    await new Promise((resolve,reject)=>{
      timer=setTimeout(()=>reject(new Error('Mock backend listen timed out after 10000ms')),10000);
      onMessage=message=>{if(message?.type==='aiot-listening' && message.port===port)resolve();};
      onExit=()=>reject(new Error('Mock backend exited before listening (check startup log / EADDRINUSE)'));
      onError=error=>reject(new Error(`Mock backend spawn failed: ${error.code || error.name}`));
      server.on('message',onMessage);server.once('exit',onExit);server.once('error',onError);
    });
  } finally {
    clearTimeout(timer);server.off('message',onMessage);server.off('exit',onExit);server.off('error',onError);
  }
}
async function request(route,options={}){
  if(closing)throw new Error('Mock launcher stopping');
  try {return await fetch(settings.url+route,{...options,signal:AbortSignal.timeout(5000)});}
  catch(error){throw new Error(`Mock request ${route} failed: ${error.name}`);}
}
try {
  await waitForListener();
  if(!(await request('/api/ready')).ok)throw new Error('Mock backend not ready');
  const response=await request('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:settings.password})});
  const login=await response.json();
  if(!response.ok || typeof login.data?.token!=='string')throw new Error('Mock admin login failed');
  const headers={Authorization:`Bearer ${login.data.token}`,'Content-Type':'application/json'};
  const created=await request('/api/users',{method:'POST',headers,body:JSON.stringify({user_code:'DEMO001',full_name:'Thành viên mô phỏng'})});
  if(![201,409].includes(created.status))throw new Error('Demo member creation failed');
  const enrolled=await request('/api/users/DEMO001/mock-face',{method:'POST',headers});
  if(!enrolled.ok)throw new Error('Synthetic enrollment failed');
  console.log(`\nKiosk: ${settings.url}/kiosk.html\nAdmin/history: ${settings.url}/\nMock admin password: ${settings.password}\nSynthetic data only. Ctrl+C to stop.\n`);
  if(!args.includes('--manual')) {
    worker=spawn(option('--python','python'),[path.join(root,'tools/simulate_recognition.py'),'--runtime',runtimeFile,'--watch'],{cwd:root,stdio:['ignore','pipe','pipe']});
    worker.stdout.pipe(process.stdout);worker.stderr.pipe(process.stderr);
    worker.on('error',error=>{console.error(error.message);stop();process.exitCode=1;});
    worker.on('exit',code=>{if(!closing){console.error('Mock worker stopped:',code);stop();process.exitCode=code||1;}});
  }
} catch(error){if(!closing){stop();throw error;}}
