# Mobile Controls

Open this project from the editor's example gallery. The joystick and Fire button
are authored in the scene and remain visible in Edit. Play accepts a mouse drag,
independent fingers, or WASD / Space. Move near the monster and press Fire for
a hit and a vibration request. Every three hits relocate the monster.

The editable training room uses CC0 pixel art from Kenney Tiny Dungeon, nearest
texture filtering and explicit world layers. See [asset licenses](ASSET_LICENSES.md).

The top buttons request motion, screen wake, browser fullscreen and pointer lock
from the player's own release event. The status text displays the request result.
API availability is not proof that the current device has a sensor or motor.
The sensor-data indicator shows waiting, receiving, empty raw channels, or paused
separately from the request result. A successful request with empty channels does
not enable tilt movement; use a phone with motion sensors to verify real readings.

- Web motion and screen wake require a secure context (HTTPS or localhost).
- iOS Safari asks for motion permission; denial is a returned `denied` result.
- Motion is paused and the wake lock released in the background, then requested
  again in the foreground while the game still wants them. Stop motion explicitly
  to prevent a restart.
- Acceleration/gravity use m/s², gyro uses rad/s, and orientation uses degrees.
  Values follow device axes, rather than automatically rotating with the screen.
  Missing channels are `null`. Gravity uses a low-pass filter, not pose fusion.
- Browser vibration has no intensity control. Mini-game short vibration accepts
  three strengths where its host exposes them; long vibration uses the host's
  fixed effect. Check `vibrationIntensity` before depending on amplitude control.
- Node, older native binaries, and host APIs without these features return
  `unavailable`. Native motion/haptics require a runtime rebuilt from these sources.

Validation commands from the repository root:

```text
pnpm --filter esengine exec vitest run tests/device.test.ts tests/virtual-controls.test.ts
node desktop/scripts/editor-checks/run.mjs mobile-controls
node tools/verify-golden.mjs --tier pr --only mobile-controls
```

The browser/mini-game contract host verifies export, rendering and input wiring.
It cannot certify WeChat base-library behavior, Safari permission prompts on a
phone, native sensor axes, vibration hardware, or real background/foreground
behavior. Those remain separate device acceptance checks.


## Poki Web training profile

Export the same room with `node pipeline/bin/estella.mjs export
examples/mobile-controls --profile poki`. START begins a three-hit round; PAUSE
stops gameplay, RESUME gives Poki a commercial opportunity, and the third hit
ends the round. REPLAY resets the player and monster after a commercial break.
WATCH AD +1 is an explicit opt-in for one training credit. A skipped or failed
video grants no credit. Credits persist across rounds for this page session;
this example does not implement cloud storage.

Only the Poki export adds these controls. The HTML channel marker preserves this
flow even if the SDK script fails: training still works, ads remain unavailable.
Gameplay notifications use the official SDK directly; loading notifications
remain the export host's responsibility. Device permission/fullscreen buttons
never start gameplay. Hidden gameplay stops once; returning requires RESUME.
An ad that closes while hidden preserves the paused state instead of sending a
new gameplay-start event. Menu or finished-state rewards do not report gameplay.

The profile uses the same CC0 room, authored joystick and character textures.
Its local headless scenario is SDK wiring evidence, not Poki Inspector approval
or physical-device acceptance. Test with the official
[Poki Inspector](https://developers.poki.com/guide/sdk-html5) before submission.


### Inspect the real SDK without starting the editor

From the repository root, export and serve the directory locally:

```text
node pipeline/bin/estella.mjs export examples/mobile-controls --profile poki --out output/poki-training-web
python -m http.server 8080 --bind 127.0.0.1 --directory output/poki-training-web
```

Keep the server running, open the official Inspector, and enter
`http://127.0.0.1:8080/` in its URL field, then choose Open. The Inspector adds its
SDK testing context to the game URL. Watch its event log while starting, pausing,
resuming, watching a rewarded ad, completing the round and replaying. Let the
SDK's test ad finish naturally; no callbacks are replaced by this workflow.
The SDK Basics checklist and the other QA modules must be evaluated individually.
A clear event log is not full platform or device acceptance.

## CrazyGames Web training profile

Export with `node pipeline/bin/estella.mjs export examples/mobile-controls
--profile crazygames --out output/crazygames-training-web`. This profile uses
the same authored room and START / PAUSE / REPLAY / WATCH AD controls. Gameplay
events go to `CrazyGames.SDK.game`; focus changes do not emit gameplay events,
because the SDK handles focus itself. Reward credits load and save through
the engine's `Storage` API on this channel. A page reload restores saved credits.
Unreadable, disabled or externally changed saves are preserved; failed saving
is displayed as session-only progress. Poki credits remain session-only.

The export host awaits the official v3 SDK, reports loading, and connects the
existing Ads service to rewarded and midgame callbacks. Only `adFinished`
grants a rewarded credit. SDK initialization failure leaves training playable
with ads unavailable. Host audio mute overrides game audio and video controls
without changing the player's own mute or suspension preference.

On this channel the engine's `Storage` API uses SDK Data for both guests and
signed-in players. Enable Progress Save in the CrazyGames submission settings.
Disabled saving, invalid stored data and SDK failures surface as errors; there
is no silent localStorage fallback. Engine keys share the `estella.storage.v1`
envelope, and `Storage.clear()` preserves other publisher data. The SDK's
overall 1 MB limit still applies. A synchronous save is not acknowledgment of
cloud backup or proof of cross-account restoration.

For an invited leaderboard, configure the 32-byte Base64 client Encryption Key
under Web packaging in the editor (`packaging.platforms.web.leaderboardEncryptionKey`).
The key is shipped in the client; never enter the server API Key. After three
hits, SEND SCORE submits the round's three points through `Scores.submit`.
Without a configured key or SDK score capability, the button is disabled.
The platform leaderboard must use matching score rules. The engine encrypts
the numeric score using the official HTML5 AES-GCM format and sends both values.
A successful call means sent, not that the server accepted a ranking.

The headless score fixture copies this source into a temporary directory and
uses a known mock-only key. It is not a platform credential and must not be
used for a production submission. Ordinary example profiles carry no key.
Official platform QA, leaderboard invitation/configuration, cross-account
cloud restoration and physical-device acceptance remain separate checks.
See the official [SDK introduction](https://docs.crazygames.com/sdk/intro/),
[game lifecycle](https://docs.crazygames.com/sdk/game/),
[video ads](https://docs.crazygames.com/sdk/video-ads/) and
[Data module](https://docs.crazygames.com/sdk/data/).
For scores, see [leaderboard requirements](https://docs.crazygames.com/sdk/leaderboards/)
and [client score submission](https://docs.crazygames.com/sdk/leaderboards-client/).

## YouTube Playables Web training profile

The export checks stored total size (below 250 MiB), each file (below 30 MiB),
file count (at most 8000) and allowed filename characters. It also warns about
files at or above 512 KiB and static initial content at or above 15 MiB.
Actual compressed transfer through gameReady must be below 30 MiB and needs
runtime measurement. The headless report records local ready time and a startup
heap sample, which do not certify device loading or peak gameplay heap.

Export with `node pipeline/bin/estella.mjs export examples/mobile-controls
--profile youtube --out output/youtube-training-web`. The editor also exposes
YouTube Playables under Web channel settings. The official SDK loads before
game code. The host reports the painted loading screen with `firstFrameReady`
and waits until the scene is interactive and the loading overlay has gone
before reporting `gameReady`.

SDK pause/resume events hold engine frames, input, audio and video. Browser
visibility events never override a host pause. Game-owned asynchronous work
must cooperate with pause; execution holds cannot cancel already running JavaScript.

Cloud data must load successfully before any write. Missing SDKs, local SDK
no-ops, failed reads and unreadable saves disable cloud writes without a local
fallback. Use `await Storage.flush()` or `SaveManager.saveAsync()` to observe
SDK acknowledgment. The envelope has a 3 MiB limit; pause-time saves above
64 KiB remain pending rather than being truncated. The training UI restores
reward credits, grants rewards only when the SDK returns true, and submits
the highest score only after that same value has been saved successfully.

Headless checks use explicit SDK mocks. Official Playables invitation,
Test Suite certification, real cloud restoration and device acceptance remain
pending. See the official [integration requirements](https://developers.google.com/youtube/gaming/playables/certification/requirements_integration)
and [SDK reference](https://developers.google.com/youtube/gaming/playables/reference/sdk).
