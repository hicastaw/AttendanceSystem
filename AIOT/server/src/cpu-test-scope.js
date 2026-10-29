// No env-only R50 activation: only a named temporary run can expose candidate APIs.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {isDeepStrictEqual} from 'node:util';

export function readCpuTestScope(env=process.env) {
  if (!env.AIOT_CPU_TEST_RUN) return null;
  const marker=path.resolve(env.AIOT_CPU_TEST_RUN), root=path.dirname(marker);
  if(path.basename(marker)!=='cpu-test-run.json' || path.dirname(root)!==fs.realpathSync(os.tmpdir()) ||
     !path.basename(root).startsWith('aiot-software-test-') || fs.realpathSync(root)!==root ||
     fs.realpathSync(marker)!==marker || env.HOST!=='127.0.0.1' || (env.APP_MODE || 'production')!=='production')
    throw new Error('CPU candidate requires an isolated temporary loopback test run');
  if(!env.DB_PATH || path.resolve(env.DB_PATH)!==path.join(root,'test.db') ||
     fs.existsSync(env.DB_PATH) && fs.realpathSync(env.DB_PATH)!==path.resolve(env.DB_PATH))
    throw new Error('CPU test DB must be inside its isolated run');
  if(fs.statSync(marker).size>128*1024)throw new Error('CPU test marker too large');
  const value=JSON.parse(fs.readFileSync(marker,'utf8'));
  if(value.schema!==1 || !['isolated-cpu-test','isolated-r50-laptop-test'].includes(value.purpose) ||
     !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value.run_id) ||
     !Array.isArray(value.contracts) || value.contracts.length<1 || value.contracts.length>16)
    throw new Error('Invalid CPU test marker');
  const contracts=new Map();
  for(const c of value.contracts) {
    if(!c || c.schema!==2 || c.mode!=='experimental-cpu-only' || c.production_approved!==false || c.dimension!==512 ||
       !['contract_id','detector_sha256','recognizer_sha256'].every(k=>typeof c[k]==='string' && /^[a-f0-9]{64}$/.test(c[k])) ||
       !['model_id','model_version','preprocess_id','alignment_id','numeric_mode'].every(k=>typeof c[k]==='string' && c[k].length>0) ||
       contracts.has(c.contract_id))throw new Error('Invalid provisioned candidate contract');
    contracts.set(c.contract_id,c);
  }
  if(!contracts.has(value.active_contract_id))throw new Error('Active CPU contract not registered');
  return {root,runId:value.run_id,purpose:value.purpose,contracts,active:contracts.get(value.active_contract_id)};
}

export const cpuTestScope=readCpuTestScope();
export const equalContract=(a,b)=>isDeepStrictEqual(a,b);
