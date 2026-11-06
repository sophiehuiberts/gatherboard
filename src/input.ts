/** Shared input shape for Pointer Events and WebKit's Pencil Touch Events. */
export type CanvasInput = Pick<PointerEvent,'pointerId'|'pointerType'|'button'|'buttons'|'clientX'|'clientY'|'pressure'|'timeStamp'|'type'|'preventDefault'> & {
  getCoalescedEvents?:()=>CanvasInput[];
};
type Handlers={down:(event:CanvasInput)=>void;move:(event:CanvasInput)=>void;up:(event:CanvasInput)=>void};
type PencilTouch=Touch & {touchType?:string};

export function inputPressure(event:Pick<CanvasInput,'pointerType'|'pressure'>,previous=.7) {
  if(event.pointerType!=='pen')return .7;
  return Number.isFinite(event.pressure)&&event.pressure>0?Math.min(1,Math.max(.05,event.pressure)):previous;
}

export function inputSamples(event:CanvasInput):CanvasInput[] {
  // A coalesced list can omit the dispatched event's most recent position.
  let samples:CanvasInput[]=[];
  try{samples=event.getCoalescedEvents?.()||[];}catch{}
  return [...samples,event];
}

/** Keep one ink stream per Pencil contact, even when WebKit emits both APIs. */
export function bindCanvasInput(canvas:HTMLCanvasElement,handlers:Handlers,root:EventTarget=window) {
  const pointers=new Map<number,CanvasInput>();
  let pen:{source:'pointer'|'touch';id:number;touchId?:number;last:CanvasInput}|null=null;
  const prevent=(e:Event)=>{if(e.cancelable)e.preventDefault();};
  const capture=(id:number)=>{try{canvas.setPointerCapture(id);}catch{/* Very short Pencil contacts can already have ended. */}};
  const release=(id:number)=>{try{if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);}catch{}};
  const cancelled=(e:CanvasInput):CanvasInput=>({pointerId:e.pointerId,pointerType:e.pointerType,button:e.button,buttons:0,clientX:e.clientX,clientY:e.clientY,pressure:e.pressure,timeStamp:e.timeStamp,type:'pointercancel',preventDefault:()=>{}});
  const endPen=(sample:CanvasInput)=>{const id=pen!.id;pen=null;pointers.delete(id);handlers.up(sample);release(id);};
  const pointerDown=(event:Event)=>{
    const e=event as PointerEvent;
    if(e.button!==0&&e.button!==1&&e.button!==5)return;
    prevent(e);
    if(e.pointerType==='pen'){
      if(pen?.source==='touch')return;
      // Recover if an interrupted previous contact never delivered pointerup.
      if(pen)endPen(cancelled(pen.last));
      pen={source:'pointer',id:e.pointerId,last:e};
    }
    pointers.set(e.pointerId,e);handlers.down(e);capture(e.pointerId);
  };
  const pointerMove=(event:Event)=>{
    const e=event as PointerEvent;
    if(e.pointerType==='pen'&&pen?.source==='touch')return;
    const start=pointers.get(e.pointerId);
    if(!start&&e.target!==canvas)return;
    if(start&&e.timeStamp<start.timeStamp)return;
    if(start)prevent(e);
    if(pen?.source==='pointer'&&pen.id===e.pointerId)pen.last=e;
    handlers.move(e);
  };
  const pointerUp=(event:Event)=>{
    const e=event as PointerEvent;
    if(e.pointerType==='pen'&&pen?.source==='touch')return;
    const start=pointers.get(e.pointerId);
    if(!start||e.timeStamp<start.timeStamp)return;
    prevent(e);pointers.delete(e.pointerId);
    if(pen?.id===e.pointerId)pen=null;
    handlers.up(e);release(e.pointerId);
  };
  const sample=(touch:PencilTouch,event:TouchEvent,type:string,id:number):CanvasInput=>({
    pointerId:id,pointerType:'pen',button:0,buttons:type==='pointerup'||type==='pointercancel'?0:1,
    clientX:touch.clientX,clientY:touch.clientY,pressure:touch.force,timeStamp:event.timeStamp,type,
    preventDefault:()=>prevent(event),
  });
  const touchStart=(event:Event)=>{
    const e=event as TouchEvent;prevent(e);
    for(const touch of Array.from(e.changedTouches) as PencilTouch[]){
      if(touch.touchType!=='stylus')continue;
      if(pen?.source==='touch'){
        if(pen.touchId===touch.identifier)continue;
        endPen(cancelled(pen.last));
      }
      // Pointerdown normally arrives first. Adopt its stroke instead of duplicating it.
      if(pen?.source==='pointer'){
        pen={...pen,source:'touch',touchId:touch.identifier,last:sample(touch,e,'pointerdown',pen.id)};
      }else{
        const id=-1-touch.identifier,point=sample(touch,e,'pointerdown',id);
        pen={source:'touch',id,touchId:touch.identifier,last:point};handlers.down(point);
      }
    }
  };
  const touchMove=(event:Event)=>{
    const e=event as TouchEvent;prevent(e);
    for(const touch of Array.from(e.changedTouches) as PencilTouch[]){
      if(pen?.source!=='touch'||touch.identifier!==pen.touchId)continue;
      const point=sample(touch,e,'pointermove',pen.id);pen.last=point;handlers.move(point);
    }
  };
  const touchEnd=(event:Event)=>{
    const e=event as TouchEvent;prevent(e);
    for(const touch of Array.from(e.changedTouches) as PencilTouch[]){
      if(pen?.source!=='touch'||touch.identifier!==pen.touchId)continue;
      endPen(sample(touch,e,e.type==='touchcancel'?'pointercancel':'pointerup',pen.id));
    }
  };
  canvas.addEventListener('pointerdown',pointerDown,{passive:false});
  root.addEventListener('pointermove',pointerMove,{passive:false});
  root.addEventListener('pointerup',pointerUp,{passive:false});
  root.addEventListener('pointercancel',pointerUp,{passive:false});
  canvas.addEventListener('touchstart',touchStart,{passive:false});
  canvas.addEventListener('touchmove',touchMove,{passive:false});
  canvas.addEventListener('touchend',touchEnd,{passive:false});
  canvas.addEventListener('touchcancel',touchEnd,{passive:false});
  for(const type of ['contextmenu','selectstart','dragstart','dblclick'])canvas.addEventListener(type,prevent);
  // Capture loss isn't a new pen-up. In particular, a late loss from a previous
  // contact must never finish a fresh short stroke using the same pointer ID.
  return ()=>{
    canvas.removeEventListener('pointerdown',pointerDown);
    root.removeEventListener('pointermove',pointerMove);root.removeEventListener('pointerup',pointerUp);root.removeEventListener('pointercancel',pointerUp);
    canvas.removeEventListener('touchstart',touchStart);canvas.removeEventListener('touchmove',touchMove);canvas.removeEventListener('touchend',touchEnd);canvas.removeEventListener('touchcancel',touchEnd);
    for(const type of ['contextmenu','selectstart','dragstart','dblclick'])canvas.removeEventListener(type,prevent);
    pointers.clear();pen=null;
  };
}
