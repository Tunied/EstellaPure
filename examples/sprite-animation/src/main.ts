// Sprite animation: authored clips, player state machine, and footstep events.
// Arrow keys or A/D walk; Shift runs; Space hops; P pauses/resumes bystanders.
import { addStartupSystem, addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { setupSystem, wireClipsSystem } from './systems/setup';
import { controlSystem, playbackSystem } from './systems/control';
import { puffSystem } from './systems/puffs';

addStartupSystem(setupSystem);
addSystemToSchedule(Schedule.Update, wireClipsSystem);
addSystemToSchedule(Schedule.Update, controlSystem);
addSystemToSchedule(Schedule.Update, playbackSystem);
addSystemToSchedule(Schedule.Update, puffSystem);
