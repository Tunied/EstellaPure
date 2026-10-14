import { addStartupSystem, defineSystem, Res, GetWorld, UIEvents, UIEventType, UIVisual,
    Interactable, Text, Name, createButton, px, percent, Ads, Identity, Storage,
    platformCanShare, platformShare } from 'esengine';
import { REWARDED_AD_UNIT_ID, SHARE_TITLE, exchangeLoginCode } from './config';
import { StarterState } from './starterState';
const SAVE_KEY = 'wechat-starter.credits.v1';
addStartupSystem(defineSystem([Res(UIEvents), Res(Ads), Res(Identity), GetWorld()], (events, ads, identity, world) => {
    const canvas = world.findEntityByName('Canvas'), score = world.findEntityByName('Score');
    if (canvas === null || score === null) return;
    const state = new StarterState({ login: async () => (await identity.login()).code, exchange: exchangeLoginCode,
        share: () => platformShare({ title: SHARE_TITLE }), reward: () => ads.showRewarded(REWARDED_AD_UNIT_ID),
        getSave: () => Storage.getString(SAVE_KEY), setSave: value => Storage.setString(SAVE_KEY, value) });
    const ships = ['Ship 1', 'Ship 2', 'Ship 3'].map(name => world.findEntityByName(name)).filter((id): id is number => id !== null);
    const colors = ships.map(id => ({ ...world.get(id, UIVisual).color })), selected = new Set<number>();
    const buttons: Array<{ id: number; available(): boolean }> = [];
    const refresh = () => {
        if (!world.valid(score)) return;
        world.insert(score, Text, { ...world.get(score, Text), fontSize: 16,
            content: `${selected.size}/3 SHIPS | CREDITS ${state.credits}\n${state.message}` });
        for (const button of buttons) if (world.valid(button.id)) world.insert(button.id, Interactable,
            { ...world.get(button.id, Interactable), enabled: !state.busy && button.available() });
    };
    for (const id of ships) events.on(id, UIEventType.Click, () => {
        if (state.busy || selected.has(id)) return; selected.add(id);
        world.insert(id, Interactable, { ...world.get(id, Interactable), enabled: false });
        world.insert(id, UIVisual, { ...world.get(id, UIVisual), color: { ...colors[ships.indexOf(id)], a: 0.3 } });
        state.message = selected.size === 3 ? 'Fleet ready! Replay to assemble again.' : 'Select the remaining ships.'; refresh();
    });
    const action = (name: string, left: number, available: () => boolean, run: () => void | Promise<void>) => {
        const button = createButton({ world, events, parent: canvas, userGesture: true,
            node: { position: 1, insetLeft: percent(left), insetTop: percent(77), width: percent(28), height: px(48) },
            text: { content: name.toUpperCase() + (available() ? '' : ' OFF'), fontSize: 18 },
            onClick: () => { if (state.busy || !available()) return; const pending = run(); refresh(); void Promise.resolve(pending).finally(refresh); } });
        world.insert(button.entity, Name, { value: name }); buttons.push({ id: button.entity, available });
    };
    action('Login', 5, () => identity.available, () => state.login());
    action('Share', 36, platformCanShare, () => state.share());
    action('Reward', 67, () => ads.available && REWARDED_AD_UNIT_ID.trim().length > 0, () => state.reward());
    const replay = createButton({ world, events, parent: canvas,
        node: { position: 1, insetLeft: percent(30), insetBottom: px(12), width: percent(40), height: px(38) },
        text: { content: 'PLAY AGAIN', fontSize: 20 }, onClick: () => {
            if (state.busy) return; selected.clear(); state.message = 'Select three ships to assemble your fleet.';
            ships.forEach((id, i) => { world.insert(id, Interactable, { ...world.get(id, Interactable), enabled: true }); world.insert(id, UIVisual, { ...world.get(id, UIVisual), color: colors[i] }); }); refresh();
        } });
    world.insert(replay.entity, Name, { value: 'Replay' }); refresh();
}, { name: 'WeChatStarterSetup' }));
