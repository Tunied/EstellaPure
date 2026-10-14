// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { createButton, spawnUIEntity, Text, Name, UIPositionType, px, type AdsAPI } from 'esengine';
import { TrainingSession } from './pokiTraining';

type ButtonOptions = Parameters<typeof createButton>[0];
interface PokiGameplay { gameplayStart(): void; gameplayStop(): void }

export function setupWebTraining(
    world: ButtonOptions['world'], events: ButtonOptions['events'], parent: NonNullable<ButtonOptions['parent']>,
    ads: AdsAPI, reset: () => void, refresh: () => void,
): TrainingSession | null {
    if (typeof document === 'undefined') return null;
    const channel = document.documentElement?.dataset?.webChannel;
    if (channel !== 'poki' && channel !== 'crazygames') return null;
    const notify = (event: keyof PokiGameplay): void => {
        if (channel === 'crazygames' && document.documentElement.dataset.webSdkReady !== 'true') return;
        const hosts = globalThis as unknown as { PokiSDK?: PokiGameplay; CrazyGames?: { SDK?: { game?: PokiGameplay } } };
        const sdk = channel === 'poki' ? hosts.PokiSDK : hosts.CrazyGames?.SDK?.game;
        try { sdk?.[event](); }
        catch (error) { console.warn('[training] Gameplay event failed', channel, event, error); }
    };
    const controls: Array<{ button: ReturnType<typeof createButton>; label: ReturnType<typeof spawnUIEntity> }> = [];
    const update = (): void => {
        if (controls.length !== 3 || !world.valid(parent) || world.isDestructionPending(parent)) return;
        const phase = session.phase;
        const labels = [phase === 'menu' ? 'START' : phase === 'finished' ? 'REPLAY' : 'RESUME', 'PAUSE', ads.available ? 'WATCH AD +1' : 'ADS UNAVAILABLE'];
        controls.forEach(({ button, label }, index) => {
            button.setDisabled(index === 0 ? phase === 'playing' || phase === 'ad'
                : index === 1 ? phase !== 'playing' : !ads.available || phase === 'ad');
            world.insert(label, Text, { ...world.get(label, Text), content: labels[index] });
        });
        refresh();
    };
    const session = new TrainingSession(ads, {
        gameplayStart: () => notify('gameplayStart'), gameplayStop: () => notify('gameplayStop'), reset, changed: update,
    }, channel);
    const actions = [() => { void session.begin(); }, () => session.pause(), () => { void session.reward(); }];
    for (let index = 0; index < 3; index++) {
        const button = createButton({ world, events, parent, userGesture: true,
            node: { position: UIPositionType.Absolute, insetLeft: px(232 + index * 118), insetTop: px(346), width: px(112), height: px(36) },
            onClick: actions[index],
        });
        world.insert(button.entity, Name, { value: ['TrainingStart', 'TrainingPause', 'TrainingReward'][index] });
        const label = spawnUIEntity({ world, parent: button.entity, node: { fill: true }, text: { content: '', fontSize: 13 } });
        controls.push({ button, label });
    }
    const onVisibility = () => session.visibility(document.hidden);
    const onHide = () => session.visibility(true);
    // CrazyGames manages focus itself; its gameplay events describe game state only.
    if (channel === 'poki') {
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('pagehide', onHide);
        window.addEventListener('pageshow', onVisibility);
    }
    const offDespawn = world.onDespawn(entity => {
        if (entity !== parent) return;
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('pagehide', onHide);
        window.removeEventListener('pageshow', onVisibility);
        offDespawn(); session.dispose();
        controls.forEach(({ button }) => button.dispose());
    });
    if (channel === 'poki') session.visibility(document.hidden);
    update();
    return session;
}
