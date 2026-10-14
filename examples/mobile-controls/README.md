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
