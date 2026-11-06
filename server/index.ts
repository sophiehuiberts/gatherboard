import { DurableObject } from 'cloudflare:workers';
import roomSettings from '../rooms.config.json';
const config: {rooms:{id:string;name:string;description?:string;password:string}[]} = roomSettings;
import { MAX_STROKES, MAX_BOARD_POINTS, validColor, validPoint, validStroke, type Stroke } from './protocol';
import {BoardStore,type BoardCursor} from './board-store';
interface Env { ROOMS: DurableObjectNamespace<BoardRoom>; ASSETS: Fetcher }
type Session = { id: string; name: string; color: string; expires: number; version: string };
type Peer = Session & { peerId: string; count: number; window: number };
type Action = { added?: string; removed?: string[] };
const json = (data: unknown, status = 200) => Response.json(data, {status, headers: {'Cache-Control':'no-store'}});
async function digest(s: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join(''); }
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/rooms' && request.method === 'GET') return json(config.rooms.map(({id,name,description})=>({id,name,description})));
    const match = url.pathname.match(/^\/api\/rooms\/([a-z0-9-]+)\/(join|socket)$/);
    if (match) {
      const room = config.rooms.find(r=>r.id===match[1]);
      if (!room) return json({error:'That room does not exist.'},404);
      if (request.headers.get('Origin') !== url.origin) return json({error:'Please open the app directly to join.'},403);
      if (Number(request.headers.get('Content-Length') || 0)>4096) return json({error:'Request too large.'},413);
      return env.ROOMS.get(env.ROOMS.idFromName(room.id)).fetch(request);
    }
    if (url.pathname.startsWith('/api/')) return json({error:'Not found.'},404);
    const response = await env.ASSETS.fetch(request);
    const secured = new Response(response.body,response);
    secured.headers.set('X-Content-Type-Options','nosniff');
    secured.headers.set('Referrer-Policy','no-referrer');
    secured.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    return secured;
  }
} satisfies ExportedHandler<Env>;

export class BoardRoom extends DurableObject<Env> {
  board:BoardStore;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx,env);
    this.board=new BoardStore(ctx.storage.sql,callback=>ctx.storage.transactionSync(callback));
    ctx.blockConcurrencyWhile(async()=> {
      if(this.board.migrated)return;
      let after:string|undefined;
      while(true){
        const batch=await ctx.storage.list<Stroke>({prefix:'stroke:',limit:128,...(after?{startAfter:after}:{})});
        if(!batch.size)break;
        for(const stroke of batch.values())this.board.insert(stroke);
        after=[...batch.keys()].at(-1);
      }
      // Keep legacy records as a migration backup; this marker prevents re-import.
      this.board.markMigrated();
    });
  }
  broadcast(data: unknown, except?: WebSocket) { const wire = JSON.stringify(data); for (const ws of this.ctx.getWebSockets()) { if(ws!==except) try {ws.send(wire);} catch {} } }
  presence() { this.broadcast({type:'presence',peers:this.ctx.getWebSockets().map(ws=> {const p=ws.deserializeAttachment() as Peer;return {id:p.peerId,name:p.name,color:p.color};})}); }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url), room = config.rooms.find(r=>r.id===url.pathname.split('/')[3])!;
    const version = await digest(room.password);
    if (url.pathname.endsWith('/join') && request.method==='POST') {
      const ip = request.headers.get('CF-Connecting-IP') || 'local';
      const now = Date.now();
      const attemptKey=`attempt:${await digest(ip)}`;
      let attempt=await this.ctx.storage.get<{count:number;at:number}>(attemptKey) || {count:0,at:now};
      if(now-attempt.at>60000)attempt={count:0,at:now};
      attempt.count++;await this.ctx.storage.put(attemptKey,attempt);
      if(!await this.ctx.storage.getAlarm())await this.ctx.storage.setAlarm(now+60*60*1000);
      if (attempt.count>10) return json({error:'Too many attempts. Try again in a minute.'},429);
      let body; try {const text=await request.text();if(text.length>2048) return json({error:'Request too large.'},413); body=JSON.parse(text);} catch {return json({error:'Invalid request.'},400);}
      if(typeof body.password!=='string' || await digest(body.password)!==version) return json({error:'That password doesn’t match. Give it another try.'},401);
      const name=typeof body.name==='string'?body.name.trim().slice(0,32):'';
      if (!name) return json({error:'Enter a name so everyone knows it’s you.'},400);
      const token = crypto.randomUUID();
      const session:Session={id:crypto.randomUUID(),name,color:validColor(body.color)?body.color:'#789542',expires:now+12*60*60*1000,version};
      await this.ctx.storage.put(`session:${token}`,session);
      if(!await this.ctx.storage.getAlarm()) await this.ctx.storage.setAlarm(now+60*60*1000);
      const headers=new Headers({'Content-Type':'application/json','Cache-Control':'no-store'});
      headers.set('Set-Cookie',`gather_${room.id}=${token}; HttpOnly; SameSite=Strict; Path=/api/rooms/${room.id}/; Max-Age=43200${url.protocol==='https:'?'; Secure':''}`);
      return new Response(JSON.stringify({name,color:session.color}),{headers});
    }
    if (!url.pathname.endsWith('/socket') || request.headers.get('Upgrade')?.toLowerCase()!=='websocket') return json({error:'WebSocket required.'},426);
    const cookie=request.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(`gather_${room.id}=`))?.split('=')[1];
    const session=cookie?await this.ctx.storage.get<Session>(`session:${cookie}`):undefined;
    if(!session || session.expires<Date.now() || session.version!==version) return json({error:'Please join the room again.'},401);
    if(this.ctx.getWebSockets().length>=40) return json({error:'This room is full (40 people).'},503);
    const [client,server]=Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    const peer:Peer={...session,peerId:crypto.randomUUID(),count:0,window:Date.now()};
    server.serializeAttachment(peer);
    server.send(JSON.stringify({type:'init',self:{id:peer.peerId,name:peer.name,color:peer.color},strokes:[],stats:this.board.stats}));
    this.sendSnapshot(server);
    this.presence();
    return new Response(null,{status:101,webSocket:client});
  }
  sendSnapshot(ws:WebSocket,after?:BoardCursor){
    const {rows,next}=this.board.snapshot(after);
    if(!rows.length){ws.send(JSON.stringify({type:'ready',stats:this.board.stats}));return;}
    ws.send(`{"type":"snapshot","strokes":[${rows.map(r=>r.data).join(',')}],"next":${JSON.stringify(next)}}`);
  }
  async removeKeys(keys:string[]) {for(let i=0;i<keys.length;i+=128)await this.ctx.storage.delete(keys.slice(i,i+128));}
  async removePrefix(prefix:string){
    let after:string|undefined;
    while(true){const batch=await this.ctx.storage.list({prefix,limit:64,...(after?{startAfter:after}:{})});if(!batch.size)break;const keys=[...batch.keys()];after=keys.at(-1);await this.removeKeys(keys);}
  }
  async remember(id: string, action: Action) { const key=`history:${id}`,history=await this.ctx.storage.get<Action[]>(key)||[];history.push(action);while(history.length>30||JSON.stringify(history).length>100000){const old=history.shift();if(old?.removed)await this.removeKeys(old.removed);}await this.ctx.storage.put(key,history); }
  async webSocketMessage(ws: WebSocket, raw: string|ArrayBuffer) {
    const peer=ws.deserializeAttachment() as Peer;
    if(peer.expires<Date.now()) {ws.close(4001,'Session expired. Join again.');return;}
    if(typeof raw!=='string'||raw.length>65536) {ws.close(1009,'Message too large');return;}
    const now=Date.now();if(now-peer.window>=1000){peer.window=now;peer.count=0;}
    if(++peer.count>100){ws.close(1008,'Sending too fast');return;}
    ws.serializeAttachment(peer);
    let m; try {m=JSON.parse(raw);}catch{return;}if(!m||typeof m!=='object')return;
    if(m.type==='load'&&m.cursor&&typeof m.cursor.id==='string'&&m.cursor.id.length<=80&&Number.isFinite(m.cursor.order)){
      this.sendSnapshot(ws,m.cursor);return;
    }
    if(m.type==='preview'||m.type==='pointer'||m.type==='stroke') {
      if(!validStroke(m.stroke)) return;
      const stroke:Stroke={id:m.stroke.id,points:m.stroke.points,width:m.stroke.width,color:m.type==='pointer'?peer.color:m.stroke.color,author:peer.id,order:now};
      if(m.type!=='stroke') {this.broadcast({type:m.type,stroke,peerId:peer.peerId,name:peer.name,at:now},ws);return;}
      if(this.board.has(stroke.id)) {ws.send(JSON.stringify({type:'ack',id:stroke.id}));return;}
      if(this.board.stats.strokes>=MAX_STROKES||this.board.stats.points+stroke.points.length>MAX_BOARD_POINTS) {ws.send(JSON.stringify({type:'error',error:'The board is full. Erase some strokes or export and clear it.'}));return;}
      stroke.order=Math.max(now,this.board.lastOrder+1);this.board.insert(stroke);
      await this.remember(peer.id,{added:stroke.id});
      this.broadcast({type:'stroke',stroke});
    } else if(m.type==='erase' && Array.isArray(m.ids) && m.ids.length<=100) {
      const removed:Stroke[]=[...new Set<string>(m.ids.filter((id:unknown)=>typeof id==='string'))].map((id:string)=>this.board.get(id)).filter((s):s is Stroke=>s!==undefined);
      if(!removed.length)return;
      const keys:string[]=[];const actionId=crypto.randomUUID();
      for(const s of removed){const key=`undo:${peer.id}:${actionId}:${s.id}`;await this.ctx.storage.put(key,s);keys.push(key);}
      this.board.remove(removed.map(s=>s.id));
      await this.remember(peer.id,{removed:keys});this.broadcast({type:'erase',ids:removed.map(s=>s.id)});
    } else if(m.type==='undo') {
      const key=`history:${peer.id}`,history=await this.ctx.storage.get<Action[]>(key)||[],action=history.pop();if(!action)return;
      await this.ctx.storage.put(key,history);
      if(action.added && this.board.has(action.added)) {this.board.remove([action.added]);this.broadcast({type:'erase',ids:[action.added]});}
      if(action.removed) for(const key of action.removed) {const stroke=await this.ctx.storage.get<Stroke>(key);await this.ctx.storage.delete(key);if(!stroke||this.board.has(stroke.id)||this.board.stats.strokes>=MAX_STROKES||this.board.stats.points+stroke.points.length>MAX_BOARD_POINTS)continue;this.board.insert(stroke);this.broadcast({type:'stroke',stroke});}
    } else if(m.type==='cursor' && validPoint(m.point)) {
      this.broadcast({type:'cursor',peerId:peer.peerId,name:peer.name,color:peer.color,point:m.point},ws);
    } else if(m.type==='color' && validColor(m.color)) {
      peer.color=m.color;ws.serializeAttachment(peer);this.presence();
    } else if(m.type==='clear') {
      this.board.clear();
      await this.removePrefix('history:');await this.removePrefix('undo:');
      this.broadcast({type:'clear'});
    }
  }
  webSocketClose(ws: WebSocket,code:number) { try{ws.close(code);}catch{} this.presence(); }
  webSocketError(ws: WebSocket) {try{ws.close(1011,'Connection interrupted');}catch{} this.presence();}
  async alarm() {
    const sessions=await this.ctx.storage.list<Session>({prefix:'session:'});
    for(const [key,s] of sessions) if(s.expires<Date.now()) {await this.ctx.storage.delete(key);await this.ctx.storage.delete(`history:${s.id}`);await this.removePrefix(`undo:${s.id}:`);}
    const attempts=await this.ctx.storage.list<{at:number}>({prefix:'attempt:'});for(const [key,a] of attempts)if(Date.now()-a.at>60000)await this.ctx.storage.delete(key);
    if([...sessions.values()].some(s=>s.expires>=Date.now()))await this.ctx.storage.setAlarm(Date.now()+60*60*1000);
  }
}
