import test from 'node:test';
import assert from 'node:assert/strict';
import {createBoardPdf} from '../src/pdf.ts';
const stroke=(points)=>({id:'pdf-test',color:'#3e83b7',width:5,points:points.map(([x,y,p=.7])=>({x,y,p})),author:'test',order:0});
test('PDF fits negative coordinates, preserves vector geometry, and selects landscape for a wide board',()=>{
  const doc=createBoardPdf([stroke([[-1000,-800,.2],[500,-300,1],[1400,-900,.5]])],'Test room');
  assert.equal(doc.getNumberOfPages(),1);
  assert.ok(doc.internal.pageSize.getWidth()>doc.internal.pageSize.getHeight());
  const output=doc.output();assert.ok(output.startsWith('%PDF-'));assert.ok(output.endsWith('%%EOF'));assert.ok(!output.includes('/Subtype /Image'));assert.ok(!output.includes('NaN'));assert.ok(!output.includes('Infinity'));
});
test('PDF handles a single pressure-sensitive dot and rejects an empty board',()=>{
  const doc=createBoardPdf([stroke([[-1e6,1e6,.2]])],'A dot');
  assert.equal(doc.getNumberOfPages(),1);assert.ok(doc.internal.pageSize.getHeight()>doc.internal.pageSize.getWidth());assert.throws(()=>createBoardPdf([],'Empty'),/Draw something/);
});
