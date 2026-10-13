export const VOLUME_BUSES = ['master', 'music', 'sfx'] as const;
export type VolumeBus = typeof VOLUME_BUSES[number];
export type BusVolumes = Record<VolumeBus, number>;

export function parseBusVolumes(stored: unknown): BusVolumes {
    const volumes = { master: 1, music: 1, sfx: 1 };
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return volumes;
    for (const bus of VOLUME_BUSES) {
        const value = (stored as Partial<BusVolumes>)[bus];
        if (typeof value === 'number' && Number.isFinite(value)) {
            volumes[bus] = Math.max(0, Math.min(1, value));
        }
    }
    return volumes;
}
