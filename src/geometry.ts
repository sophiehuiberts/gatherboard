import type {Point,Stroke} from '../server/protocol';
export function distanceToSegment(p:Point,a:Point,b:Point):number { const dx=b.x-a.x,dy=b.y-a.y,len=dx*dx+dy*dy,t=len?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/len)):0;return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy); }
export function hitsStroke(p:Point,s:Stroke,radius:number):boolean { if(s.points.length===1)return Math.hypot(p.x-s.points[0].x,p.y-s.points[0].y)<=radius+s.width/2;for(let i=1;i<s.points.length;i++)if(distanceToSegment(p,s.points[i-1],s.points[i])<=radius+s.width/2)return true;return false; }
// Keep the full-pressure width while allowing a finer line at a light touch.
export const pressureWidth=(pressure:number)=>.15+.85*pressure;
const pointerPressureWidth=(pressure:number)=>.35+.65*pressure;
export function drawStroke(ctx:CanvasRenderingContext2D,s:Stroke,widthForPressure=pressureWidth) {
  const points=s.points;if(!points.length)return;
  ctx.strokeStyle=s.color;ctx.fillStyle=s.color;ctx.lineCap='round';ctx.lineJoin='round';
  if(points.length===1){ctx.beginPath();ctx.arc(points[0].x,points[0].y,s.width*widthForPressure(points[0].p)/2,0,Math.PI*2);ctx.fill();return;}
  for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];ctx.lineWidth=s.width*widthForPressure((a.p+b.p)/2);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
}
export function bounds(strokes:Iterable<Stroke>) { let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;for(const s of strokes)for(const p of s.points){left=Math.min(left,p.x-s.width);top=Math.min(top,p.y-s.width);right=Math.max(right,p.x+s.width);bottom=Math.max(bottom,p.y+s.width);}return Number.isFinite(left)?{left,top,right,bottom}:null; }

// Keep the white center and colored outline pressure-sensitive at every zoom.
export const POINTER_LIFETIME_MS = 3000;
export type PointerTrail={stroke:Stroke;owner:string;at:number};
export function refreshPointerTrails(trails:Map<string,PointerTrail>,owner:string,now=Date.now()) {
  for(const [id,trail] of trails){
    // Expired marks must not come back, even before the next animation frame.
    if(now-trail.at>=POINTER_LIFETIME_MS)trails.delete(id);
    else if(trail.owner===owner)trail.at=now;
  }
}

export function pointerOpacity(age:number):number { return Math.max(0,Math.min(1,(POINTER_LIFETIME_MS-age)/1000)); }
export function drawPointer(ctx:CanvasRenderingContext2D,s:Stroke,scale=1) {
  if(!s.points.length)return;
  ctx.save();
  // Paint the whole outline first so its edges cannot cross the white center.
  drawStroke(ctx,{...s,width:7/scale},pointerPressureWidth);
  drawStroke(ctx,{...s,width:3.5/scale,color:'#ffffff'},pointerPressureWidth);
  ctx.restore();
}
