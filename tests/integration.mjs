// Run against a local server. This test touches only its own randomly named drawings.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import WebSocket from 'ws';
import {unpackStroke} from '../server/compact.ts';
const origin=process.env.TEST_URL||'http://127.0.0.1:5173';
if(!['127.0.0.1','localhost'].includes(new URL(origin).hostname))throw Error('Integration tests require a local development server.');
const {rooms}=JSON.parse(await readFile(new URL('../rooms.config.json',import.meta.url),'utf8'));
const room=rooms[0],other=rooms[1],prefix=crypto.randomUUID(),sockets=[];
async function join(name,r=room,password=r.password){return fetch(`${origin}/api/rooms/${r.id}/join`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name,password,color:'#3e83b7'})});}
async function open(cookie,r=room){const ws=new WebSocket(`${origin.replace('http','ws')}/api/rooms/${r.id}/socket`,{headers:{Origin:origin,Cookie:cookie}});sockets.push(ws);const queue=[],waiters=[];ws.on('message',data=>{const m=JSON.parse(data.toString());if(m.type==='snapshot'){m.strokes=m.strokes.map(unpackStroke);if(m.next)ws.send(JSON.stringify({type:'load',cursor:m.next}));}queue.push(m);for(const waiter of [...waiters])if(waiter.test(m)){waiters.splice(waiters.indexOf(waiter),1);queue.splice(queue.indexOf(m),1);clearTimeout(waiter.timer);waiter.resolve(m);break;}});const next=(test,ms=4000)=>{const i=queue.findIndex(test);if(i>=0)return Promise.resolve(queue.splice(i,1)[0]);return new Promise((resolve,reject)=>{const w={test,resolve,timer:setTimeout(()=>{waiters.splice(waiters.indexOf(w),1);reject(Error('Timed out waiting for room event'));},ms)};waiters.push(w);});};const snapshot=[];await next(m=>{if(m.type==='snapshot')snapshot.push(...m.strokes);return m.type==='ready';});return {ws,next,snapshot,send:m=>ws.send(JSON.stringify(m))};}
const stroke={id:prefix,points:[{x:-40,y:20,p:.4},{x:80,y:100,p:1}],color:'#3e83b7',width:5};
let a;
try {
  const listed=await (await fetch(`${origin}/api/rooms`)).text();assert.ok(!listed.includes(room.password));console.log('✓ Room passwords are absent from public metadata');
  assert.equal((await join('No entry',room,'incorrect-password')).status,401);
  const cross=await fetch(`${origin}/api/rooms/${room.id}/join`,{method:'POST',headers:{Origin:'https://elsewhere.example','Content-Type':'application/json'},body:JSON.stringify({name:'Bad origin',password:room.password})});assert.equal(cross.status,403);
  const status=await new Promise((resolve,reject)=>{const ws=new WebSocket(`${origin.replace('http','ws')}/api/rooms/${room.id}/socket`,{headers:{Origin:origin}});ws.on('unexpected-response',(_,res)=>{res.resume();resolve(res.statusCode);});ws.on('open',()=>{ws.close();reject(Error('Unauthenticated connection accepted'));});ws.on('error',()=>resolve('rejected'));});assert.ok(status===401||status==='rejected');console.log('✓ Invalid passwords, cross-origin joins, and unauthenticated sockets are rejected');
  const ja=await join('Test Alice'),jb=await join('Test Bob');assert.equal(ja.status,200);assert.equal(jb.status,200);assert.match(ja.headers.get('set-cookie'),/HttpOnly/);
  const cookieA=ja.headers.get('set-cookie').split(';')[0],cookieB=jb.headers.get('set-cookie').split(';')[0];a=await open(cookieA);const b=await open(cookieB);
  a.send({type:'stroke',stroke});const received=await b.next(m=>m.type==='stroke'&&m.stroke.id===stroke.id);assert.equal(received.stroke.points[0].p,.4);assert.equal(received.stroke.color,stroke.color);console.log('✓ Two people share drawing geometry, color, and pressure');
  const c=await open(cookieA);assert.ok(c.snapshot.some(s=>s.id===stroke.id));console.log('✓ Late joiners receive the saved board');
  a.send({type:'preview',stroke:{...stroke,id:prefix+'-preview'}});await b.next(m=>m.type==='preview'&&m.stroke.id===prefix+'-preview');a.send({type:'color',color:'#a16bc0'});a.send({type:'pointer',stroke:{...stroke,id:prefix+'-pointer'}});const pointer=await b.next(m=>m.type==='pointer'&&m.stroke.id===prefix+'-pointer');assert.equal(pointer.stroke.color,'#a16bc0');const d=await open(cookieB);assert.ok(!d.snapshot.some(s=>s.id===prefix+'-pointer'||s.id===prefix+'-preview'));console.log('✓ Live previews and fading pointers broadcast without being saved');
  b.send({type:'erase',ids:[stroke.id]});await a.next(m=>m.type==='erase'&&m.ids.includes(stroke.id));b.send({type:'undo'});await a.next(m=>m.type==='stroke'&&m.stroke.id===stroke.id);console.log('✓ Anyone can erase; their undo restores the erased stroke');
  if(other){const j=await join('Test other room',other);assert.equal(j.status,200);const isolated=await open(j.headers.get('set-cookie').split(';')[0],other);assert.ok(!isolated.snapshot.some(s=>s.id===stroke.id));console.log('✓ Rooms have separate boards');}
  a.send({type:'undo'});await b.next(m=>m.type==='erase'&&m.ids.includes(stroke.id));console.log('✓ Undo removes only the caller’s own drawing action');
  const e=await open(cookieA);assert.ok(!e.snapshot.some(s=>s.id===stroke.id));console.log('✓ Erasure persists for new connections');
  console.log('\nAll collaboration and access checks passed.');
} finally {if(a?.ws.readyState===WebSocket.OPEN)a.send({type:'erase',ids:[stroke.id]});for(const ws of sockets)ws.close();}
