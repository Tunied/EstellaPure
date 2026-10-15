import {
    addPlugin, defineSystem, Schedule, Res, GetWorld, Input, UIEvents, Playthrough,
    Transform, Sprite, Text, Name, Assets, spawnUIEntity, createButton, UIPositionType, px, quaternionToAngle2D,
    type World, type Entity,
} from 'esengine';
import { Nav, NavAgent, NavObstacle, NavGrid, setNavDestination, type NavSurfaceUpdate, type NavGridOptions } from 'esengine/ai';

const cleanupReloads=new WeakMap<object,()=>void>();
addPlugin({ name: 'navigation-workshop', build(app) {
    const facts = { gateClosed: false, warehousePlaced: false, couriers: 8, arrived: 0, waiting: 0,
        completedPlans: 0, queuedPlans: 0, planMs: 0, leftOfGate: 8, rightOfGate: 0,
        reloadPending:false, reloadVersion:0, reloadCommitted:0, reloadCancelled:0, reloadSettled:0, reloadFailed:0 };
    app.insertResource(Playthrough, { facts });
    let agents: Entity[] = [], status: Entity | null = null, notice = 'A delivery is on its way. Try closing the gate.';
    let terrainUpdate:NavSurfaceUpdate|null=null;
    cleanupReloads.set(app,()=>{terrainUpdate?.cancel();terrainUpdate=null;});
    const reloadTerrain=async()=>{
        const nav=app.getResource(Nav),update=nav.beginSurfaceUpdate();terrainUpdate=update;
        facts.reloadPending=true;facts.reloadVersion=update.version;
        notice='Terrain loading. Couriers keep their destinations and wait. Esc cancels.';
        let release:(()=>void)|undefined;
        try{
            const lease=await app.getResource(Assets).acquireTyped<{data:NavGridOptions}>('json','@uuid:25e7e0fe-e665-4af2-ac71-777177b4c006');
            release=()=>lease.release();
            if(!update.pending)return;
            const data=lease.value.data;
            if(data.width!==23||data.height!==13||data.cellSize!==32||data.origin?.x!==-352||data.origin?.y!==-192
                ||!Array.isArray(data.walkable)||data.walkable.length!==299||!data.walkable.every(v=>v===0||v===1))throw new Error('Invalid terrain layout');
            if(update.commit(new NavGrid(data))){facts.reloadCommitted=update.version;notice='Terrain reloaded. Existing destinations and obstacles are kept.';}
        }catch{
            if(update.pending){facts.reloadFailed=update.version;notice='Terrain could not load. The previous layout is kept.';}
        }finally{
            release?.();update.cancel();
            facts.reloadSettled=Math.max(facts.reloadSettled,update.version);
            if(terrainUpdate===update){terrainUpdate=null;facts.reloadPending=false;}
        }
    };
    const cancelTerrain=()=>{
        if(terrainUpdate?.cancel()){
            facts.reloadCancelled=terrainUpdate.version;terrainUpdate=null;facts.reloadPending=false;
            notice='Terrain reload cancelled. Couriers resume on the previous layout.';
        }
    };
    const start = (i: number) => ({ x: -288+(i%3)*32, y: -96+Math.floor(i/3)*32, z: 0 });
    const goal = (i: number) => ({ x: 64+(i%5)*64, y: -128+Math.floor(i/5)*64, z: 0 });
    const obstacle = (world: World, name: string, enabled: boolean) => {
        const entity = world.findEntityByName(name); if (entity === null) return;
        world.insert(entity, NavObstacle, { ...world.get(entity, NavObstacle), enabled });
        world.insert(entity, Sprite, { ...world.get(entity, Sprite), enabled });
    };
    const syncObstacle = (world: World, name: string): boolean => {
        const entity=world.findEntityByName(name);if(entity===null)return false;
        const enabled=world.get(entity,NavObstacle).enabled,sprite=world.get(entity,Sprite);
        if(sprite.enabled!==enabled)world.insert(entity,Sprite,{...sprite,enabled});
        return enabled;
    };
    const occupied = (world: World, name: string): boolean => {
        const entity=world.findEntityByName(name);if(entity===null)return true;
        const pose=world.get(entity,Transform),origin={...pose.position},half={...world.get(entity,NavObstacle).halfExtents};
        const angle=quaternionToAngle2D(pose.rotation.z,pose.rotation.w),cos=Math.cos(angle),sin=Math.sin(angle);
        return agents.some(e=>{const p=world.get(e,Transform).position,a=world.get(e,NavAgent);
            const margin=a.radius+a.speed*.25+4;
            const dx=p.x-origin.x,dy=p.y-origin.y;
            return Math.abs(dx*cos+dy*sin)<half.x+margin&&Math.abs(-dx*sin+dy*cos)<half.y+margin;});
    };
    const dispatch = (world: World) => {
        agents.forEach((entity, i) => {
            const transform = world.get(entity, Transform); transform.position = start(i); world.insert(entity, Transform, transform);
            setNavDestination(world, entity, goal(i));
        });
        app.getResource(Nav).invalidatePaths();
    };
    const gate = (world: World) => {
        // Do not close on top of a courier; blocked actors must not be teleported.
        facts.gateClosed=syncObstacle(world,'Gate');
        if (!facts.gateClosed && occupied(world,'Gate')) {
            notice = 'Gate occupied. Let the courier clear the opening, then close it.'; return;
        }
        facts.gateClosed = !facts.gateClosed; obstacle(world, 'Gate', facts.gateClosed);
        notice = facts.gateClosed ? 'Gate closed. Couriers keep their destination and wait on this side.' : 'Gate open. Waiting couriers resume without another destination command.';
    };
    const build = (world: World) => {
        facts.warehousePlaced=syncObstacle(world,'Warehouse');
        if (!facts.warehousePlaced && occupied(world,'Warehouse')) {
            notice = 'Storehouse plot occupied. Reset the delivery or let the courier pass.'; return;
        }
        facts.warehousePlaced = !facts.warehousePlaced; obstacle(world, 'Warehouse', facts.warehousePlaced);
        notice = facts.warehousePlaced ? 'Storehouse placed. The same destinations now need a detour.' : 'Storehouse removed. The courtyard route is clear again.';
    };
    const crowd = (world: World) => {
        if (agents.length > 8) { for (const e of agents.splice(8)) world.despawn(e); }
        else {
            const template = world.get(agents[0]!, Sprite);
            for (let i = 8; i < 24; i++) {
                const e = world.spawn(`Courier ${String(i+1).padStart(2,'0')}`);
                world.insert(e, Transform, { position: start(i) });
                world.insert(e, Sprite, { ...template, color: {r:.72,g:.92,b:.94,a:1} });
                world.insert(e, NavAgent, NavAgent.create({speed:78,radius:8,arriveRadius:5,repathInterval:0}));
                agents.push(e);
            }
        }
        facts.couriers = agents.length; dispatch(world);
        notice = `${agents.length} couriers dispatched. Watch them share the gate.`;
    };
    app.addSystemToSchedule(Schedule.Startup, defineSystem([Res(Nav), Res(UIEvents), GetWorld()], (nav, events, world) => {
        const grid = new NavGrid({width:23,height:13,cellSize:32,origin:{x:-352,y:-192}});
        for (let y=0;y<13;y++) for(let x=0;x<23;x++) if(x===0||x===22||y===0||y===12||(x===11&&(y<5||y>7))) grid.setWalkable(x,y,false);
        nav.setSurface(grid);
        agents = Array.from({length:8},(_,i)=>world.findEntityByName(`Courier ${String(i+1).padStart(2,'0')}`)).filter((e):e is Entity=>e!==null);
        facts.couriers=agents.length;
        facts.gateClosed=syncObstacle(world,'Gate');facts.warehousePlaced=syncObstacle(world,'Warehouse');
        const canvas = world.findEntityByName('Canvas'); if(canvas===null)return;
        const label = (name:string,content:string,left:number,top:number,width:number,size:number,color={r:.7,g:.77,b:.8,a:1}) => {
            const e=spawnUIEntity({world,parent:canvas,node:{position:UIPositionType.Absolute,insetLeft:px(left),insetTop:px(top),width:px(width),height:px(name==='WorkshopStatus'?44:size*1.8),pointerEvents:1},
                text:{content,fontSize:size,color,align:0,bold:size>18}});
            world.insert(e,Name,{value:name});return e;
        };
        label('WorkshopTitle','CITADEL  /  ROUTE WORKSHOP',48,24,920,26,{r:.94,g:.79,b:.48,a:1});
        label('WorkshopSubtitle','Open the gate. Change the courtyard. Keep the delivery moving.',48,70,920,15);
        label('DispatchLabel','DISPATCH',172,116,150,12,{r:.48,g:.8,b:.79,a:1});
        label('DepotLabel','DELIVERY DEPOT',730,116,180,12,{r:.94,g:.79,b:.48,a:1});
        status=label('WorkshopStatus','',144,578,736,13);
        const buttons:[string,string,()=>void][]=[['GateButton','G  /  TOGGLE GATE',()=>gate(world)],['BuildButton','B  /  STOREHOUSE',()=>build(world)],['CrowdButton','C  /  8 OR 24 COURIERS',()=>crowd(world)],['ResetButton','R  /  RESET DELIVERY',()=>{dispatch(world);notice='Delivery reset. Existing gate and storehouse settings are kept.';}],
            ['ReloadButton','U  /  RELOAD TERRAIN',()=>void reloadTerrain()],['CancelReloadButton','ESC  /  CANCEL RELOAD',cancelTerrain]];
        buttons.forEach(([name,text,onClick],i)=>{
            const button=createButton({world,events,parent:canvas,node:{position:UIPositionType.Absolute,insetLeft:px(120+(i%3)*264),insetTop:px(622+Math.floor(i/3)*42),width:px(248),height:px(36)},
                text:{content:text,fontSize:12,color:{r:.94,g:.88,b:.7,a:1}},background:{color:{r:.14,g:.2,b:.25,a:1}},onClick});
            world.insert(button.entity,Name,{value:name});
        });
        label('WorkshopHelp','Gate and storehouse are editable NavObstacle entities. Select a courier during Play to inspect its route.',48,94,920,10);
    },{name:'WorkshopSetup'}));
    app.addSystem(defineSystem([Res(Nav),Res(Input),GetWorld()],(nav,input,world)=>{
        facts.gateClosed=syncObstacle(world,'Gate');facts.warehousePlaced=syncObstacle(world,'Warehouse');
        if(input.isKeyPressed('KeyG'))gate(world);
        if(input.isKeyPressed('KeyB'))build(world);
        if(input.isKeyPressed('KeyC'))crowd(world);
        if(input.isKeyPressed('KeyR')){dispatch(world);notice='Delivery reset. Existing gate and storehouse settings are kept.';}
        if(input.isKeyPressed('KeyU'))void reloadTerrain();
        if(input.isKeyPressed('Escape'))cancelTerrain();
        facts.arrived=0;facts.waiting=0;facts.leftOfGate=0;facts.rightOfGate=0;
        for(const e of agents){const agent=world.get(e,NavAgent),p=world.get(e,Transform).position;
            if(agent.arrived)facts.arrived++;else facts.waiting++;
            if(p.x<0)facts.leftOfGate++;else facts.rightOfGate++;
        }
        facts.completedPlans=nav.planningStats.completed;facts.queuedPlans=nav.planningStats.pending;facts.planMs=nav.planningStats.elapsedMs;
        if(status!==null){const content=`${facts.couriers} COURIERS   /   ${facts.arrived} DELIVERED   /   ${facts.queuedPlans} PLANS QUEUED\n${notice}`;
            if(world.get(status,Text).content!==content)world.insert(status,Text,{...world.get(status,Text),content});}
    },{name:'WorkshopControls',runAfter:['NavAgentSystem']}));
},cleanup(app){if(app){cleanupReloads.get(app)?.();cleanupReloads.delete(app);}}});
