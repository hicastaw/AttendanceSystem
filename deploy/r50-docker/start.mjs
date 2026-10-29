// One container preserves the existing backend/worker loopback and temp-run guards.
import {spawn} from 'node:child_process';
import {readFile,writeFile,access} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import path from 'node:path';
import {createGateway} from './gateway.mjs';

const root=path.resolve(new URL('../..',import.meta.url).pathname);
const state='/tmp/aiot-software-test-docker',marker=path.join(state,'cpu-test-run.json');
const python='/opt/venv/bin/python',descriptor=path.join(root,'AIOT/edge/model/r50-experimental-laptop.json');
const threads=Number(process.env.DEMO_THREADS||4);
if(!Number.isInteger(threads)||threads<1||threads>16)throw new Error('DEMO_THREADS must be 1..16');
let backend,worker,gateway,stopping=false;

function launch(command,args,env={},ipc=false){
  return spawn(command,args,{cwd:state,env:{...process.env,...env},stdio:['pipe','pipe','pipe',...(ipc?['ipc']:[])]});
}
async function exited(child){
  if(child.exitCode!==null||child.signalCode!==null)return;
  await new Promise(resolve=>child.once('exit',resolve));
}
async function stop(code=0){
  if(stopping)return;stopping=true;
  if(worker?.stdin.writable)worker.stdin.write('stop\n');
  for(const child of [worker,backend])if(child&&child.exitCode===null){
    child.kill('SIGTERM');
    const timer=setTimeout(()=>child.kill('SIGKILL'),4000);
    await exited(child);clearTimeout(timer);
  }
  if(gateway){gateway.closeAllConnections();await new Promise(resolve=>gateway.close(resolve));}
  process.exitCode=code;
}
process.on('SIGTERM',()=>stop());process.on('SIGINT',()=>stop());

try {
  const inspect=launch(python,['-B',path.join(root,'tools/cpu_model_tool.py'),'check',descriptor,'--experimental','--threads',String(threads),'--smoke']);
  let output='',errors='';inspect.stdout.on('data',value=>{output+=value;});inspect.stderr.on('data',value=>{errors+=value;});
  const checked=await new Promise((resolve,reject)=>{inspect.once('error',reject);inspect.once('exit',resolve);});
  if(checked!==0)throw new Error('R50 hash/I-O/runtime check failed: '+errors.slice(-1500));
  const contract=JSON.parse(output).contract;
  let credentials,run;
  try {
    run=JSON.parse(await readFile(marker,'utf8'));
    credentials=JSON.parse(await readFile(path.join(state,'demo-credentials.json'),'utf8'));
    if(run.purpose!=='isolated-r50-laptop-test'||!isDeepStrictEqual(run.contracts,[contract])||run.active_contract_id!==contract.contract_id)
      throw new Error('Stored gallery/run contract differs from current models. Preserve the volume and use a new demo volume.');
    if(!/^[a-f0-9]{48}$/.test(credentials.key)||!/^[a-f0-9]{36}$/.test(credentials.password))throw new Error('Invalid demo credentials');
  } catch(error) {
    if(error.code!=='ENOENT')throw error;
    // Never adopt an existing unmarked DB or incomplete credentials as a new demo.
    for(const name of ['test.db','cpu-test-run.json','demo-credentials.json']) {
      try {await access(path.join(state,name));throw new Error('Incomplete demo volume; refusing to overwrite '+name);}catch(probe){if(probe.code!=='ENOENT')throw probe;}
    }
    credentials={key:randomBytes(24).toString('hex'),password:randomBytes(18).toString('hex')};
    run={schema:1,purpose:'isolated-r50-laptop-test',run_id:randomUUID(),contracts:[contract],active_contract_id:contract.contract_id,
      test_matching:{threshold:.6,minimum_margin:.05},test_capture:{deadline_seconds:180,max_sample_gap_seconds:60}};
    await writeFile(path.join(state,'demo-credentials.json'),JSON.stringify(credentials),{flag:'wx',mode:0o600});
    await writeFile(marker,JSON.stringify(run),{flag:'wx',mode:0o600});
  }
  backend=launch(process.execPath,[path.join(root,'AIOT/server/src/index.js')],{
    APP_MODE:'production',NODE_ENV:'production',HOST:'127.0.0.1',PORT:'0',DB_DIR:state,DB_PATH:path.join(state,'test.db'),
    DOTENV_CONFIG_PATH:path.join(state,'absent.env'),ADMIN_PASSWORD:credentials.password,EDGE_DEVICE_KEY:credentials.key,AIOT_CPU_TEST_RUN:marker,
  },true);
  backend.stderr.pipe(process.stderr);backend.stdout.pipe(process.stdout);
  const backendPort=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Backend startup timed out')),15000);
    backend.on('message',message=>{if(message?.type==='aiot-listening'){clearTimeout(timer);resolve(message.port);}});
    backend.once('error',reject);backend.once('exit',()=>{clearTimeout(timer);reject(new Error('Backend exited before listening'));});
  });
  const backendUrl=`http://127.0.0.1:${backendPort}`;
  gateway=createGateway({backendUrl,deviceKey:credentials.key});
  gateway.requestTimeout=5000;
  await new Promise((resolve,reject)=>{gateway.once('error',reject);gateway.listen(3080,'0.0.0.0',resolve);});
  worker=launch(python,['-B',path.join(root,'tools/run_cpu_test_worker.py'),'--run',marker,'--descriptor',descriptor,
    '--backend',backendUrl,'--threads',String(threads),'--experimental','--browser-source','http://127.0.0.1:3080/__browser-camera/next'],{EDGE_DEVICE_KEY:credentials.key});
  worker.stdout.pipe(process.stdout);worker.stderr.pipe(process.stderr);
  for(const child of [backend,worker]){
    child.once('error',error=>{console.error(error.message);stop(1);});
    child.once('exit',code=>{if(!stopping){console.error('Demo child stopped:',code);stop(1);}});
  }
  console.log(`\nDEMO_R50 Docker: http://localhost:3080\nAdmin password: ${credentials.password}\nOpen that page and explicitly enable your browser webcam. Keep the camera tab open.\nContract: ${contract.contract_id}\nData stays in the dedicated demo-data volume after stop/down.\n`);
} catch(error){console.error(error.message);await stop(1);}
