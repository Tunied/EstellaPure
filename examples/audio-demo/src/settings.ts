import { Storage } from 'esengine';

import { parseBusVolumes, type BusVolumes } from './volumeSettings';
export type { BusVolumes } from './volumeSettings';
const KEY = 'audio-demo.volumes';

export function loadBusVolumes(): BusVolumes {
    return parseBusVolumes(Storage.getJSON<unknown>(KEY));
}

export function saveBusVolumes(volumes: BusVolumes): void {
    Storage.setJSON(KEY, volumes);
}
