/**
 * The rules both ends run, with nothing of the engine in them: the server applies them to each connection's input, and the client applies the
 * same ones as its prediction, so a player's own pawn answers the key at once and the server's word rarely disagrees. Put anything a server must
 * be able to refuse (a speed, a wall, a build rule) here and not in a system, and the two cannot drift apart.
 */

/** Half the walkable ground, in world units: the pawn is held inside it. */
export const WORLD_HALF = 1450;
/** The height a pawn stands at above the ground plane. */
export const PAWN_HEIGHT = 80;

export interface Move { x: number; z: number }

/** The ground position one fixed step takes a pawn to: `move` is a unit direction (or zero), `speed` is units a second, held inside the world. */
export function stepPosition(x: number, z: number, move: Move, speed: number, dt: number): { x: number; z: number } {
    const clamp = (v: number): number => Math.min(WORLD_HALF, Math.max(-WORLD_HALF, v));
    return { x: clamp(x + move.x * speed * dt), z: clamp(z + move.z * speed * dt) };
}

/** A direction from which keys are down: the diagonal is normalised, or two keys would be about 1.4 times faster than one. */
export function moveFromKeys(left: boolean, right: boolean, forward: boolean, back: boolean): Move {
    const x = (right ? 1 : 0) - (left ? 1 : 0);
    const z = (back ? 1 : 0) - (forward ? 1 : 0);
    const length = Math.hypot(x, z);
    return length > 0 ? { x: x / length, z: z / length } : { x: 0, z: 0 };
}
