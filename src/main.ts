import './style.css';
import {icon} from './icons';
import {StrokeIndex,SavedInkCache} from './board';
import {compactStroke,unpackStroke} from '../server/compact';
import {stepCursorSpring,type CursorVelocity} from './cursor';
import {bindCanvasInput,inputPressure,inputSamples,type CanvasInput} from './input';
import {bounds,drawStroke,drawPointer,pointerOpacity,POINTER_LIFETIME_MS,refreshPointerTrails,type PointerTrail,hitsStroke} from './geometry';
import {COLORS,DEFAULT_COLOR,MAX_POINTS,type Point,type Stroke} from '../server/protocol';
type Room={id:string;name:string;description:string};
type Tool='pen'|'eraser'|'pointer'|'hand';
const app=document.querySelector<HTMLDivElement>('#app')!;
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const saved=(key:string,fallback:string)=>{try{return localStorage.getItem(key)||fallback;}catch{return fallback;}};
const save=(key:string,value:string)=>{try{localStorage.setItem(key,value);}catch{}};
let rooms:Room[]=[],selected:Room|undefined,color=saved('gather-color',DEFAULT_COLOR),pointerColor=saved('gather-pointer-color',DEFAULT_COLOR),name=saved('gather-name',''),cleanup=()=>{};
if(!/^#[a-f0-9]{6}$/i.test(color))color=DEFAULT_COLOR;
if(!/^#[a-f0-9]{6}$/i.test(pointerColor))pointerColor=DEFAULT_COLOR;
const btn=(id:string,ico:string,label:string,extra='')=>`<button id="${id}" class="icon-button ${extra}" title="${label}" aria-label="${label}">${icon(ico)}</button>`;
let toastTimer:number;
function toast(message:string) { document.querySelector('.toast')?.remove();const el=document.createElement('div');el.className='toast';el.role='status';el.textContent=message;document.body.append(el);clearTimeout(toastTimer);toastTimer=window.setTimeout(()=>el.remove(),4200); }
function swatches(selectedColor=color) {return COLORS.map(c=>`<button type="button" class="swatch ${c===selectedColor?'selected':''}" data-color="${c}" style="--swatch:${c}" aria-label="${c}" aria-pressed="${c===selectedColor}">${c===selectedColor?icon('check'):''}</button>`).join('');}
function colorEvents(root:Element,callback=()=>{},kind:'ink'|'pointer'='ink') {root.querySelectorAll<HTMLElement>('[data-color]').forEach(el=>el.onclick=()=>{const chosen=el.dataset.color!;if(kind==='pointer'){pointerColor=chosen;save('gather-pointer-color',chosen);}else{color=chosen;save('gather-color',chosen);}root.innerHTML=swatches(chosen);colorEvents(root,callback,kind);callback();});}
async function lobby() {
  cleanup();selected=undefined;document.title='Gatherboard';
  app.innerHTML=`<div class="lobby"><header class="lobby-header"><h1>Gatherboard</h1></header>
  <main class="lobby-main"><h2>Rooms</h2><div id="rooms" class="room-list"><p class="loading">Loading…</p></div></main></div>`;
  try {const r=await fetch('/api/rooms');if(!r.ok)throw Error();rooms=await r.json();const grid=document.querySelector('#rooms')!;grid.innerHTML=rooms.map(r=>`<button class="room-link" data-room="${escape(r.id)}"><strong>(${escape(r.name)})</strong>${r.description?`<span class="room-sep"> // </span>${escape(r.description)}`:''}</button>`).join('');grid.querySelectorAll<HTMLElement>('[data-room]').forEach(el=>el.onclick=()=>joinDialog(rooms.find(r=>r.id===el.dataset.room)!));
    const linked=new URLSearchParams(location.search).get('room');if(linked){const room=rooms.find(r=>r.id===linked);if(room)joinDialog(room);else toast('That room doesn’t exist. Choose one below.');}
  }catch{document.querySelector('#rooms')!.innerHTML='<div class="load-error">Couldn’t load rooms. <button id="retry">Try again</button></div>';document.querySelector('#retry')?.addEventListener('click',lobby);}
}
function modal(content:string,extra='') {document.querySelector('dialog')?.remove();const dialog=document.createElement('dialog');dialog.className=extra;dialog.innerHTML=content;document.body.append(dialog);dialog.showModal();dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});dialog.addEventListener('close',()=>dialog.remove());dialog.querySelector('[data-close]')?.addEventListener('click',()=>dialog.close());return dialog;}
function joinDialog(room:Room) {
  const d=modal(`<div class="dialog-heading"><h2>${escape(room.name)}</h2><button class="icon-button" data-close aria-label="Close">${icon('close')}</button></div><form id="join-form"><label for="name">Name</label><input id="name" name="name" autocomplete="nickname" maxlength="32" required value="${escape(name)}"/><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="256"/><label>Pointer color</label><div class="swatches">${swatches(pointerColor)}</div><p class="form-error" role="alert"></p><button class="text-link join-button" type="submit">(join)</button></form>`,'page-dialog');
  colorEvents(d.querySelector('.swatches')!,()=>{},'pointer');
  d.querySelector<HTMLFormElement>('form')!.onsubmit=async e=>{e.preventDefault();const b=d.querySelector<HTMLButtonElement>('.join-button')!,error=d.querySelector('.form-error')!;b.disabled=true;b.textContent='(joining…)';error.textContent='';name=d.querySelector<HTMLInputElement>('#name')!.value.trim();try{const res=await fetch(`/api/rooms/${room.id}/join`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,password:d.querySelector<HTMLInputElement>('#password')!.value,color:pointerColor})});const data=await res.json();if(!res.ok)throw Error(data.error||'Couldn’t join this room.');save('gather-name',name);d.close();board(room);}catch(e){error.textContent=(e as Error).message;b.disabled=false;b.textContent='(join)';}};
}

function board(room:Room) {
  cleanup();selected=room;document.title=`${room.name} — Gatherboard`;history.replaceState(null,'',`?room=${room.id}`);
  app.innerHTML=`<main class="board"><canvas id="canvas" aria-label="Shared drawing canvas. Use the toolbar to choose a tool. Arrow keys pan and plus or minus zoom." tabindex="0"></canvas>
  <header class="board-header"><div class="board-brand"><button id="leave" class="text-link">(leave)</button><span class="room-sep">//</span><div><strong>${escape(room.name)}</strong><span id="connection" class="connection">Connecting…</span></div></div><div class="board-people"><div id="peers" class="avatars"></div><button id="share" class="text-link" title="Copy room link">(invite)</button></div></header>
  <aside class="tools" aria-label="Drawing tools"><div class="tool-group">${(['pen','eraser','pointer','hand'] as Tool[]).map((t,i)=>`<button class="tool ${t==='pen'?'active':''}" data-tool="${t}" title="${{pen:'Pen (A)',eraser:'Eraser (S)',pointer:'Fading pointer (D)',hand:'Pan (G)'}[t]}" aria-label="${{pen:'Pen',eraser:'Eraser',pointer:'Fading pointer',hand:'Pan'}[t]}" aria-pressed="${i===0}">${icon(t)}</button>`).join('')}</div><div class="tool-separator"></div><div class="board-swatches">${swatches()}</div><label class="custom-color" title="Choose ink color"><input id="custom-color" type="color" value="${color}" aria-label="Ink color"/>${icon('plus')}</label><div class="tool-separator"></div><button id="pointer-settings" class="pointer-color-button" style="--pointer-color:${pointerColor}" title="Pointer outline color" aria-label="Pointer outline color">${icon('pointer')}</button><div class="tool-separator"></div><div class="sizes" aria-label="Pen thickness">${[2,5,10].map((s,i)=>`<button data-size="${s}" class="size-button ${i===1?'active':''}" title="${['Fine','Medium','Thick'][i]} stroke" aria-label="${['Fine','Medium','Thick'][i]} stroke" aria-pressed="${i===1}"><span style="width:${s+2}px;height:${s+2}px"></span></button>`).join('')}</div></aside>
  <div class="board-bottom"><div class="bottom-left">${btn('undo','undo','Undo your last action (Ctrl/⌘ Z)')}${btn('help','help','Controls and shortcuts')}${btn('export','download','Export board as PNG or PDF')}${btn('clear','trash','Clear the board')}</div><div class="zoom-controls">${btn('zoom-out','minus','Zoom out')}<button id="zoom-reset" title="Reset zoom">100%</button>${btn('zoom-in','plus','Zoom in')}<span class="header-divider"></span>${btn('fit','fit','Fit drawing in view')}</div></div>
  <div id="cursors" aria-hidden="true"></div></main>`;
  const canvas=document.querySelector<HTMLCanvasElement>('#canvas')!,ctx=canvas.getContext('2d')!,boardEl=document.querySelector<HTMLElement>('.board')!;
  let ws:WebSocket|null=null,disposed=false,connected=false,retry=0,reconnectTimer=0;
  let strokes=new Map<string,Stroke>(),previews=new Map<string,{stroke:Stroke;at:number}>(),pointers=new Map<string,PointerTrail>(),cursors=new Map<string,{point:Point;target:Point;velocity:CursorVelocity;name:string;color:string;at:number}>();
  const strokeIndex=new StrokeIndex(),inkCache=new SavedInkCache();
  let snapshotTotal=0;
  function putSaved(stroke:Stroke){const previous=strokes.has(stroke.id);strokes.set(stroke.id,stroke);strokeIndex.set(stroke);if(previous)inkCache.invalidate();else inkCache.add(stroke);}
  function removeSaved(id:string){if(strokes.delete(id)){strokeIndex.delete(id);inkCache.invalidate();}}
  function resetSaved(){strokes.clear();strokeIndex.clear();inkCache.invalidate();}
  const cursorRoot=document.querySelector('#cursors')!,cursorNodes=new Map<string,{node:HTMLDivElement;label:HTMLSpanElement}>();
  let cursorFrameAt=performance.now();
  let tool:Tool='pen',width=5,scale=1,ox=innerWidth/2,oy=innerHeight/2,space=false,dirty=true,active:Stroke|null=null,activeKind:Tool='pen',drawingPointer:number|null=null;
  let lastSent=0,lastCursor=0,animation=0,gesture:{distance:number;midX:number;midY:number}|null=null,panLast:{x:number;y:number}|null=null;
  const contacts=new Map<number,{x:number;y:number;type:string}>(),erased=new Set<string>();
  const send=(data:unknown)=>{if(ws?.readyState===WebSocket.OPEN&&connected){ws.send(JSON.stringify(data));return true;}return false;};
  function setStatus(text:string,live=false){const el=document.querySelector('#connection')!;el.textContent=text;el.classList.toggle('live',live);}
  function presence(peers:{id:string;name:string;color:string}[]) {document.querySelector('#peers')!.innerHTML=peers.slice(0,5).map(p=>`<span class="avatar" title="${escape(p.name)}" style="--person:${p.color}">${escape(p.name.slice(0,1).toUpperCase())}</span>`).join('')+(peers.length>5?`<span class="avatar">+${peers.length-5}</span>`:'');if(connected)setStatus(`${peers.length} ${peers.length===1?'person':'people'}`,true);}
  function connect() {
    if(disposed)return;ws=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/api/rooms/${room.id}/socket`);
    ws.onmessage=event=>{let m;try{m=JSON.parse(event.data);}catch{return;}
      if(m.type==='init'){connected=false;resetSaved();for(const stroke of m.strokes)putSaved(unpackStroke(stroke));previews.clear();snapshotTotal=m.stats?.strokes||0;setStatus('Loading…');}
      else if(m.type==='snapshot'){for(const s of m.strokes)putSaved(unpackStroke(s));if(!connected)setStatus(`Loading… ${strokes.size.toLocaleString()}${snapshotTotal?' / '+snapshotTotal.toLocaleString():''}`);if(m.next&&ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'load',cursor:m.next}));}
      else if(m.type==='ready'){connected=true;retry=0;setStatus('Connected',true);send({type:'color',color:pointerColor});}
      else if(m.type==='presence')presence(m.peers);
      else if(m.type==='stroke'){putSaved(unpackStroke(m.stroke));previews.delete(m.stroke.id);}
      else if(m.type==='preview')previews.set(m.stroke.id,{stroke:m.stroke,at:Date.now()});
      else if(m.type==='pointer'){const now=Date.now();refreshPointerTrails(pointers,m.peerId,now);pointers.set(m.stroke.id,{stroke:m.stroke,at:now,owner:m.peerId});}
      else if(m.type==='erase'){for(const id of m.ids){removeSaved(id);previews.delete(id);}}
      else if(m.type==='clear'){resetSaved();previews.clear();active=null;pointers.clear();toast('Board cleared. A fresh start.');}
      else if(m.type==='cursor'){
        const previous=cursors.get(m.peerId),now=Date.now();
        if(previous&&now-previous.at<3500){previous.target=m.point;previous.name=m.name;previous.color=m.color;previous.at=now;}
        else cursors.set(m.peerId,{point:m.point,target:m.point,velocity:{x:0,y:0},name:m.name,color:m.color,at:now});
      }
      else if(m.type==='error')toast(m.error);
      if(m.type!=='cursor'&&m.type!=='presence'&&m.type!=='ack')dirty=true;
    };
    ws.onclose=event=>{if(disposed)return;connected=false;active=null;previews.clear();dirty=true;setStatus('Disconnected · drawing paused');if(event.code===4001){toast('Your session expired. Enter the password to rejoin.');joinDialog(room);return;}
      if(++retry>6){setStatus('Couldn’t reconnect');const d=modal(`<h2>Connection disconnected</h2><button class="text-link" id="rejoin">(rejoin)</button>`,'page-dialog disconnect-dialog');d.querySelector('#rejoin')!.addEventListener('click',()=>{d.close();joinDialog(room);});return;}
      reconnectTimer=window.setTimeout(connect,Math.min(1000*2**(retry-1),15000));};
    ws.onerror=()=>setStatus('Connection interrupted');
  }
  function resize(){const dpr=Math.min(devicePixelRatio||1,2,Math.sqrt(12e6/(innerWidth*innerHeight)));canvas.width=Math.round(innerWidth*dpr);canvas.height=Math.round(innerHeight*dpr);dirty=true;}
  function world(x:number,y:number,p=.7):Point {return{x:(x-ox)/scale,y:(y-oy)/scale,p};}
  function zoom(value:number,x=innerWidth/2,y=innerHeight/2){const next=Math.max(.08,Math.min(8,value));ox=x-(x-ox)*next/scale;oy=y-(y-oy)*next/scale;scale=next;document.querySelector('#zoom-reset')!.textContent=`${Math.round(scale*100)}%`;dirty=true;}
  function setTool(t:Tool){finish();tool=t;document.querySelectorAll<HTMLElement>('[data-tool]').forEach(el=>{const a=el.dataset.tool===t;el.classList.toggle('active',a);el.setAttribute('aria-pressed',String(a));});canvas.style.cursor=t==='hand'?'grab':t==='eraser'?'cell':'crosshair';}
  function newStroke(p:Point):Stroke{return{id:crypto.randomUUID(),points:[p],color:activeKind==='pointer'?pointerColor:color,width:activeKind==='pointer'?3:width,author:'',order:Date.now()};}
  function transmitPreview(){if(!active)return;if(activeKind==='pointer')refreshPointerTrails(pointers,'self');send({type:activeKind==='pointer'?'pointer':'preview',stroke:active});lastSent=performance.now();}
  function finish(){if(active){if(activeKind==='pointer'){const now=Date.now();refreshPointerTrails(pointers,'self',now);pointers.set(active.id,{stroke:active,at:now,owner:'self'});send({type:'pointer',stroke:active});}else if(connected){const stroke=compactStroke(active,.25/scale);previews.set(stroke.id,{stroke,at:Date.now()});send({type:'stroke',stroke});}active=null;}flushErase();drawingPointer=null;dirty=true;}
  function eraseAt(p:Point){const radius=12/scale;for(const s of strokeIndex.query({left:p.x-radius,top:p.y-radius,right:p.x+radius,bottom:p.y+radius}))if(!erased.has(s.id)&&hitsStroke(p,s,radius)){erased.add(s.id);inkCache.invalidate();if(erased.size>=100)flushErase();}if(performance.now()-lastSent>60)flushErase();dirty=true;}
  function flushErase(){if(erased.size){send({type:'erase',ids:[...erased]});for(const id of erased)removeSaved(id);erased.clear();lastSent=performance.now();}}
  function touchGesture(){const p=[...contacts.values()].filter(p=>p.type==='touch');if(p.length<2)return null;return {distance:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y),midX:(p[0].x+p[1].x)/2,midY:(p[0].y+p[1].y)/2};}
  function down(e:CanvasInput){if(e.button!==0&&e.button!==1&&e.button!==5)return;e.preventDefault();contacts.set(e.pointerId,{x:e.clientX,y:e.clientY,type:e.pointerType});
    if(e.pointerType==='touch'){if(drawingPointer!==null)return;finish();gesture=touchGesture();panLast={x:e.clientX,y:e.clientY};return;}
    if(drawingPointer!==null)return;
    if(tool==='hand'||space||e.button===1){panLast={x:e.clientX,y:e.clientY};canvas.style.cursor='grabbing';return;}
    if(!connected){toast('Waiting for the room to reconnect.');return;}
    panLast=null;gesture=null;drawingPointer=e.pointerId;activeKind=e.button===5||Boolean(e.buttons&32)?'eraser':tool;
    const p=world(e.clientX,e.clientY,inputPressure(e,.5));
    if(activeKind==='eraser')eraseAt(p);else{active=newStroke(p);transmitPreview();}dirty=true;
  }
  function move(e:CanvasInput){if(contacts.has(e.pointerId))contacts.set(e.pointerId,{x:e.clientX,y:e.clientY,type:e.pointerType});
    if(e.pointerType==='touch'){if(drawingPointer!==null)return;const next=touchGesture();if(next&&gesture){const anchor=world(gesture.midX,gesture.midY);scale=Math.max(.08,Math.min(8,scale*next.distance/Math.max(1,gesture.distance)));ox=next.midX-anchor.x*scale;oy=next.midY-anchor.y*scale;document.querySelector('#zoom-reset')!.textContent=`${Math.round(scale*100)}%`;gesture=next;}else if(next){gesture=next;}else if(panLast&&contacts.has(e.pointerId)){ox+=e.clientX-panLast.x;oy+=e.clientY-panLast.y;panLast={x:e.clientX,y:e.clientY};}dirty=true;return;}
    if(panLast&&contacts.has(e.pointerId)&&drawingPointer===null){ox+=e.clientX-panLast.x;oy+=e.clientY-panLast.y;panLast={x:e.clientX,y:e.clientY};dirty=true;return;}
    if(e.pointerId===drawingPointer&&connected){
      appendInput(e);
      if(active&&performance.now()-lastSent>45)transmitPreview();dirty=true;
    }
    if(performance.now()-lastCursor>80){send({type:'cursor',point:world(e.clientX,e.clientY)});lastCursor=performance.now();}
  }
  function appendInput(e:CanvasInput,final=false){
    for(const ev of inputSamples(e)){
      const sample={pointerType:e.pointerType,pressure:ev.pressure};
      const p=world(ev.clientX,ev.clientY,inputPressure(sample,active?.points.at(-1)?.p??.5));
      if(activeKind==='eraser'){eraseAt(p);continue;}
      if(!active)continue;
      const last=active.points.at(-1)!;
      const distance=Math.hypot(p.x-last.x,p.y-last.y)*scale;
      if(distance===0){if(!final&&sample.pressure>0)last.p=p.p;continue;}
      if(!final&&distance<.15)continue;
      active.points.push(p);
      if(active.points.length>=MAX_POINTS){const kind:Tool=activeKind;const id:number|null=drawingPointer;finish();activeKind=kind;drawingPointer=id;active=newStroke(p);}
    }
  }
  function up(e:CanvasInput){
    if(!contacts.has(e.pointerId)&&e.pointerId!==drawingPointer)return;
    contacts.delete(e.pointerId);
    if(e.pointerId===drawingPointer){
      // Quick Pencil strokes may have no pointermove at all. Preserve pen-up's
      // real endpoint, using the last contact pressure rather than the zero at lift.
      if(e.type==='pointerup'&&connected)appendInput(e,true);
      finish();
    }else if(drawingPointer!==null)return; // A lifting palm must not end the pen.
    gesture=touchGesture();panLast=null;
    if(contacts.size===1){const p=[...contacts.values()][0];if(p.type==='touch')panLast={x:p.x,y:p.y};}
    canvas.style.cursor=tool==='hand'?'grab':tool==='eraser'?'cell':'crosshair';
  }
  const wheel=(e:WheelEvent)=>{e.preventDefault();if(e.ctrlKey||e.metaKey){const maxStep=Math.log(1.2);zoom(scale*Math.exp(Math.max(-maxStep,Math.min(maxStep,-e.deltaY*.012))),e.clientX,e.clientY);}else{ox-=e.deltaX;oy-=e.deltaY;dirty=true;}};
  function render(){if(disposed)return;const now=Date.now();let fading=false;for(const [id,v] of previews)if(now-v.at>6000){previews.delete(id);dirty=true;}for(const [id,v] of pointers){if(now-v.at>=POINTER_LIFETIME_MS){pointers.delete(id);dirty=true;}else fading=true;}
    if(dirty||fading||active){const dpr=canvas.width/innerWidth;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,innerWidth,innerHeight);ctx.fillStyle='#fff';ctx.fillRect(0,0,innerWidth,innerHeight);
      const step=32*scale;if(step>9){ctx.fillStyle='#dcdcdc';for(let x=((ox%step)+step)%step;x<innerWidth;x+=step)for(let y=((oy%step)+step)%step;y<innerHeight;y+=step){ctx.beginPath();ctx.arc(x,y,.85,0,Math.PI*2);ctx.fill();}}
      inkCache.draw(ctx,{width:innerWidth,height:innerHeight,dpr,scale,ox,oy},strokeIndex,erased);ctx.save();ctx.translate(ox,oy);ctx.scale(scale,scale);for(const v of previews.values())if(!strokes.has(v.stroke.id))drawStroke(ctx,v.stroke);if(active&&activeKind!=='pointer')drawStroke(ctx,active);for(const v of pointers.values()){ctx.save();ctx.globalAlpha=pointerOpacity(now-v.at);drawPointer(ctx,v.stroke,scale);ctx.restore();}if(active&&activeKind==='pointer')drawPointer(ctx,active,scale);ctx.restore();dirty=false;
      
    }
    const frameAt=performance.now(),elapsed=frameAt-cursorFrameAt;cursorFrameAt=frameAt;
    for(const [id,c] of cursors){
      if(now-c.at>=3500){cursors.delete(id);cursorNodes.get(id)?.node.remove();cursorNodes.delete(id);continue;}
      const motion=stepCursorSpring(c.point,c.target,c.velocity,elapsed);c.point=motion.point;c.velocity=motion.velocity;
      let view=cursorNodes.get(id);
      if(!view){const node=document.createElement('div'),label=document.createElement('span');node.className='remote-cursor';node.innerHTML=icon('pointer');node.append(label);cursorRoot.append(node);view={node,label};cursorNodes.set(id,view);}
      view.node.style.transform=`translate3d(${c.point.x*scale+ox-3}px,${c.point.y*scale+oy-3}px,0)`;
      view.node.style.setProperty('--person',c.color);
      if(view.label.textContent!==c.name)view.label.textContent=c.name;
    }
    animation=requestAnimationFrame(render);
  }
  function fit(){const b=bounds(strokes.values());if(!b){ox=innerWidth/2;oy=innerHeight/2;zoom(1);return;}scale=Math.min(4,Math.max(.08,Math.min((innerWidth-200)/(b.right-b.left+60),(innerHeight-220)/(b.bottom-b.top+60))));ox=innerWidth/2-(b.left+b.right)/2*scale;oy=innerHeight/2-(b.top+b.bottom)/2*scale;document.querySelector('#zoom-reset')!.textContent=`${Math.round(scale*100)}%`;dirty=true;}
  function exportBoard(){finish();const b=bounds(strokes.values());if(!b){toast('Draw something first, then save it as a PNG.');return;}const w=b.right-b.left+80,h=b.bottom-b.top+80,factor=Math.min(2,8192/w,8192/h,Math.sqrt(16e6/(w*h))),out=document.createElement('canvas');out.width=Math.max(1,Math.ceil(w*factor));out.height=Math.max(1,Math.ceil(h*factor));const c=out.getContext('2d')!;c.fillStyle='#fff';c.fillRect(0,0,out.width,out.height);c.scale(factor,factor);c.translate(40-b.left,40-b.top);for(const s of [...strokes.values()].sort((a,b)=>a.order-b.order))drawStroke(c,s);out.toBlob(blob=>{if(!blob)return;const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${room.id}-${new Date().toISOString().slice(0,10)}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);});}
  function help(){modal(`<div class="dialog-heading"><h2>Help</h2><button class="icon-button" data-close aria-label="Close">${icon('close')}</button></div><dl class="shortcuts"><dt>Pen</dt><dd>A</dd><dt>Eraser</dt><dd>S</dd><dt>Fading pointer</dt><dd>D</dd><dt>Pan</dt><dd>G, Space + drag, middle mouse, or scroll</dd><dt>Zoom</dt><dd>Pinch, Ctrl/⌘ + scroll, or + / −</dd><dt>Undo</dt><dd>Ctrl/⌘ + Z</dd><dt>Fit to screen</dt><dd>F</dd></dl><p>On an iPad or drawing tablet, draw with the pen. Fingers pan and zoom.</p>`,'page-dialog help-dialog');}
  const keydown=(e:KeyboardEvent)=>{if((e.target as HTMLElement).matches('input,textarea')||document.querySelector('dialog[open]'))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();finish();send({type:'undo'});return;}if(e.ctrlKey||e.metaKey||e.altKey)return;const k=e.key.toLowerCase();if(k===' '){e.preventDefault();space=true;canvas.style.cursor='grab';}if(k==='a')setTool('pen');if(k==='s')setTool('eraser');if(k==='d')setTool('pointer');if(k==='g')setTool('hand');if(k==='f')fit();if(k==='='||k==='+')zoom(scale*1.2);if(k==='-')zoom(scale/1.2);if(k==='?')help();if(k.startsWith('arrow')){e.preventDefault();ox+=k==='arrowleft'?60:k==='arrowright'?-60:0;oy+=k==='arrowup'?60:k==='arrowdown'?-60:0;dirty=true;}};
  const keyup=(e:KeyboardEvent)=>{if(e.key===' '){space=false;canvas.style.cursor=tool==='hand'?'grab':'crosshair';}};
  const blur=()=>{space=false;finish();contacts.clear();panLast=null;gesture=null;};
  const unbindInput=bindCanvasInput(canvas,{down,move,up});
  const preventSelection=(e:Event)=>{if(e.cancelable)e.preventDefault();};
  boardEl.addEventListener('selectstart',preventSelection);
  canvas.addEventListener('wheel',wheel,{passive:false});
  window.addEventListener('resize',resize);window.addEventListener('keydown',keydown);window.addEventListener('keyup',keyup);window.addEventListener('blur',blur);
  document.querySelectorAll<HTMLElement>('[data-tool]').forEach(el=>el.onclick=()=>setTool(el.dataset.tool as Tool));document.querySelectorAll<HTMLElement>('[data-size]').forEach(el=>el.onclick=()=>{width=Number(el.dataset.size);document.querySelectorAll<HTMLElement>('[data-size]').forEach(b=>{const a=b===el;b.classList.toggle('active',a);b.setAttribute('aria-pressed',String(a));});});
  colorEvents(document.querySelector('.board-swatches')!,()=>{document.querySelector<HTMLInputElement>('#custom-color')!.value=color;});
  document.querySelector<HTMLInputElement>('#custom-color')!.oninput=e=>{color=(e.target as HTMLInputElement).value;save('gather-color',color);const root=document.querySelector('.board-swatches')!;root.innerHTML=swatches();colorEvents(root,()=>{document.querySelector<HTMLInputElement>('#custom-color')!.value=color;});};
  function pointerSettings(){
    const d=modal(`<div class="dialog-heading"><span class="room-symbol symbol-0">${icon('pointer')}</span><button class="icon-button" data-close aria-label="Close">${icon('close')}</button></div><h2>Your pointer color.</h2><p>White on the inside. Your color on the outside. Always separate from your ink.</p><div class="swatches">${swatches(pointerColor)}</div><label class="pointer-custom-label" for="pointer-color">Or choose any color <input id="pointer-color" type="color" value="${pointerColor}" aria-label="Custom pointer outline color"/></label><div class="pointer-sample" style="--pointer-color:${pointerColor}"><span></span>Fades away in 3 seconds</div>`);
    const update=()=>{save('gather-pointer-color',pointerColor);send({type:'color',color:pointerColor});document.querySelector<HTMLElement>('#pointer-settings')!.style.setProperty('--pointer-color',pointerColor);d.querySelector<HTMLElement>('.pointer-sample')!.style.setProperty('--pointer-color',pointerColor);d.querySelector<HTMLInputElement>('#pointer-color')!.value=pointerColor;};
    const root=d.querySelector('.swatches')!;colorEvents(root,update,'pointer');
    d.querySelector<HTMLInputElement>('#pointer-color')!.oninput=e=>{pointerColor=(e.target as HTMLInputElement).value;root.innerHTML=swatches(pointerColor);colorEvents(root,update,'pointer');update();};
  }
  async function exportPdf(){
    finish();const snapshot=[...strokes.values()];if(!snapshot.length){toast('Draw something first, then save it as a PDF.');return;}
    try{const {createBoardPdf}=await import('./pdf');const doc=createBoardPdf(snapshot,room.name);await doc.save(`${room.id}-${new Date().toISOString().slice(0,10)}.pdf`,{returnPromise:true});}catch{toast('Couldn’t export the PDF. Please try again.');}
  }
  function exportDialog(){
    const d=modal(`<div class="dialog-heading"><span class="room-symbol symbol-0">${icon('download')}</span><button class="icon-button" data-close aria-label="Close">${icon('close')}</button></div><h2>Take your ideas with you.</h2><p>Export the full saved drawing. Pointer trails and cursors stay behind.</p><div class="export-options"><button class="secondary" id="export-png">Download PNG <small>A picture of your board</small></button><button class="primary" id="export-pdf">Download PDF <small>Sharp at any size · fits one page</small></button></div>`);
    d.querySelector('#export-png')!.addEventListener('click',()=>{d.close();exportBoard();});d.querySelector('#export-pdf')!.addEventListener('click',()=>{d.close();void exportPdf();});
  }
  const click=(id:string,fn:()=>void)=>document.getElementById(id)!.addEventListener('click',fn);
  click('leave',()=>{history.replaceState(null,'',location.pathname);lobby();});const invite=()=>{navigator.clipboard.writeText(`${location.origin}/?room=${room.id}`).then(()=>toast('Room link copied. Share the password separately.')).catch(()=>toast(`Room link: ${location.origin}/?room=${room.id}`));};click('share',invite);click('zoom-in',()=>zoom(scale*1.25));click('zoom-out',()=>zoom(scale/1.25));click('zoom-reset',()=>zoom(1));click('fit',fit);click('undo',()=>{finish();send({type:'undo'});});click('help',help);click('export',exportDialog);click('pointer-settings',pointerSettings);
  click('clear',()=>{const d=modal(`<h2>A fresh page?</h2><p>This clears the saved drawing for everyone in the room. Download a copy first if you want to keep it.</p><div class="dialog-actions"><button class="secondary" data-close>Keep drawing</button><button class="danger" id="confirm-clear">Clear for everyone</button></div>`);d.querySelector('#confirm-clear')!.addEventListener('click',()=>{if(!send({type:'clear'}))toast('Reconnect before clearing the board.');d.close();});});
  cleanup=()=>{unbindInput();boardEl.removeEventListener('selectstart',preventSelection);disposed=true;clearTimeout(reconnectTimer);ws?.close();cancelAnimationFrame(animation);window.removeEventListener('resize',resize);window.removeEventListener('keydown',keydown);window.removeEventListener('keyup',keyup);window.removeEventListener('blur',blur);document.querySelector('dialog')?.remove();};
  resize();setTool('pen');connect();render();
}
lobby();
