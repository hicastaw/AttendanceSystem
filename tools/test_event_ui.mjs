// Run real app.js against a small DOM/HTTP shim; NOT browser rendering or HIL.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const markup=await readFile(path.join(root,'AIOT/server/public/index.html'),'utf8');
const source=await readFile(path.join(root,'AIOT/server/public/app.js'),'utf8');
class Element {
  constructor() {this.children=[];this.handlers={};this.value='';this.textContent='';this.dataset={};this.classList={add(){},remove(){}};}
  addEventListener(type,fn) {this.handlers[type]=fn;}
  appendChild(child) {this.children.push(child);}
  replaceChildren() {this.children=[];}
  set innerHTML(value) {assert.equal(value,'');this.children=[];}
}
function setup() {
  const nodes=new Map([...markup.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element()]));
  const logs=new Element(),events=new Element(),calls=[];
  const scheduled={schedule_id:'default-morning',name:'Buổi sáng',start_time:'07:00',end_time:'12:00',weekdays:[1,2,3,4,5,6],date:null,active:true};
  const document={getElementById(id){assert.ok(nodes.has(id),`Missing HTML id ${id}`);return nodes.get(id);},createElement(){return new Element();},
    querySelector(selector){return selector==='#log-table tbody'?logs:events;},querySelectorAll(){return [];},addEventListener(){} };
  const context=vm.createContext({document,localStorage:{getItem(){return '';},removeItem(){},setItem(){}},
    Date,URL,FormData,AbortSignal,alert(message){throw new Error(message);},fetch:async(route,options)=> {
      calls.push({route,options});
      const data=route.startsWith('/api/scheduled-events')?[scheduled]:[
        {event_time:'2026-10-12T12:00:00+07:00',user_code:'TEST001',full_name:'Synthetic',event_type:'check_in',event_name:null,device_id:'TEST',confidence:80},
        {event_time:'2026-10-12T08:00:00+07:00',user_code:'TEST001',full_name:'Synthetic',event_type:'check_out',event_name:'Old',device_id:'TEST',confidence:80}];
      return {status:200,ok:true,json:async()=>({status:'success',data})};
    }});
  vm.runInContext(source,context,{filename:'real-app.js'});
  return {nodes,logs,events,calls,context};
}
test('actual loadEvents renders names, recurring days, enabled flag',async()=> {
  const f=setup();await vm.runInContext('loadEvents()',f.context);
  assert.equal(f.calls[0].route,'/api/scheduled-events');
  assert.equal(f.events.children[0].children[0].textContent,'Buổi sáng');
  assert.equal(f.events.children[0].children[3].textContent,'Đang bật');
});
test('actual event form emits a dated schedule payload',async()=> {
  const f=setup();for (const [id,value] of Object.entries({'event-name':'Meeting','event-start':'19:00','event-end':'20:00','event-date':'2026-10-12'})) f.nodes.get(id).value=value;
  await f.nodes.get('event-form').handlers.submit({preventDefault(){}});
  const sent=JSON.parse(f.calls[0].options.body);
  assert.equal(f.calls[0].options.method,'POST');assert.equal(sent.date,'2026-10-12');assert.deepEqual(sent.weekdays,[]);
  assert.equal(sent.start_time,'19:00');assert.equal(sent.active,true);
});
test('actual disable button PATCHes only active flag, preserves schedule id',async()=> {
  const f=setup();await vm.runInContext('loadEvents()',f.context);
  const button=f.events.children[0].children[4].children[0];await button.handlers.click();
  assert.equal(f.calls[1].route,'/api/scheduled-events/default-morning');
  assert.equal(f.calls[1].options.method,'PATCH');assert.deepEqual(JSON.parse(f.calls[1].options.body),{active:false});
});
test('actual log displays unassigned attendance and legacy checkout distinctly',async()=> {
  const f=setup();await vm.runInContext('loadLogs()',f.context);
  assert.equal(f.logs.children[0].children[3].textContent,'Điểm danh đến');
  assert.equal(f.logs.children[0].children[4].textContent,'Không thuộc sự kiện');
  assert.equal(f.logs.children[1].children[3].textContent,'Ra (lịch sử)');
});
