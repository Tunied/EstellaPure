export interface Placement { x: number; z: number; rotation: number; kind: 'platform' | 'purifier' }
export const costs = { platform: { steel: 4, circuits: 2 }, purifier: { steel: 8, circuits: 4 } };
export const home = { x: 6, y: 1.8, z: 13.5, yaw: .26, pitch: -.07 };
export function footprint(rotation: number, kind: Placement['kind']) {
    if (kind === 'purifier') return { x: .9, z: .75 };
    return rotation % 2 === 0 ? { x: 3.4, z: 2.1 } : { x: 2.1, z: 3.4 };
}
export function canPlace(p: Placement, placed: Placement[]) {
    const half = footprint(p.rotation, p.kind);
    if (p.x-half.x < -18 || p.x+half.x > 17 || p.z-half.z < -17 || p.z+half.z > 20) return false;
    // Occupied safehouse / utility area and foreground supply stacks.
    const obstacles = [
        {x:-6.5,z:-5.7,hx:10.2,hz:5.2}, {x:5.7,z:-5,hx:3.6,hz:4},
        {x:-15,z:3,hx:2.3,hz:3}, {x:15.7,z:8,hx:2.2,hz:3},
        {x:1.3,z:11,hx:.8,hz:.7},{x:-2.2,z:8.5,hx:.8,hz:.7},
        {x:9.7,z:9,hx:1.8,hz:.7},
    ];
    if (obstacles.some(o => Math.abs(o.x-p.x)<o.hx+half.x && Math.abs(o.z-p.z)<o.hz+half.z)) return false;
    return !placed.some(o => { const other=footprint(o.rotation,o.kind);return Math.abs(o.x-p.x)<other.x+half.x+.12 && Math.abs(o.z-p.z)<other.z+half.z+.12; });
}
export function canWalk(x:number,z:number,placed:Placement[]) {
    if(x < -18 || x>17 || z< -17 || z>20) return false;
    if(x>-17.3 && x<3.9 && z>-10 && z<-.4) return false;
    if(x>2.6 && x<9 && z>-9 && z<-1.5) return false;
    if(x>.3 && x<2.3 && z>10.1 && z<11.9) return false;
    if(x>-3.2 && x<-1.2 && z>7.6 && z<9.4) return false;
    if(x>7.7 && x<11.7 && z>8.1 && z<9.9) return false;
    // Platforms remain walkable; full-height water filters block the player.
    return !placed.some(p=>p.kind==='purifier' && Math.abs(p.x-x)<1.1 && Math.abs(p.z-z)<1.0);
}
