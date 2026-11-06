import type {Point,Stroke} from './protocol';

/** Remove subpixel samples, keeping endpoints, corners, and pressure changes. */
export function compactStroke(stroke:Stroke,tolerance=.25):Stroke {
  const points=stroke.points;
  if(points.length<=2)return stroke;
  const keep=new Uint8Array(points.length);keep[0]=1;keep[points.length-1]=1;
  const stack:[number,number][]=[[0,points.length-1]];
  while(stack.length){
    const [first,last]=stack.pop()!,a=points[first],b=points[last];
    const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
    let greatest=1,selected=-1;
    for(let i=first+1;i<last;i++){
      const p=points[i],t=length?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length)):(i-first)/(last-first);
      const distance=Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy)/Math.max(tolerance,1e-8);
      const pressure=Math.abs(p.p-(a.p+(b.p-a.p)*t))/.025;
      const error=Math.max(distance,pressure);
      if(error>greatest){greatest=error;selected=i;}
    }
    if(selected!==-1){keep[selected]=1;stack.push([first,selected],[selected,last]);}
  }
  return {...stroke,points:points.filter((_,i)=>keep[i])};
}

export type PackedStroke=Omit<Stroke,'points'> & {points:number[]};
export function packStroke(stroke:Stroke):PackedStroke {
  const points:number[]=[];
  for(const p of stroke.points)points.push(Math.round(p.x*1e4)/1e4,Math.round(p.y*1e4)/1e4,Math.round(p.p*1e4)/1e4);
  return {...stroke,points};
}
export function unpackStroke(stroke:PackedStroke|Stroke):Stroke {
  if(typeof stroke.points[0]!=='number')return stroke as Stroke;
  const packed=stroke.points as number[],points:Point[]=[];
  for(let i=0;i<packed.length;i+=3)points.push({x:packed[i],y:packed[i+1],p:packed[i+2]});
  return {...stroke,points};
}
