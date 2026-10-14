// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { createButton, spawnUIEntity, Text, Name, UIPositionType, px, Storage, Scores, type AdsAPI } from 'esengine';
import { TrainingSession } from './pokiTraining';
import { TrainingSave } from './trainingSave';

type ButtonOptions = Parameters<typeof createButton>[0];
interface PokiGameplay { gameplayStart(): void; gameplayStop(): void }

export function setupWebTraining(
    world: ButtonOptions['world'], events: ButtonOptions['events'], parent: NonNullable<ButtonOptions['parent']>,
    ads: AdsAPI, reset: () => void, refresh: () => void,
): TrainingSession | null {
    if (typeof document === 'undefined') return null;
    const channel = document.documentElement?.dataset?.webChannel;
    if (channel !== 'poki' && channel !== 'crazygames' && channel !== 'youtube') return null;
    const compact = channel !== 'poki';
    const save = compact ? new TrainingSave(Storage) : null;
    let submittingScore = false;
    const notify = (event: keyof PokiGameplay): void => {
        if (channel === 'youtube') return;
        if (channel === 'crazygames' && document.documentElement.dataset.webSdkReady !== 'true') return;
        const hosts = globalThis as unknown as { PokiSDK?: PokiGameplay; CrazyGames?: { SDK?: { game?: PokiGameplay } } };
        const sdk = channel === 'poki' ? hosts.PokiSDK : hosts.CrazyGames?.SDK?.game;
        try { sdk?.[event](); }
        catch (error) { console.warn('[training] Gameplay event failed', channel, event, error); }
    };
    const controls: Array<{ button: ReturnType<typeof createButton>; label: ReturnType<typeof spawnUIEntity> }> = [];
    const update = (): void => {
        if (controls.length !== (compact ? 4 : 3) || !world.valid(parent) || world.isDestructionPending(parent)) return;
        const phase = session.phase;
        const labels = [phase === 'menu' ? 'START' : phase === 'finished' ? 'REPLAY' : 'RESUME', 'PAUSE', ads.available ? (compact ? 'AD +1' : 'WATCH AD +1') : (compact ? 'NO ADS' : 'ADS UNAVAILABLE'), Scores.available ? 'SEND SCORE' : 'NO SCORES'];
        controls.forEach(({ button, label }, index) => {
            button.setDisabled(submittingScore || (index === 0 ? phase === 'playing' || phase === 'ad'
                : index === 1 ? phase !== 'playing' : index === 2 ? !ads.available || phase === 'ad' : !Scores.available || phase !== 'finished'));
            world.insert(label, Text, { ...world.get(label, Text), content: labels[index] });
        });
        refresh();
    };
    const session = new TrainingSession(ads, {
        gameplayStart: () => notify('gameplayStart'), gameplayStop: () => notify('gameplayStop'), reset, changed: update,
        rewardGranted: credits => {
            if (!save) return;
            if (channel === 'youtube') {
                const pending = save.saveAsync(credits); session.saveMessage = save.message;
                void pending.then(() => { session.saveMessage = save.message; update(); });
            } else { save.save(credits); session.saveMessage = save.message; }
        },
    }, channel);
    if (save) { session.credits = save.load(); session.saveMessage = save.message; }
    const actions = [() => { void session.begin(); }, () => session.pause(), () => { void session.reward(); }];
    if (compact) actions.push(() => {
        if (submittingScore || session.phase !== 'finished' || !Scores.available) return;
        submittingScore = true; session.message = 'Sending round score...'; update();
        const send = async () => {
            let score = session.hits;
            if (channel === 'youtube') {
                const key = 'mobile-controls.training-best-score', raw = Storage.getString(key);
                const previous = raw === undefined ? 0 : Number(raw);
                if (!Number.isSafeInteger(previous) || previous < 0) throw new Error('Invalid saved best score');
                score = Math.max(score, previous); Storage.setNumber(key, score); await Storage.flush();
            }
            await Scores.submit(score);
        };
        void send().then(() => {
            session.message = 'Score sent. Platform ranking validation is pending.';
        }, () => { session.message = 'Score submission failed. You can retry.'; }).finally(() => {
            submittingScore = false; update();
        });
    });
    for (let index = 0; index < actions.length; index++) {
        const button = createButton({ world, events, parent, userGesture: true,
            node: { position: UIPositionType.Absolute, insetLeft: px(compact ? 220 + index * 92 : 232 + index * 118), insetTop: px(346), width: px(compact ? 88 : 112), height: px(36) },
            onClick: actions[index],
        });
        world.insert(button.entity, Name, { value: ['TrainingStart', 'TrainingPause', 'TrainingReward', 'TrainingScore'][index] });
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
