import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {BoardStore} from '../server/board-store.ts';
import {compactStroke,packStroke,unpackStroke} from '../server/compact.ts';
import {StrokeIndex,SavedInkCache} from '../src/board.ts';
const make=(id,points=[{x:0,y:0,p:.5},{x:100,y:0,p:.5}],order=1)=>({id,points,color:'#3e83b7',width:5,author:'test',order});
function database(){
  const db=new DatabaseSync(':memory:');
  const sql={exec(query,...bindings){const rows=db.prepare(query).all(...bindings);return {toArray:()=>rows,one:()=>{assert.equal(rows.length,1);return rows[0];},[Symbol.iterator]:()=>rows[Symbol.iterator]()};}};
  let n=0;const transaction=callback=>{const id='t'+n++;db.exec('SAVEPOINT '+id);try{const result=callback();db.exec('RELEASE '+id);return result;}catch(e){db.exec('ROLLBACK TO '+id);db.exec('RELEASE '+id);throw e;}};
  return {db,store:new BoardStore(sql,transaction)};
}
test('point compaction retains endpoints, corners, and pressure peaks',()=>{
  const line=make('line',Array.from({length:600},(_,i)=>({x:i,y:i*.5,p:i/599})));
  const compact=compactStroke(line,.25);assert.equal(compact.points.length,2);assert.deepEqual(compact.points[0],line.points[0]);assert.deepEqual(compact.points.at(-1),line.points.at(-1));
  const corner=make('corner',[{x:0,y:0,p:.2},{x:50,y:60,p:1},{x:100,y:0,p:.2}]);assert.equal(compactStroke(corner).points.length,3);
  const pressure=make('pressure',[{x:0,y:0,p:.2},{x:50,y:0,p:1},{x:100,y:0,p:.2}]);assert.equal(compactStroke(pressure).points.length,3);
  const tap=make('dot',[{x:2,y:3,p:.4}]);assert.deepEqual(compactStroke(tap),tap);assert.deepEqual(unpackStroke(packStroke(corner)),corner);
});
test('SQLite persistence is idempotent and counters survive reopening, erasing, restoring, and clearing',()=>{
  const {db,store}=database();const a=make('a'),b=make('b',[{x:5,y:9,p:.3}],2);
  assert.equal(store.insert(a),true);assert.equal(store.insert(a),false);store.insert(b);assert.deepEqual(store.stats,{strokes:2,points:3});
  store.markMigrated();const reopened=new BoardStore(store.sql,store.transaction);assert.equal(reopened.migrated,true);assert.deepEqual(reopened.get('a'),a);
  reopened.remove(['a','a','unknown']);assert.deepEqual(reopened.stats,{strokes:1,points:1});reopened.insert(a);assert.deepEqual(reopened.stats,{strokes:2,points:3});
  reopened.clear();assert.deepEqual(reopened.stats,{strokes:0,points:0});assert.equal(reopened.migrated,true);assert.equal(reopened.snapshot().rows.length,0);db.close();
});
test('100,000 strokes and 2,000,000 points load in bounded batches without loading the whole board',()=>{
  const {db,store}=database();const points=Array.from({length:20},(_,i)=>({x:i,y:i%3,p:.5}));
  const started=performance.now();for(let i=0;i<100000;i++)store.insert(make('s'+String(i).padStart(6,'0'),points,i));
  assert.deepEqual(store.stats,{strokes:100000,points:2000000});
  let cursor,count=0,pointCount=0,pages=0,previous=-1;
  while(true){const page=store.snapshot(cursor);if(!page.rows.length)break;assert.ok(page.rows.length<=1024);let batchPoints=0;for(const row of page.rows){assert.ok(row.sort_order>previous);previous=row.sort_order;batchPoints+=row.points;}assert.ok(batchPoints<=24000);count+=page.rows.length;pointCount+=batchPoints;cursor=page.next;pages++;}
  assert.equal(count,100000);assert.equal(pointCount,2000000);assert.equal(pages,98);
  store.remove(['s000000','s099999']);assert.deepEqual(store.stats,{strokes:99998,points:1999960});
  console.log(`100k-stroke in-memory SQLite stress check: ${(performance.now()-started).toFixed(0)} ms; ${pages} bounded snapshot pages.`);db.close();
});
test('spatial queries include thick/long strokes and handle updates, deletions, and huge views',()=>{
  const index=new StrokeIndex();index.set(make('local'));index.set(make('far',[{x:10000,y:10000,p:.5}]));index.set(make('long',[{x:-1e7,y:2,p:.5},{x:1e7,y:2,p:.5}]));
  const nearby=index.query({left:20,top:-10,right:30,bottom:10});assert.deepEqual(new Set(nearby.map(s=>s.id)),new Set(['local','long']));
  index.set(make('local',[{x:20000,y:20000,p:.5}]));assert.equal(index.query({left:20,top:-10,right:30,bottom:10}).length,1);
  index.delete('long');assert.equal(index.large.size,0);assert.equal(index.query({left:-1e7,top:-1e7,right:1e7,bottom:1e7}).length,2);index.clear();assert.equal(index.entries.size,0);
});
test('saved ink is cached during live drawing and small pans, and only nearby geometry is painted',()=>{
  const counts={stroke:0,transform:0,composite:0};
  const ctx={setTransform(){counts.transform++;},beginPath(){},moveTo(){},lineTo(){},stroke(){counts.stroke++;},arc(){},fill(){}};
  const canvas={getContext:()=>ctx,width:0,height:0};const cache=new SavedInkCache(canvas),index=new StrokeIndex();index.set(make('local'));index.set(make('far',[{x:10000,y:10000,p:.5}]));
  const target={drawImage(){counts.composite++;}},view={width:100,height:100,dpr:1,scale:1,ox:0,oy:0};
  cache.draw(target,view,index,new Set());assert.equal(counts.stroke,1);assert.equal(counts.transform,1);
  cache.draw(target,view,index,new Set());cache.draw(target,{...view,ox:20},index,new Set());assert.equal(counts.stroke,1);assert.equal(counts.transform,1);assert.equal(counts.composite,3);
  const next=make('new',[{x:0,y:20,p:.5},{x:50,y:20,p:.5}],2);index.set(next);cache.add(next);assert.equal(counts.stroke,2);
  cache.invalidate();cache.draw(target,view,index,new Set(['local']));assert.equal(counts.stroke,3);assert.equal(counts.transform,2);
});
