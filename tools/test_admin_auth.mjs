import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {root} from './software_test_support.mjs';
test('AIOT token TTL expires and sample credentials fail closed',async()=>{
  const saved={password:process.env.ADMIN_PASSWORD,ttl:process.env.ADMIN_TOKEN_TTL_SECONDS,key:process.env.EDGE_DEVICE_KEY};
  const original=Date.now;
  try {
    process.env.ADMIN_TOKEN_TTL_SECONDS='1';process.env.ADMIN_PASSWORD=crypto.randomBytes(24).toString('hex');
    let now=100000;Date.now=()=>now;
    const source=await readFile(path.join(root,'AIOT/server/src/middleware/auth.js'),'utf8');
    const auth=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
    const token=auth.login(process.env.ADMIN_PASSWORD);assert.ok(token);
    const req={header:()=>`Bearer ${token}`};let accepted=false,status;
    const res={status(code){status=code;return this;},json(){}};
    auth.requireAdmin(req,res,()=>accepted=true);assert.equal(accepted,true);
    now+=1000;accepted=false;auth.requireAdmin(req,res,()=>accepted=true);
    assert.equal(accepted,false);assert.equal(status,401);
    process.env.ADMIN_PASSWORD='change-me-admin-password';assert.equal(auth.login(process.env.ADMIN_PASSWORD),null);
    process.env.EDGE_DEVICE_KEY='change-me-edge-key-demo';
    auth.requireDeviceKey({header:()=>process.env.EDGE_DEVICE_KEY},res,()=>assert.fail('sample key accepted'));
    assert.equal(status,503);
  } finally {
    Date.now=original;
    for(const [key,value] of Object.entries({ADMIN_PASSWORD:saved.password,ADMIN_TOKEN_TTL_SECONDS:saved.ttl,EDGE_DEVICE_KEY:saved.key})){
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  }
});

test('login limiter enforces per-IP boundary and expires only after its current window',async()=>{
  const original=Date.now;
  try {
    let now=200000;Date.now=()=>now;
    const source=await readFile(path.join(root,'AIOT/server/src/middleware/auth.js'),'utf8');
    const auth=await import('data:text/javascript;base64,'+Buffer.from(source+'\n// limiter regression').toString('base64'));
    let accepted=0,status;
    const res={status(code){status=code;return this;},json(){}};
    const attempt=ip=>auth.loginLimit({ip},res,()=>accepted++);
    for(let i=0;i<10;i++)attempt('synthetic-ip-A');
    assert.equal(accepted,10);
    attempt('synthetic-ip-A');assert.equal(status,429);assert.equal(accepted,10);
    attempt('synthetic-ip-B');assert.equal(accepted,11);
    now+=60000;attempt('synthetic-ip-A');assert.equal(accepted,11);
    now++;attempt('synthetic-ip-A');assert.equal(accepted,12);
  } finally {Date.now=original;}
});

test('token cap evicts oldest session; revocation and invalid device keys fail closed',async()=>{
  const previous=process.env.ADMIN_PASSWORD;
  const previousKey=process.env.EDGE_DEVICE_KEY;
  try {
    process.env.ADMIN_PASSWORD=crypto.randomBytes(24).toString('hex');
    process.env.EDGE_DEVICE_KEY=crypto.randomBytes(24).toString('hex');
    const source=await readFile(path.join(root,'AIOT/server/src/middleware/auth.js'),'utf8');
    const auth=await import('data:text/javascript;base64,'+Buffer.from(source+'\n// token capacity regression').toString('base64'));
    const tokens=Array.from({length:101},()=>auth.login(process.env.ADMIN_PASSWORD));
    let status,accepted;
    const res={status(code){status=code;return this;},json(){}};
    const req=token=>({header:()=>`Bearer ${token}`});
    const check=token=>{accepted=false;auth.requireAdmin(req(token),res,()=>accepted=true);return accepted;};
    assert.equal(check(tokens[0]),false);assert.equal(status,401);
    assert.equal(check(tokens[1]),true);assert.equal(check(tokens[100]),true);
    auth.revokeToken(req(tokens[100]));assert.equal(check(tokens[100]),false);
    auth.requireDeviceKey({header:()=>''},res,()=>assert.fail('empty device key accepted'));
    assert.equal(status,401);
    auth.requireDeviceKey({header:()=>process.env.EDGE_DEVICE_KEY},res,()=>accepted=true);
    assert.equal(accepted,true);
  } finally {
    if(previous===undefined)delete process.env.ADMIN_PASSWORD;else process.env.ADMIN_PASSWORD=previous;
    if(previousKey===undefined)delete process.env.EDGE_DEVICE_KEY;else process.env.EDGE_DEVICE_KEY=previousKey;
  }
});
