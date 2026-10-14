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
