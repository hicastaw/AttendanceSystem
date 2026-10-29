// Opt-in real ONNX CPU fixture, shared by Node integration and kiosk browser QA.
import {mkdtemp,readFile,writeFile,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {bootBackend,root,spawnTestProcess,stopChild,waitForChild,withDeadline,childDiagnostics} from './software_test_support.mjs';

export const cpuFixtureAvailable=Boolean((process.env.CPU_R50_DESCRIPTOR || process.env.CPU_R50_MODELS) && process.env.CPU_R50_FIXTURES && process.env.TEST_PYTHON);
export async function until(check,label,timeout=15000) {
  const deadline=Date.now()+timeout;
  for(;;) {
    const result=await check();if(result)return result;
    if(Date.now()>=deadline)throw new Error(label+' timed out');
    await new Promise(r=>setTimeout(r,150));
  }
}

export async function cpuFixture({purpose='isolated-cpu-test'}={}) {
  if(!cpuFixtureAvailable)throw new Error('Set TEST_PYTHON, CPU_R50_DESCRIPTOR (or CPU_R50_MODELS) and CPU_R50_FIXTURES');
  if(!['isolated-cpu-test','isolated-r50-laptop-test'].includes(purpose))throw new Error('Invalid isolated CPU test purpose');
  const directory=await mkdtemp(path.join(os.tmpdir(),'aiot-software-test-'));
  const descriptor=path.join(directory,'descriptor.json'),runPath=path.join(directory,'cpu-test-run.json');
  let backend,child;
  const runPython=async(args)=>{
    const process=spawnTestProcess(globalThis.process.env.TEST_PYTHON,['-B',path.join(root,'tools/cpu_model_tool.py'),...args],
      {cwd:directory,env:{...globalThis.process.env,PYTHONIOENCODING:'utf-8'},stdio:['ignore','pipe','pipe']});
    let output='';process.stdout.on('data',b=>{output+=b;});
    try {
      if(await waitForChild(process,{label:'CPU descriptor tool',timeoutMs:15000})!==0)throw new Error(childDiagnostics(process));
      return JSON.parse(output);
    } finally {await stopChild(process);}
  };
  const stop=async()=>{if(child){await stopChild(child,{graceful:'stop\n',timeoutMs:5000});child=null;}};
  const dispose=async()=>{try {await stop();}finally {try {if(backend)await backend.stop();}finally {await rm(directory,{recursive:true,force:true});}}};
  try {
    const ftz=process.env.CPU_R50_FTZ || '0';
    if(!['0','1'].includes(ftz))throw new Error('CPU_R50_FTZ must be explicit 0 or 1');
    if(process.env.CPU_R50_DESCRIPTOR) {
      const supplied=path.resolve(process.env.CPU_R50_DESCRIPTOR),value=JSON.parse(await readFile(supplied,'utf8'));
      // Preserve descriptor numerics/FTZ: env must not silently change a supplied contract.
      if(process.env.CPU_R50_FTZ!==undefined && Boolean(value.ftz)!==(ftz==='1'))throw new Error('FTZ differs from supplied descriptor');
      for(const role of ['detector','recognizer'])value[role].path=path.resolve(path.dirname(supplied),value[role].path);
      await writeFile(descriptor,JSON.stringify(value));
    } else {
      await runPython(['baseline-descriptor','--models',path.resolve(process.env.CPU_R50_MODELS),'--output',descriptor,...(ftz==='1'?['--ftz']:[])]);
    }
    const contract=await runPython(['contract',descriptor]);
    const marker={schema:1,purpose,run_id:crypto.randomUUID(),contracts:[contract],active_contract_id:contract.contract_id,
      test_matching:{threshold:.6,minimum_margin:.05},test_capture:{deadline_seconds:180,max_sample_gap_seconds:60}};
    await writeFile(runPath,JSON.stringify(marker));
    async function control(scenario) {
      const target=path.join(directory,'input-control.json'),temporary=target+'.tmp';
      await writeFile(temporary,JSON.stringify({scenario}));await rename(temporary,target);
    }
    await control('blank');
    backend=await bootBackend({directory,extra:{AIOT_CPU_TEST_RUN:runPath}});
    let workerUrl;
    async function start() {
      if(child)throw new Error('Worker already owned');
      child=spawnTestProcess(process.env.TEST_PYTHON,['-B',path.join(root,'tools/run_cpu_test_worker.py'),'--run',runPath,
        '--descriptor',descriptor,'--fixtures',path.resolve(process.env.CPU_R50_FIXTURES),'--backend',backend.url,
        '--threads',process.env.CPU_R50_THREADS || '4','--experimental'],
        {cwd:directory,env:{...process.env,EDGE_DEVICE_KEY:backend.key,PYTHONIOENCODING:'utf-8'},stdio:['pipe','pipe','pipe']},[backend.key]);
      const owned=child;
      let onData,onClose,onError;
      try {
        const port=await withDeadline(new Promise((resolve,reject)=>{
          let output='';onData=buffer=>{output+=buffer;const match=output.match(/"type":\s*"cpu-worker-listening",\s*"port":\s*(\d+)/);
            if(match)resolve(Number(match[1]));};onClose=()=>reject(new Error(childDiagnostics(owned)));onError=reject;
          owned.stdout.on('data',onData);owned.once('close',onClose);owned.once('error',onError);
        }),15000,'CPU worker startup');
        workerUrl=`http://127.0.0.1:${port}`;
      } finally {owned.stdout.off('data',onData);owned.off('close',onClose);owned.off('error',onError);}
    }
    const call=(route,options={})=>backend.request(route,{...options,headers:{...backend.admin,...options.headers}});
    const base=code=>`/api/cpu-test/contracts/${contract.contract_id}/users/${code}/capture`;
    const enrollmentTimeoutMs=Number(process.env.CPU_R50_ENROLL_TIMEOUT_MS || 45000);
    if(!Number.isInteger(enrollmentTimeoutMs) || enrollmentTimeoutMs<15000 || enrollmentTimeoutMs>60000)
      throw new Error('CPU_R50_ENROLL_TIMEOUT_MS must be an integer 15000..60000');
    async function enroll(code,frames=3) {
      await control('known');
      const response=await call(base(code),{body:{frames}});
      if(response.status!==201)throw new Error('Enrollment start: '+JSON.stringify(response));
      const session=response.body.data.session_id;
      await until(async()=>{
        const result=await call(base(code)+'/'+session);
        if(result.status!==200)throw new Error('Enrollment poll: '+JSON.stringify(result)+'; '+childDiagnostics(child));
        if('embedding' in result.body.data)throw new Error('Browser embedding leak');
        return result.body.data.state==='ready';
      },'CPU multi-frame enrollment',enrollmentTimeoutMs).catch(error=>{throw new Error(error.message+'; '+childDiagnostics(child));});
      const commit=await call(base(code)+'/'+session+'/commit',{body:{confirm_same_member:true}});
      if(commit.status!==200)throw new Error('Enrollment commit: '+JSON.stringify(commit));
      return session;
    }
    async function diagnostics() {
      const response=await fetch(workerUrl+'/cpu-test-diagnostics',{headers:backend.device,signal:AbortSignal.timeout(3000)});
      if(!response.ok)throw new Error('CPU diagnostics unavailable');return response.json();
    }
    return {directory,descriptor,contract,backend,call,base,control,start,stop,dispose,enroll,diagnostics,enrollmentTimeoutMs,
      get workerUrl(){return workerUrl;},get child(){return child;},
      async outboxRows(){
        const reader=spawnTestProcess(process.env.TEST_PYTHON,['-B','-c',
          "import sqlite3,json,sys; c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); c.row_factory=sqlite3.Row; print(json.dumps([dict(r) for r in c.execute('SELECT event_id,status FROM events')])); c.close()",
          path.join(directory,'outbox.db')],{cwd:directory,stdio:['ignore','pipe','pipe']});
        let output='';reader.stdout.on('data',b=>{output+=b;});
        try {if(await waitForChild(reader)!==0)throw new Error(childDiagnostics(reader));return JSON.parse(output);}
        finally {await stopChild(reader);}
      }};
  } catch(error){await dispose();throw error;}
}
