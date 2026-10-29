// Load the actual legacy modules with ONLY the DB import substituted. Never
// import backend/db.js: its top-level connect would contact a real PostgreSQL DB.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {root} from './software_test_support.mjs';
const url=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const db=url("export default {query(){throw new Error('No database I/O allowed in auth unit tests')}};");
const source=await readFile(path.join(root,'backend/src/services/auth.js'),'utf8');
const originalSecret=process.env.AUTH_SECRET,originalJwt=process.env.JWT_SECRET,originalSeed=process.env.SEED_DEMO_AUTH_USERS,originalPassword=process.env.DEFAULT_ADMIN_PASSWORD;
test('legacy auth rejects role spoofing, invalid tokens, missing/default signing key and implicit seeding',async()=>{
  try {
    delete process.env.AUTH_SECRET;delete process.env.JWT_SECRET;delete process.env.SEED_DEMO_AUTH_USERS;
    const noSecret=await import(url(source.replace("'../db.js'",JSON.stringify(db))));
    assert.equal(noSecret.verifyAccessToken('forged'),null);
    assert.throws(()=>noSecret.createAccessToken({}),/AUTH_SECRET/);
    await noSecret.seedDemoAuthUsers(); // Must return before ANY DB query.
    process.env.AUTH_SECRET=crypto.randomBytes(32).toString('hex');
    const serviceUrl=url(source.replace("'../db.js'",JSON.stringify(db))+'\n// distinct configured module');
    const service=await import(serviceUrl);
    const middleware=await readFile(path.join(root,'backend/src/middleware/auth.js'),'utf8');
    const auth=await import(url(middleware.replace("'../db.js'",JSON.stringify(db)).replace("'../services/auth.js'",JSON.stringify(serviceUrl))));
    for(const headers of [{'x-user-role':'admin'},{authorization:'Bearer forged','x-user-role':'admin'}]){
      const req={header:name=>headers[name]};let next=false;
      auth.attachActor(req,{},()=>next=true);
      assert.equal(next,true);assert.equal(req.actor.role,'anonymous');
      let status;auth.requireRoles('admin')(req,{status(value){status=value;return this;},json(){}},()=>assert.fail('role bypass'));
      assert.equal(status,401);
    }
    const token=service.createAccessToken({auth_user_id:1,role:'admin',username:'synthetic'});
    const req={header:name=>name==='authorization'?`Bearer ${token}`:''};
    auth.attachActor(req,{},()=>{});assert.equal(req.actor.role,'admin');assert.equal(req.actor.authMode,'token');
    assert.equal(service.verifyAccessToken(token.slice(0,-2)+'xx'),null);
    process.env.SEED_DEMO_AUTH_USERS='true';delete process.env.DEFAULT_ADMIN_PASSWORD;
    await assert.rejects(service.seedDemoAuthUsers(),/DEFAULT_ADMIN_PASSWORD/);
  } finally {
    for(const [key,value] of Object.entries({AUTH_SECRET:originalSecret,JWT_SECRET:originalJwt,SEED_DEMO_AUTH_USERS:originalSeed,DEFAULT_ADMIN_PASSWORD:originalPassword})){
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  }
});
