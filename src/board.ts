import type {Stroke} from '../server/protocol';
import {bounds,drawStroke} from './geometry.ts';
export type Rect={left:number;top:number;right:number;bottom:number};
export type View={width:number;height:number;dpr:number;scale:number;ox:number;oy:number};
const intersects=(a:Rect,b:Rect)=>a.left<=b.right&&a.right>=b.left&&a.top<=b.bottom&&a.bottom>=b.top;

/** A coarse spatial index keeps off-screen ink out of rendering and eraser work. */
export class StrokeIndex {
  entries=new Map<string,{stroke:Stroke;rect:Rect;cells:string[]}>();
  cells=new Map<string,Set<string>>();
  large=new Set<string>();
  keys(rect:Rect,limit=256):string[]|null {
    const left=Math.floor(rect.left/512),right=Math.floor(rect.right/512),top=Math.floor(rect.top/512),bottom=Math.floor(rect.bottom/512);
    if((right-left+1)*(bottom-top+1)>limit)return null;
    const keys:string[]=[];for(let x=left;x<=right;x++)for(let y=top;y<=bottom;y++)keys.push(`${x},${y}`);return keys;
  }
  set(stroke:Stroke){
    this.delete(stroke.id);const rect=bounds([stroke]);if(!rect)return;
    const keys=this.keys(rect);this.entries.set(stroke.id,{stroke,rect,cells:keys||[]});
    if(!keys){this.large.add(stroke.id);return;}
    for(const key of keys){let ids=this.cells.get(key);if(!ids){ids=new Set();this.cells.set(key,ids);}ids.add(stroke.id);}
  }
  delete(id:string){const entry=this.entries.get(id);if(!entry)return;for(const key of entry.cells){const ids=this.cells.get(key)!;ids.delete(id);if(!ids.size)this.cells.delete(key);}this.entries.delete(id);this.large.delete(id);}
  clear(){this.entries.clear();this.cells.clear();this.large.clear();}
  query(rect:Rect):Stroke[]{
    const keys=this.keys(rect,4096),ids=keys?new Set(this.large):this.entries.keys();
    if(keys)for(const key of keys)for(const id of this.cells.get(key)||[])(ids as Set<string>).add(id);
    const result:Stroke[]=[];for(const id of ids){const entry=this.entries.get(id);if(entry&&intersects(rect,entry.rect))result.push(entry.stroke);}return result;
  }
}

/** Retain saved ink as a bitmap; live ink, lasers and cursors remain separate. */
export class SavedInkCache {
  canvas:HTMLCanvasElement;
  context:CanvasRenderingContext2D;
  valid=false;
  view:View|undefined;
  rect:Rect|undefined;
  lastOrder=-Infinity;
  padding=192;
  rasterDpr=1;
  constructor(canvas:HTMLCanvasElement=document.createElement('canvas')){this.canvas=canvas;this.context=canvas.getContext('2d')!;}
  invalidate(){this.valid=false;}
  add(stroke:Stroke){
    if(!this.valid||!this.view||!this.rect)return;
    if(stroke.order<this.lastOrder){this.invalidate();return;}
    this.lastOrder=stroke.order;
    const rect=bounds([stroke]);if(rect&&intersects(rect,this.rect))drawStroke(this.context,stroke);
  }
  draw(target:CanvasRenderingContext2D,view:View,index:StrokeIndex,hidden:Set<string>){
    const previous=this.view,pad=this.padding;
    const reusable=this.valid&&previous&&previous.width===view.width&&previous.height===view.height&&previous.dpr===view.dpr&&previous.scale===view.scale&&Math.abs(view.ox-previous.ox)<=pad&&Math.abs(view.oy-previous.oy)<=pad;
    if(!reusable){
      this.view={...view};this.rect={left:(-view.ox-pad)/view.scale,top:(-view.oy-pad)/view.scale,right:(view.width-view.ox+pad)/view.scale,bottom:(view.height-view.oy+pad)/view.scale};
      const w=view.width+pad*2,h=view.height+pad*2;this.rasterDpr=Math.min(view.dpr,Math.sqrt(12e6/(w*h)));
      this.canvas.width=Math.ceil(w*this.rasterDpr);this.canvas.height=Math.ceil(h*this.rasterDpr);
      this.context.setTransform(this.rasterDpr*view.scale,0,0,this.rasterDpr*view.scale,this.rasterDpr*(view.ox+pad),this.rasterDpr*(view.oy+pad));
      const visible=index.query(this.rect).sort((a,b)=>a.order-b.order);
      for(const stroke of visible)if(!hidden.has(stroke.id))drawStroke(this.context,stroke);
      this.lastOrder=visible.at(-1)?.order??-Infinity;this.valid=true;
    }
    target.drawImage(this.canvas,view.ox-this.view!.ox-pad,view.oy-this.view!.oy-pad,this.canvas.width/this.rasterDpr,this.canvas.height/this.rasterDpr);
  }
}
