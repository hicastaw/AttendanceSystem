// One-command, disposable R50 laptop test system. It never reads .env, opens a
// production DB, or selects a webcam unless both camera flags are explicit.
import {spawn} from 'node:child_process';
import {mkdtemp,rm,writeFile,rename} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {checkServerDependencies} from './r50_dependency_check.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const usage=`Usage: node tools/run_r50_laptop_test.mjs --python C:\\path\\python.exe [--camera INDEX --allow-camera] [--fixtures PATH] [--threads 4]
       node tools/run_r50_laptop_test.mjs --check-deps

Starts an isolated SQLite backend, real SCRFD-10G/R50 ONNX worker, admin R50
enrollment page and kiosk. Default input is hash-pinned public-domain fixtures.
--camera never defaults and needs --allow-camera. Ctrl+C stops children and
removes the named OS-temp run. Type restart-worker to restart only the Python
worker while retaining the isolated backend and data. This is experimental
only, not production.`;
if(args.includes('--help')) {console.log(usage);process.exit(0);}
function option(name,fallback=undefined) {
  const index=args.indexOf(name);if(index<0)return fallback;
  const value=args[index+1];if(!value || value.startsWith('--'))throw new Error(`Missing value for ${name}`);
  return value;
}
function noValue(name){return args.includes(name);}
const allowed=new Set(['--help','--python','--camera','--allow-camera','--fixtures','--threads','--check-deps']);
for(const value of args)if(value.startsWith('--')&&!allowed.has(value))throw new Error(`Unknown option ${value}`);
try {
  const result=checkServerDependencies();
  if(noValue('--check-deps')) {console.log(JSON.stringify(result,null,2));process.exit(0);}
} catch(error) {console.error(error.message);process.exit(1);}
const python=option('--python',process.env.TEST_PYTHON);
if(!python)throw new Error('Provide --python CPython 3.11 with the test profile, or set TEST_PYTHON.');
const cameraText=option('--camera');const allowCamera=noValue('--allow-camera');
if((cameraText===undefined)!==!allowCamera)throw new Error('--camera and --allow-camera must be supplied together.');
const camera=cameraText===undefined?undefined:Number(cameraText);
if(camera!==undefined&&(!Number.isInteger(camera)||camera<0||camera>31))throw new Error('--camera must be an integer 0..31');
const fixtures=path.resolve(option('--fixtures',path.join(root,'.model-validation','public-domain-fixtures-20261020')));
if(camera===undefined&&!existsSync(fixtures))throw new Error(`Public fixture directory missing: ${fixtures}`);
const threads=Number(option('--threads','4'));
if(!Number.isInteger(threads)||threads<1||threads>32)throw new Error('--threads must be an integer 1..32');
const descriptor=path.join(root,'AIOT','edge','model','r50-experimental-laptop.json');
if(!existsSync(descriptor))throw new Error(`R50 descriptor missing: ${descriptor}`);

const directory=await mkdtemp(path.join(os.tmpdir(),'aiot-software-test-'));
const runPath=path.join(directory,'cpu-test-run.json');
const temporary=target=>target+'.tmp';
let backend,worker,inspect,backendPort,workerPort,workerStopTask,stoppingWorker;
let stopping=false,cleanupPromise=null,cleanupExitCode=0,restartPromise=null,inputBuffer='';
const closedChildren=new WeakSet();
function redact(value,key,password){return String(value).split(key).join('[REDACTED]').split(password).join('[REDACTED]');}
function trackChild(child) {child.once('close',()=>closedChildren.add(child));return child;}
function spawnChild(command,childArgs,options={}) {return trackChild(spawn(command,childArgs,{cwd:directory,stdio:['ignore','pipe','pipe','ipc'],...options}));}
function waitForClose(child,timeoutMs,label) {
  if(closedChildren.has(child))return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const onClose=()=>{clearTimeout(timer);resolve();};
    const timer=setTimeout(()=>{child.off('close',onClose);reject(new Error(`${label} did not close within ${timeoutMs}ms`));},timeoutMs);
    child.once('close',onClose);
  });
}
async function stopOwnedChild(child,{gracefulInput,signal='SIGTERM',timeoutMs=8000,label='owned child'}={}) {
  if(!child||closedChildren.has(child))return;
  if(gracefulInput!==undefined&&child.stdin?.writable&&!child.stdin.destroyed)child.stdin.end(gracefulInput);
  else child.kill(signal);
  try {await waitForClose(child,timeoutMs,label);return;}
  catch {}
  child.kill('SIGTERM');
  try {await waitForClose(child,3000,label);return;}
  catch {}
  child.kill('SIGKILL');
  await waitForClose(child,3000,label);
}
async function isPortClosed(port,timeoutMs=5000) {
  if(!Number.isInteger(port)||port<1||port>65535)return true;
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline) {
    const closed=await new Promise(resolve=>{
      const socket=net.createConnection({host:'127.0.0.1',port});let settled=false;
      const finish=value=>{if(settled)return;settled=true;socket.destroy();resolve(value);};
      socket.once('connect',()=>finish(false));
      socket.once('error',error=>finish(error.code==='ECONNREFUSED'||error.code==='ECONNRESET'));
      socket.setTimeout(300);socket.once('timeout',()=>finish(false));
    });
    if(closed)return true;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  return false;
}
function waitForLine(child,pattern,label,timeout=30000) {
  return new Promise((resolve,reject)=>{
    let output='',timer=setTimeout(()=>finish(new Error(`${label} timed out after ${timeout}ms`)),timeout);
    const onData=data=>{output+=data;const match=output.match(pattern);if(match)finish(null,match);};
    const onClose=()=>finish(new Error(`${label} exited before readiness: ${output.slice(-2000)}`));
    const onError=error=>finish(new Error(`${label} failed to start: ${error.message}`));
    const finish=(error,value)=>{clearTimeout(timer);child.stdout.off('data',onData);child.off('close',onClose);child.off('error',onError);error?reject(error):resolve(value);};
    child.stdout.on('data',onData);child.once('close',onClose);child.once('error',onError);
  });
}
async function stopWorker() {
  if(workerStopTask)return workerStopTask;
  const current=worker,port=workerPort;
  if(!current)return;
  stoppingWorker=current;
  workerStopTask=(async()=>{
    await stopOwnedChild(current,{gracefulInput:'stop\n',timeoutMs:10000,label:'R50 worker'});
    if(port&&!await isPortClosed(port))throw new Error(`R50 worker port ${port} remained open after exit`);
    if(worker===current)worker=undefined;
    if(workerPort===port)workerPort=undefined;
    if(port)console.log(`R50 worker port closed: ${port}`);
  })();
  try {await workerStopTask;} finally {workerStopTask=null;stoppingWorker=undefined;}
}
async function launchWorker(workerArgs,workerEnvironment) {
  if(stopping)return;
  const current=trackChild(spawn(python,workerArgs,{cwd:directory,env:workerEnvironment,stdio:['pipe','pipe','pipe']}));
  worker=current;
  current.stdout.pipe(process.stdout);current.stderr.pipe(process.stderr);
  current.once('close',()=>{
    if(worker===current&&!stopping&&stoppingWorker!==current) {
      console.error('R50 worker exited unexpectedly; stopping the isolated run.');
      void cleanup(1);
    }
  });
  const started=await waitForLine(current,/"type":\s*"cpu-worker-listening",\s*"port":\s*(\d+)/,'R50 worker startup',30000);
  if(stopping||worker!==current)throw new Error('R50 worker startup was cancelled');
  workerPort=Number(started[1]);
  console.log(`R50 worker ready: port ${workerPort}`);
}
async function restartWorker() {
  if(stopping||restartPromise)return;
  restartPromise=(async()=>{
    try {
      if(!worker)throw new Error('No owned R50 worker is running');
      console.log('R50 worker restart requested.');
      await stopWorker();
      if(stopping)return;
      await launchWorker(workerArgs,workerEnvironment);
      if(!stopping)console.log('R50 worker restart complete.');
    } catch(error) {
      if(stopping){await cleanup();return;}
      console.error(`R50 worker restart failed: ${error.message}`);
      await cleanup(1);
    }
  })();
  try {await restartPromise;} finally {restartPromise=null;}
}
async function cleanup(exitCode=0) {
  if(exitCode!==0)cleanupExitCode=exitCode;
  if(cleanupPromise)return cleanupPromise;
  stopping=true;
  process.stdin.off('data',onStdinData);
  process.stdin.pause();
  process.stdin.destroy();
  cleanupPromise=(async()=>{
    const failures=[];
    try {if(inspect){const current=inspect;inspect=undefined;await stopOwnedChild(current,{timeoutMs:3000,label:'R50 model inspection'});}}
    catch(error){failures.push(error);}
    try {await stopWorker();}
    catch(error){failures.push(error);}
    if(backend) {
      const current=backend;
      try {await stopOwnedChild(current,{timeoutMs:12000,label:'isolated R50 backend'});if(backend===current)backend=undefined;}
      catch(error){failures.push(error);}
    }
    if(backendPort&&!await isPortClosed(backendPort))failures.push(new Error(`Isolated backend port ${backendPort} remained open`));
    if(failures.length) {
      console.error(`R50 cleanup failed; the isolated run was preserved: ${failures.map(error=>error.message).join('; ')}`);
      process.exitCode=1;return;
    }
    if(path.dirname(directory)!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('aiot-software-test-')) {
      console.error('R50 cleanup refused a path outside the named OS-temp run.');process.exitCode=1;return;
    }
    await rm(directory,{recursive:true,force:true});
    if(existsSync(directory))throw new Error('Named temporary run still exists after cleanup');
    console.log('R50 isolated run cleanup complete.');
    process.exitCode=cleanupExitCode;
  })().catch(error=>{
    console.error(`R50 cleanup failed: ${error.message}`);
    process.exitCode=1;
  });
  return cleanupPromise;
}
function onStdinData(data) {
  inputBuffer+=String(data);
  const lines=inputBuffer.split(/\r?\n/);inputBuffer=lines.pop()||'';
  for(const line of lines) {
    const command=line.trim().toLowerCase();
    if(command==='stop'){console.log('R50 stop requested.');void cleanup();return;}
    if(command==='restart-worker')void restartWorker();
  }
}
process.on('SIGINT',()=>{void cleanup();});process.on('SIGTERM',()=>{void cleanup();});
process.stdin.setEncoding('utf8');
process.stdin.on('data',onStdinData);
let workerArgs=[],workerEnvironment;
async function startRun() {
try {
  inspect=trackChild(spawn(python,['-B',path.join(root,'tools','cpu_model_tool.py'),'check',descriptor,'--experimental','--threads',String(threads),'--smoke'],
    {cwd:directory,env:{...process.env,PYTHONIOENCODING:'utf-8'},stdio:['ignore','pipe','pipe']}));
  let checked='';inspect.stdout.on('data',data=>{checked+=data;});let failed='';inspect.stderr.on('data',data=>{failed+=data;});
  const inspected=inspect;
  const status=await new Promise((resolve,reject)=>{inspected.once('close',code=>resolve(code));inspected.once('error',reject);});
  if(inspect===inspected)inspect=undefined;
  if(stopping)return;
  if(status!==0)throw new Error(`R50 descriptor/hash/I-O check failed: ${failed||checked}`);
  const contract=JSON.parse(checked).contract;
  const marker={schema:1,purpose:'isolated-r50-laptop-test',run_id:crypto.randomUUID(),contracts:[contract],active_contract_id:contract.contract_id,
    test_matching:{threshold:.6,minimum_margin:.05},test_capture:{deadline_seconds:180,max_sample_gap_seconds:60}};
  await writeFile(temporary(runPath),JSON.stringify(marker));
  if(stopping)return;
  await rename(temporary(runPath),runPath);
  if(stopping)return;
  const key=crypto.randomBytes(24).toString('hex'),password=crypto.randomBytes(18).toString('hex');
  backend=spawnChild(process.execPath,[path.join(root,'AIOT','server','src','index.js')],{env:{...process.env,APP_MODE:'production',HOST:'127.0.0.1',PORT:'0',
    DB_DIR:directory,DB_PATH:path.join(directory,'test.db'),DOTENV_CONFIG_PATH:path.join(directory,'absent.env'),ADMIN_TOKEN_TTL_SECONDS:'3600',
    ADMIN_PASSWORD:password,EDGE_DEVICE_KEY:key,AIOT_CPU_TEST_RUN:runPath}});
  const ownedBackend=backend;
  ownedBackend.once('close',()=>{if(backend===ownedBackend&&!stopping){console.error('R50 isolated backend exited unexpectedly.');void cleanup(1);}});
  backend.stderr.pipe(process.stderr);backend.stdout.pipe(process.stdout);
  const port=Number((await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Backend listen timed out')),15000);
    const message=value=>{if(value?.type==='aiot-listening'){clearTimeout(timer);backend.off('message',message);resolve(value.port);}};
    backend.on('message',message);backend.once('close',()=>{clearTimeout(timer);reject(new Error('Backend exited before listening'));});
  })));
  backendPort=port;
  if(stopping)return;
  const backendUrl=`http://127.0.0.1:${port}`;
  workerArgs=['-B',path.join(root,'tools','run_cpu_test_worker.py'),'--run',runPath,'--descriptor',descriptor,'--backend',backendUrl,'--threads',String(threads),'--experimental'];
  if(camera===undefined) {
    const control=path.join(directory,'input-control.json');
    await writeFile(temporary(control),JSON.stringify({scenario:'known'}));await rename(temporary(control),control);
    workerArgs.push('--fixtures',fixtures);
  } else workerArgs.push('--camera',String(camera),'--allow-camera');
  workerEnvironment={...process.env,EDGE_DEVICE_KEY:key,PYTHONIOENCODING:'utf-8'};
  await launchWorker(workerArgs,workerEnvironment);
  if(stopping)return;
  console.log(`\nR50 EXPERIMENTAL LAPTOP TEST (production disabled)\nAdmin/create member: ${backendUrl}/\nR50 webcam test:    ${backendUrl}/lab-camera.html\nR50 enrollment:     ${backendUrl}/r50-capture.html\nLab attendance dashboard: ${backendUrl}/lab-dashboard.html\nDaily check-in kiosk: ${backendUrl}/lab-kiosk.html\nExisting schedule kiosk: ${backendUrl}/kiosk.html\nWorker diagnostics: http://127.0.0.1:${workerPort}/cpu-test-diagnostics\nAdmin password: ${password}\nInput: ${camera===undefined?'hash-pinned public-domain fixtures':`explicit camera ${camera}`}\nContract: ${contract.contract_id}\n\nNo MBF fallback is enabled. Type stop then Enter for verified cleanup; Ctrl+C also requests stop. If the console is force-terminated, remove only this named temp run: ${directory}\n`);
  console.log('Type restart-worker then Enter to restart only the R50 worker while retaining this isolated run.');
} catch(error) {
  if(!stopping){console.error(error.message);await cleanup(1);}else await cleanup();
}
}
await startRun();
