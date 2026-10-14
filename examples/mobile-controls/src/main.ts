import {
    addStartupSystem, addSystemToSchedule, defineSystem, Schedule, Res, GetWorld,
    Input, InputMap, Axis2D, Button, Keys2D, Key, Virtual, Time, Transform, Sprite,
    UIEvents, Text, Name, UINode, UIPositionType, spawnUIEntity, createButton, px, Device,
    type Entity, type DeviceResult,
} from 'esengine';

const controls = new InputMap({ Move: Axis2D(Keys2D('KeyW', 'KeyS', 'KeyA', 'KeyD'), Virtual('move')),
    Fire: Button(Key('Space'), Virtual('fire')) });
let tilt = { x: 0, y: 0 };
let motion = false;
let status: Entity | null = null;
let message = 'Drag the left stick and hold Fire. WASD / Space also work.';
let hits = 0;
let hitFlash = 0;
let recoil = 0;
let misses = 0;
const report = (name: string) => (result: DeviceResult) => { message = `${name}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`; };

addStartupSystem(defineSystem([Res(UIEvents), GetWorld()], (events, world) => {
    const canvas = world.findEntityByName('Canvas'); if (canvas === null) return;
    spawnUIEntity({ world, parent: canvas,
        node: { position: UIPositionType.Absolute, insetLeft: px(30), insetTop: px(6), width: px(740), height: px(22), pointerEvents: 1 },
        text: { content: 'DUNGEON TRAINING     /     MOBILE CONTROLS', fontSize: 17, bold: true, color: { r: 1, g: 0.76, b: 0.41, a: 1 } } });
    status = spawnUIEntity({ world, parent: canvas,
        node: { position: UIPositionType.Absolute, insetLeft: px(30), insetTop: px(78), width: px(740), height: px(32) },
        text: { content: message, fontSize: 13, color: { r: 0.68, g: 0.75, b: 0.86, a: 1 } } });
    world.insert(status, Name, { value: 'DeviceStatus' });
    const button = (text: string, left: number, onClick: () => void) => {
        const handle = createButton({ world, events, parent: canvas, userGesture: true,
            node: { position: UIPositionType.Absolute, insetLeft: px(left), insetTop: px(31), width: px(165), height: px(35) }, text, onClick });
        world.insert(handle.entity, Name, { value: text });
    };
    button('Tilt controls', 30, () => {
        if (motion) { motion = false; tilt = { x: 0, y: 0 }; void Device.motion.stop().then(report('Motion stopped')); return; }
        const caps = Device.capabilities();
        void Device.motion.start({ accelerometer: caps.accelerometer, gyroscope: caps.gyroscope }).then(result => {
            motion = result.status === 'ok'; report('Motion')(result);
        });
    });
    button('Keep awake', 220, () => { void Device.keepScreenOn(!Device.state().screenOn).then(report('Screen wake')); });
    button('Fullscreen', 410, () => { void Device.fullscreen(!Device.state().fullscreen).then(report('Fullscreen')); });
    button('Pointer lock', 600, () => { void Device.pointerLock(!Device.state().pointerLocked).then(report('Pointer lock')); });
    Device.motion.onChange(sample => {
        if (!motion || !sample.gravity) return;
        tilt = { x: Math.max(-1, Math.min(1, sample.gravity.x / 5)), y: Math.max(-1, Math.min(1, sample.gravity.y / 5)) };
    });
    Device.onChange(state => { if (!state.motionActive) tilt = { x: 0, y: 0 }; });
    const hint = spawnUIEntity({ world, parent: canvas,
        node: { position: UIPositionType.Absolute, insetLeft: px(230), insetTop: px(390), width: px(355), height: px(40) },
        visual: { color: { r: 0.075, g: 0.09, b: 0.14, a: 0.95 } },
        text: { content: 'Approach the monster, then attack.\nWASD / stick to move / Space / Fire to attack', fontSize: 13 } });
    world.insert(hint, UINode, { ...world.get(hint, UINode), pointerEvents: 1 });
}, { name: 'MobileControlsSetup' }));

addSystemToSchedule(Schedule.Update, defineSystem([Res(Input), Res(Time), GetWorld()], (input, time, world) => {
    controls.evaluate(input);
    const player = world.findEntityByName('Player'); const target = world.findEntityByName('Target');
    if (player === null || target === null) return;
    const axis = controls.axis2d('Move'); const transform = world.get(player, Transform);
    const speed = 180 * Math.min(time.delta, 0.05);
    transform.position.x = Math.max(-330, Math.min(330, transform.position.x + (axis.x + tilt.x) * speed));
    transform.position.y = Math.max(-138, Math.min(80, transform.position.y + (axis.y + tilt.y) * speed));
    world.insert(player, Transform, transform);
    const destination = world.get(target, Transform).position;
    hitFlash = Math.max(0, hitFlash - time.delta);
    recoil = Math.max(0, recoil - time.delta);
    const targetTransform = world.get(target, Transform);
    const targetScale = hitFlash > 0 ? 1 + Math.sin(hitFlash * 40) * 0.08 : 1;
    targetTransform.scale = { x: targetScale, y: targetScale, z: 1 };
    world.insert(target, Transform, targetTransform);
    world.insert(target, Sprite, { ...world.get(target, Sprite), color: hitFlash > 0
        ? { r: 1, g: 0.35, b: 0.25, a: 1 } : { r: 1, g: 1, b: 1, a: 1 } });
    transform.scale = { x: recoil > 0 ? 1.12 : 1, y: recoil > 0 ? 0.88 : 1, z: 1 };
    world.insert(player, Transform, transform);
    if (controls.pressed('Fire')) {
        recoil = 0.12;
        if (Math.hypot(destination.x - transform.position.x, destination.y - transform.position.y) < 85) {
            hits++; hitFlash = 0.3; message = `Hit! Training score: ${hits}`; void Device.vibrate({ duration: 'short', intensity: 'heavy' }).then(report('Hit vibration'));
            if (hits % 3 === 0) {
                targetTransform.position = { ...destination,
                    x: destination.x > 0 ? -180 : 180, y: hits % 2 === 0 ? -40 : 40 };
                world.insert(target, Transform, targetTransform);
            }
        } else { misses++; message = `Out of reach - move closer to the monster. Misses: ${misses}`; }
    }
    if (status !== null && world.valid(status)) {
        const caps = Device.capabilities();
        const content = `${message}\nHits: ${hits} · Motion API: ${caps.accelerometer ? 'available' : 'unavailable'} · Vibration API: ${caps.vibration ? 'available' : 'unavailable'}`;
        if (world.get(status, Text).content !== content) world.insert(status, Text, { ...world.get(status, Text), content });
    }
}, { name: 'MobileControlsUpdate' }));
