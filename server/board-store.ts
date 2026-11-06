import {packStroke,unpackStroke} from './compact.ts';
import type {Stroke} from './protocol';
export type BoardCursor={order:number;id:string};
type Row={id:string;sort_order:number;points:number;data:string};
type Stats={strokes:number;points:number};

/** Geometry stays on disk. Loading or editing a board never builds a room-sized heap. */
export class BoardStore {
  sql:SqlStorage;
  transaction:<T>(callback:()=>T)=>T;
  constructor(sql:SqlStorage,transaction:<T>(callback:()=>T)=>T){
    this.sql=sql;this.transaction=transaction;
    sql.exec('CREATE TABLE IF NOT EXISTS board_strokes (id TEXT PRIMARY KEY, sort_order REAL NOT NULL, points INTEGER NOT NULL, data TEXT NOT NULL)');
    sql.exec('CREATE INDEX IF NOT EXISTS board_strokes_order ON board_strokes(sort_order,id)');
    sql.exec('CREATE TABLE IF NOT EXISTS board_meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL)');
    sql.exec("INSERT OR IGNORE INTO board_meta(key,value) VALUES ('strokes',0),('points',0)");
  }
  get stats():Stats {const rows=this.sql.exec<{key:string;value:number}>("SELECT key,value FROM board_meta WHERE key IN ('strokes','points')").toArray();return Object.fromEntries(rows.map(r=>[r.key,r.value])) as Stats;}
  get migrated(){return this.sql.exec("SELECT value FROM board_meta WHERE key='legacy_imported'").toArray().length>0;}
  markMigrated(){this.sql.exec("INSERT OR REPLACE INTO board_meta(key,value) VALUES ('legacy_imported',1)");}
  get lastOrder(){return this.sql.exec<{value:number}>('SELECT COALESCE(MAX(sort_order),0) AS value FROM board_strokes').one().value;}
  has(id:string){return this.sql.exec('SELECT id FROM board_strokes WHERE id=?',id).toArray().length>0;}
  get(id:string):Stroke|undefined {const row=this.sql.exec<Row>('SELECT * FROM board_strokes WHERE id=?',id).toArray()[0];return row?unpackStroke(JSON.parse(row.data)):undefined;}
  insert(stroke:Stroke){return this.transaction(()=>{
    const rows=this.sql.exec('INSERT OR IGNORE INTO board_strokes(id,sort_order,points,data) VALUES (?,?,?,?) RETURNING id',stroke.id,stroke.order,stroke.points.length,JSON.stringify(packStroke(stroke))).toArray();
    if(!rows.length)return false;
    this.sql.exec("UPDATE board_meta SET value=value+1 WHERE key='strokes'");
    this.sql.exec("UPDATE board_meta SET value=value+? WHERE key='points'",stroke.points.length);return true;
  });}
  remove(ids:string[]){if(!ids.length)return;this.transaction(()=>{
    const params=ids.map(()=>'?').join(','),removed=this.sql.exec<{points:number}>(`DELETE FROM board_strokes WHERE id IN (${params}) RETURNING points`,...ids).toArray();
    this.sql.exec("UPDATE board_meta SET value=value-? WHERE key='strokes'",removed.length);
    this.sql.exec("UPDATE board_meta SET value=value-? WHERE key='points'",removed.reduce((n,r)=>n+r.points,0));
  });}
  clear(){this.transaction(()=>{this.sql.exec('DELETE FROM board_strokes');this.sql.exec("UPDATE board_meta SET value=0 WHERE key IN ('strokes','points')");});}
  page(after?:BoardCursor,limit=128):Row[]{
    return after?this.sql.exec<Row>('SELECT * FROM board_strokes WHERE (sort_order,id)>(?,?) ORDER BY sort_order,id LIMIT ?',after.order,after.id,limit).toArray():this.sql.exec<Row>('SELECT * FROM board_strokes ORDER BY sort_order,id LIMIT ?',limit).toArray();
  }
  snapshot(after?:BoardCursor){
    const rows:Row[]=[];let cursor=after,points=0,done=false;
    while(rows.length<1024&&!done){
      const batch=this.page(cursor,Math.min(128,1024-rows.length));
      if(!batch.length)break;
      for(const row of batch){
        if(rows.length&&points+row.points>24000){done=true;break;}
        rows.push(row);points+=row.points;cursor={order:row.sort_order,id:row.id};
      }
    }
    return {rows,next:rows.length?cursor:undefined};
  }
}
