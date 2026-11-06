import { jsPDF } from 'jspdf';
import { bounds,pressureWidth } from './geometry.ts';
import type { Stroke } from '../server/protocol';

/** Fit all saved ink onto one A4 sheet, preserving vector lines and pen pressure. */
export function createBoardPdf(strokes:Stroke[],title:string) {
  const b=bounds(strokes);
  if(!b)throw Error('Draw something before exporting.');
  const w=b.right-b.left,h=b.bottom-b.top;
  const doc=new jsPDF({orientation:w>h?'landscape':'portrait',unit:'pt',format:'a4',compress:true,floatPrecision:5,putOnlyUsedFonts:true});
  doc.setProperties({title,subject:'Shared whiteboard',creator:'Gatherboard'});
  const pageWidth=doc.internal.pageSize.getWidth(),pageHeight=doc.internal.pageSize.getHeight(),margin=28;
  const factor=Math.min((pageWidth-2*margin)/Math.max(w,1),(pageHeight-2*margin)/Math.max(h,1));
  const x=(value:number)=>(pageWidth-w*factor)/2+(value-b.left)*factor;
  const y=(value:number)=>(pageHeight-h*factor)/2+(value-b.top)*factor;
  doc.setFillColor('#f8f7f3');doc.rect(0,0,pageWidth,pageHeight,'F');
  doc.setLineCap('round');doc.setLineJoin('round');
  for(const s of [...strokes].sort((a,b)=>a.order-b.order)) {
    doc.setDrawColor(s.color);doc.setFillColor(s.color);
    if(s.points.length===1){const p=s.points[0];doc.circle(x(p.x),y(p.y),s.width*pressureWidth(p.p)*factor/2,'F');continue;}
    for(let i=1;i<s.points.length;i++){
      const a=s.points[i-1],b=s.points[i];
      doc.setLineWidth(s.width*pressureWidth((a.p+b.p)/2)*factor);
      doc.line(x(a.x),y(a.y),x(b.x),y(b.y));
    }
  }
  return doc;
}
