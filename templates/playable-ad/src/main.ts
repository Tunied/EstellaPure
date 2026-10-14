import {
    addStartupSystem, addSystemToSchedule, defineSystem, Res, GetWorld, Schedule, Time,
    UIEvents, UIEventType, UIVisual, Interactable, Text, Name, createButton, px, percent,
    playableCta, hasPlayableCta, playableGameEnd, playableRetry, type Entity,
} from 'esengine';
import { STORE_URL } from './config';

let selected = new Set<Entity>();
let cta: Entity | null = null;
let completed = false;

addStartupSystem(defineSystem([Res(UIEvents), GetWorld()], (events, world) => {
    const canvas = world.findEntityByName('Canvas');
    const score = world.findEntityByName('Score');
    if (canvas === null || score === null) return;
    const ships = ['Ship 1', 'Ship 2', 'Ship 3'].map(name => world.findEntityByName(name)).filter((entity): entity is Entity => entity !== null);
    const colors = ships.map(entity => ({ ...world.get(entity, UIVisual).color }));
    const caption = (content: string) => world.insert(score, Text, { ...world.get(score, Text), content });
    for (const entity of ships) events.on(entity, UIEventType.Click, () => {
        if (selected.has(entity)) return;
        selected.add(entity);
        world.insert(entity, Interactable, { ...world.get(entity, Interactable), enabled: false });
        world.insert(entity, UIVisual, { ...world.get(entity, UIVisual), color: { ...world.get(entity, UIVisual).color, a: 0.3 } });
        caption(`${selected.size} / 3 SHIPS READY`);
        if (selected.size === ships.length) {
            completed = true; caption('FLEET READY!  START YOUR ADVENTURE'); playableGameEnd();
        }
    });
    const install = createButton({ world, events, parent: canvas, userGesture: true,
        node: { position: 1, insetLeft: percent(22), insetTop: percent(75), width: percent(56), height: px(84) },
        text: { content: hasPlayableCta() ? 'INSTALL GAME' : 'AD PREVIEW', fontSize: 28, color: { r: 0.1, g: 0.075, b: 0.14, a: 1 } },
        background: { color: { r: 1, g: 0.66, b: 0.23, a: 1 } },
        states: { normal: { color: { r: 1, g: 0.66, b: 0.23, a: 1 } }, hover: { color: { r: 1, g: 0.79, b: 0.4, a: 1 } },
            pressed: { color: { r: 0.84, g: 0.48, b: 0.15, a: 1 } } },
        onClick: () => { if (hasPlayableCta()) playableCta(STORE_URL || undefined); else caption('Export a network playable to test install.'); },
    });
    cta = install.entity; world.insert(cta, Name, { value: 'Install' });
    const retry = createButton({ world, events, parent: canvas, userGesture: true,
        node: { position: 1, insetLeft: percent(33), insetBottom: px(12), width: percent(34), height: px(38) },
        text: { content: 'TRY AGAIN', fontSize: 20 },
        onClick: () => {
            if (!completed) return;
            playableRetry(); selected.clear(); completed = false; caption('0 / 3 SHIPS READY');
            ships.forEach((entity, index) => {
                world.insert(entity, Interactable, { ...world.get(entity, Interactable), enabled: true });
                world.insert(entity, UIVisual, { ...world.get(entity, UIVisual), color: colors[index] });
            });
        },
    });
    world.insert(retry.entity, Name, { value: 'Retry' });
}, { name: 'PlayableFleetSetup' }));

addSystemToSchedule(Schedule.Update, defineSystem([Res(Time), GetWorld()], (time, world) => {
    if (!completed || cta === null || !world.valid(cta)) return;
    const pulse = 0.8 + Math.sin(time.elapsed * 5) * 0.2;
    world.insert(cta, UIVisual, { ...world.get(cta, UIVisual), color: { r: 1, g: 0.62 + pulse * 0.16, b: 0.23, a: 1 } });
}, { name: 'PlayableInstallPrompt' }));
