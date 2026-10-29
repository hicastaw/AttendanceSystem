// Resolve from the AIOT package, regardless of the launcher's working directory.
// Do not import dotenv/config or application/db modules here: preflight must not
// read .env or open a configured attendance database.
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';

const packageUrl=new URL('../AIOT/server/package.json',import.meta.url);
const serverRequire=createRequire(packageUrl);
const dependencies=Object.keys(JSON.parse(readFileSync(packageUrl,'utf8')).dependencies);
const repair='From the repository root run: npm.cmd ci --prefix AIOT/server';

export function checkServerDependencies({resolve=serverRequire.resolve,load=serverRequire}={}) {
  const missing=[];
  for(const name of dependencies) {
    try {resolve(name);} catch {missing.push(name);}
  }
  if(missing.length)throw new Error(`AIOT backend Node dependencies missing or unreadable: ${missing.join(', ')}.\n${repair}\nPython virtualenv/pip does not install Node packages. No camera has been opened.`);
  let db;
  try {
    const Database=load('better-sqlite3');
    db=new Database(':memory:');
    if(db.pragma('integrity_check',{simple:true})!=='ok')throw new Error('SQLite integrity check failed');
  } catch(error) {
    throw new Error(`AIOT backend SQLite native dependency cannot load with ${process.version}: ${error.message}\n${repair}\nNo camera has been opened.`,{cause:error});
  } finally {db?.close();}
  return {status:'PASS',scope:'node-runtime-dependencies',packages:dependencies.length,sqlite:'ok',node:process.version};
}
