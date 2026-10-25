import { addSystemToSchedule, Schedule } from 'esengine';
import { loadPawnMeshSystem, provisionPawnsSystem, movePawnsSystem, sendInputSystem, paintPawnsSystem, followOwnPawnSystem } from './net';

addSystemToSchedule(Schedule.Startup, loadPawnMeshSystem);

// Netcode lives on the fixed timestep, the replication cadence: the authority provisions and simulates there and the client uplinks its input there.
// Each system gates on the Net role, so one set of code runs as the listen server, a client, a dedicated server, or plain offline single-player.
addSystemToSchedule(Schedule.FixedUpdate, provisionPawnsSystem);
addSystemToSchedule(Schedule.FixedUpdate, movePawnsSystem);
addSystemToSchedule(Schedule.FixedUpdate, sendInputSystem);
// Presentation: the colour is derived from ownership, and the camera takes the eye to your own pawn, at the display's own rate.
addSystemToSchedule(Schedule.FixedUpdate, paintPawnsSystem);
addSystemToSchedule(Schedule.PostUpdate, followOwnPawnSystem);
