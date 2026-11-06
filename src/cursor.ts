import type {Point} from '../server/protocol';

export type CursorVelocity={x:number;y:number};

/** Exact critically damped spring: preserve momentum when a packet retargets it. */
export function stepCursorSpring(point:Point,target:Point,velocity:CursorVelocity,elapsedMs:number) {
  if(elapsedMs<=0)return {point,velocity};
  // A suspended tab should resume at the latest position, not replay old motion.
  if(elapsedMs>=250)return {point:{...target},velocity:{x:0,y:0}};
  const seconds=elapsedMs/1000,frequency=55,decay=Math.exp(-frequency*seconds);
  const axis=(position:number,destination:number,speed:number)=>{
    const offset=position-destination,impulse=speed+frequency*offset;
    return {
      position:destination+(offset+impulse*seconds)*decay,
      speed:(speed-frequency*impulse*seconds)*decay,
    };
  };
  const x=axis(point.x,target.x,velocity.x),y=axis(point.y,target.y,velocity.y);
  if(Math.hypot(x.position-target.x,y.position-target.y)<.00001&&Math.hypot(x.speed,y.speed)<.001){
    return {point:{...target},velocity:{x:0,y:0}};
  }
  return {point:{x:x.position,y:y.position,p:target.p},velocity:{x:x.speed,y:y.speed}};
}
