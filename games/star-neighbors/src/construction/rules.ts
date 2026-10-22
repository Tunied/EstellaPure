export const modules=[
  {id:'floor-2m',title:'地板',width:2,depth:2,parts:['ivory','steel']},
  {id:'planter',title:'种植箱',width:2,depth:1.1,parts:['ivory','orange','steel','cyan','soil']},
  {id:'crate',title:'储物箱',width:1.02,depth:.8,parts:['ivory','orange','steel','rubber','cyan']},
] as const;
export type Placement={x:number;z:number;rotation:number;kind:number};
type Bounds={x:number;z:number;w:number;d:number};
const occupied:Bounds[]=[
  {x:-5,z:-2,w:6.2,d:4.2},{x:-9.4,z:-1.2,w:2.2,d:2.2},
  {x:6.3,z:-1.8,w:5.1,d:3.5},{x:-6.7,z:4.1,w:2.1,d:1.2},
  {x:-9,z:2.2,w:2.6,d:1.8},{x:-2.6,z:4.7,w:2.6,d:1.8},
  {x:-.8,z:-.3,w:2.4,d:1.8},{x:2.7,z:1.9,w:1.4,d:1.1},
];
export const snap=(n:number)=>Math.round(n/2)*2;
export function bounds(p:Placement):Bounds {
  const m=modules[p.kind],odd=p.rotation%2!==0;
  return {x:p.x,z:p.z,w:odd?m.depth:m.width,d:odd?m.width:m.depth};
}
const overlaps=(a:Bounds,b:Bounds)=>Math.abs(a.x-b.x)<(a.w+b.w)/2-.005&&Math.abs(a.z-b.z)<(a.d+b.d)/2-.005;
export function placementReason(p:Placement,placed:Placement[]) {
  if(!Number.isInteger(p.kind)||!modules[p.kind]||![p.x,p.z,p.rotation].every(Number.isFinite))return '请选择有效部件';
  const b=bounds(p);
  if(p.x!==snap(p.x)||p.z!==snap(p.z))return '请对齐 2 米网格';
  if(Math.abs(p.x)+b.w/2>10||p.z-b.d/2<2.6||p.z+b.d/2>11)return '请在前方庭院内建造';
  if(occupied.some(o=>overlaps(b,o))||placed.some(o=>overlaps(b,bounds(o))))return '这里已被占用，移动一格试试';
  if(placed.length>=8)return '样区的 8 个展示位置已用完，可撤回重摆';
  return '';
}
