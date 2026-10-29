// Migration test ONLY on a newly-created temporary legacy SQLite fixture.
import {mkdtemp,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(root,'AIOT/server/package.json'));
const Database=require('better-sqlite3');
const temporary=await mkdtemp(path.join(os.tmpdir(),'aiot-event-migration-'));
const target=path.join(temporary,'legacy.db');
assert.equal(path.dirname(path.resolve(target)),path.resolve(temporary));
let fixture;
try {
  fixture=new Database(target);
  fixture.exec(`CREATE TABLE users(user_id INTEGER PRIMARY KEY,user_code TEXT UNIQUE,full_name TEXT,email TEXT,status TEXT DEFAULT 'active',created_at TEXT);
    CREATE TABLE face_profiles(face_profile_id INTEGER PRIMARY KEY,user_id INTEGER UNIQUE,image_path TEXT,embedding TEXT,quality_score REAL,created_at TEXT,updated_at TEXT);
    CREATE TABLE access_events(event_id TEXT PRIMARY KEY,user_id INTEGER,device_id TEXT,event_type TEXT,confidence REAL,event_time TEXT,created_at TEXT);
    INSERT INTO users(user_id,user_code,full_name) VALUES (1,'TESTLEGACY','Synthetic legacy');
    INSERT INTO access_events VALUES ('old-uuid',1,'OLD','check_out',80,'2026-10-10T08:00:00+07:00','old');`);
  const old=fixture.prepare('SELECT * FROM access_events').get();fixture.close();fixture=null;
  const migrate=()=> {
    const child=spawnSync(process.execPath,['--input-type=module','-e',`const {default:db}=await import(${JSON.stringify(pathToFileURL(path.join(root,'AIOT/server/src/db.js')).href)});db.close();`],
      {cwd:temporary,env:{...process.env,DB_PATH:target,DB_DIR:temporary},encoding:'utf8',timeout:10000});
    assert.equal(child.status,0,child.stderr);
  };
  migrate();fixture=new Database(target);
  const migrated=fixture.prepare('SELECT * FROM access_events').get();
  for (const [key,value] of Object.entries(old)) assert.equal(migrated[key],value);
  assert.equal(migrated.scheduled_event_id,null);assert.equal(migrated.occurrence_key,null);
  assert.equal(fixture.prepare("SELECT count(*) AS n FROM scheduled_events WHERE schedule_id!='__initialized__'").get().n,2);
  const definition=JSON.parse(fixture.prepare("SELECT definition FROM scheduled_events WHERE schedule_id='default-morning'").get().definition);
  fixture.prepare("UPDATE scheduled_events SET definition=? WHERE schedule_id='default-morning'").run(JSON.stringify({...definition,active:false}));
  fixture.close();fixture=null;migrate();fixture=new Database(target);
  assert.equal(JSON.parse(fixture.prepare("SELECT definition FROM scheduled_events WHERE schedule_id='default-morning'").get().definition).active,false);
  assert.equal(fixture.prepare('SELECT count(*) AS n FROM access_events').get().n,1);
  assert.equal(fixture.pragma('integrity_check',{simple:true}),'ok');
  console.log('PASS: additive backend migration, legacy history unchanged/null, restart does not re-enable disabled defaults, integrity ok. Temporary DB only.');
} finally {
  fixture?.close();
  await rm(temporary,{recursive:true,force:true});
}
