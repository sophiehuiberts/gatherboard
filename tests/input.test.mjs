import test from 'node:test';
import assert from 'node:assert/strict';
import {bindCanvasInput,inputPressure,inputSamples} from '../src/input.ts';
function harness(captureThrows=false){
  const canvas=new EventTarget(),root=new EventTarget(),seen=[];
  canvas.setPointerCapture=()=>{if(captureThrows)throw Error('No active pointer');};
  canvas.hasPointerCapture=()=>false;canvas.releasePointerCapture=()=>{};
  const detach=bindCanvasInput(canvas,Object.fromEntries(['down','move','up'].map(kind=>[kind,e=>seen.push({kind,id:e.pointerId,type:e.type,x:e.clientX,y:e.clientY,pressure:e.pressure,pointerType:e.pointerType})])),root);
  let clock=0;
  const dispatch=(target,type,values={})=>{const e=new Event(type,{cancelable:true});Object.defineProperties(e,Object.fromEntries(Object.entries({pointerId:7,pointerType:'pen',button:0,buttons:type==='pointerup'?0:1,clientX:10,clientY:20,pressure:.4,timeStamp:++clock,...values}).map(([key,value])=>[key,{value}])));target.dispatchEvent(e);return e;};
  return{canvas,root,seen,detach,pointer:(type,values)=>dispatch(type==='pointerdown'||type==='lostpointercapture'?canvas:root,type,values),touch:(type,touch)=>dispatch(canvas,type,{changedTouches:[touch]}),native:type=>dispatch(canvas,type)};
}
const touch=(id,x,y)=>({identifier:id,touchType:'stylus',clientX:x,clientY:y,force:.3});
test('short strokes preserve pen-up coordinates even when capture fails and there are no move events',()=>{
  const h=harness(true);const down=h.pointer('pointerdown');h.pointer('pointerup',{clientX:12,clientY:23,pressure:0});
  assert.equal(down.defaultPrevented,true);assert.deepEqual(h.seen.map(e=>[e.kind,e.x,e.y]),[['down',10,20],['up',12,23]]);h.detach();
});
test('late capture loss cannot end the next quick stroke using the same Pencil pointer ID',()=>{
  const h=harness();h.pointer('pointerdown');h.pointer('pointerup');h.pointer('pointerdown');h.pointer('lostpointercapture');
  assert.deepEqual(h.seen.map(e=>e.kind),['down','up','down']);h.pointer('pointerup');assert.equal(h.seen.length,4);h.detach();
});
test('Pencil Touch Events recover two rapid strokes with missing Pointer Events',()=>{
  const h=harness();h.touch('touchstart',touch(11,10,20));h.touch('touchend',touch(11,12,23));h.touch('touchstart',touch(12,20,30));h.touch('touchend',touch(12,22,33));
  assert.deepEqual(h.seen.map(e=>[e.kind,e.x,e.y]),[['down',10,20],['up',12,23],['down',20,30],['up',22,33]]);assert.ok(h.seen.every(e=>e.pointerType==='pen'));h.detach();
});
test('combined Pointer and Pencil Touch Events produce exactly one stroke, with touch-end coordinates',()=>{
  const h=harness();h.pointer('pointerdown');h.touch('touchstart',touch(10,10,20));h.pointer('pointermove',{clientX:50});h.touch('touchmove',touch(10,12,22));h.pointer('pointerup',{clientX:13});h.touch('touchend',touch(10,14,25));h.pointer('pointerup');
  assert.deepEqual(h.seen.map(e=>[e.kind,e.id,e.x]),[['down',7,10],['move',7,12],['up',7,14]]);h.detach();
});
test('finger/palm touch events do not generate Pencil ink and native selection is cancelled',()=>{
  const h=harness();const start=h.touch('touchstart',{...touch(1,0,0),touchType:'direct'});h.touch('touchend',{...touch(1,0,0),touchType:'direct'});assert.equal(h.seen.length,0);assert.equal(start.defaultPrevented,true);
  for(const type of ['selectstart','contextmenu','dragstart','dblclick'])assert.equal(h.native(type).defaultPrevented,true);h.detach();
});
test('interrupted strokes recover on the next pen-down and cleanup removes handlers',()=>{
  const h=harness();h.pointer('pointerdown');h.pointer('pointerdown',{clientX:30});assert.deepEqual(h.seen.map(e=>[e.kind,e.id,e.type]),[['down',7,'pointerdown'],['up',7,'pointercancel'],['down',7,'pointerdown']]);h.detach();h.pointer('pointerup');assert.equal(h.seen.length,3);
});
test('latest dispatched sample is retained after coalesced points, and lift pressure cannot erase a short stroke',()=>{
  const latest={pointerType:'pen',pressure:0,clientX:12,getCoalescedEvents:()=>[{clientX:11,pressure:.3}]};assert.deepEqual(inputSamples(latest).map(e=>e.clientX),[11,12]);assert.equal(inputPressure(latest,.4),.4);assert.equal(inputPressure({pointerType:'pen',pressure:0},.5),.5);
});
