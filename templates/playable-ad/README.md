# Playable Ad starter

A complete, editable fleet-selection game. Tap each of the three ships to finish,
then choose Try Again to reset. The persistent store button is the only place
that calls the ad network's destination; tapping the scene never opens a store.
The responsive Canvas supports portrait and landscape containers. The scene
and CC0 art are editable, with sources in [ASSET_LICENSES.md](ASSET_LICENSES.md).

## Create and customize

Choose **Playable Ad** under Templates in the launcher and create a project in
your own directory. The launcher copies the scene, scripts, artwork, named
export profiles, license list and headless scenario. Keep your project outside
the engine checkout. No editor window is needed for the CLI steps below.

Change the title and artwork in `assets/scenes/main.esscene`. The three ships,
score label and Canvas are named because `src/main.ts` finds them by name;
preserve those names when reskinning, or update the matching script. Edit the
win rule and completion text in that script. It sends one `playableGameEnd()`
per completed round and `playableRetry()` only after an explicit completed-round
restart. Ordinary clicks do not call a host directly.

For MRAID-family networks, set **your app's** HTTP(S), `market:` or `itms-apps:`
destination in `src/config.ts`, or configure the container's `clickTag`.
An empty destination does not point to a sample app: the bridge reports missing
configuration and refuses to open. Mintegral and the other host-directed
networks obtain the destination from your campaign settings. Configure those
in the real ad platform before submission.

## Export and check

From the engine repository, substitute the absolute path of your new project:

```sh
node pipeline/bin/estella.mjs export /path/to/my-project --profile mintegral --out output/my-ad --json output/my-ad.json
node tools/verify-playable.mjs output/my-ad/index.html --report output/my-ad.json --scenario /path/to/my-project/playable-check.json --out output/my-ad-check --store-url https://example.com/store
```

Node 20+ and Playwright Chromium are needed for the headless verifier. Install
Chromium once with `pnpm exec playwright install chromium`. The example URL
above is solely an offline mock destination: the verifier records it and does
not open a store. Use your actual destination in project/campaign settings.

Named profiles are `mintegral`, `mraid`, `unity`, `applovin`, `tiktok`, `pangle`,
`google` and `meta`. Export the one your campaign uses, inspect `ok` and
`playableCheck` in the JSON report, and retain the runtime check and screenshots.
The export checks the network's delivery budget, SDK placement, orientation
configuration and static external references. The headless scenario exercises
real mouse gestures, three selections, completion, hide/show, blocked hidden
input, CTA and replay where that network exposes those events.

Web preview has no ad bridge and the button says AD PREVIEW. For a Web build,
use `--platform web` without a named ad profile. A local scene is useful for
authoring, but its store behavior is not ad-container acceptance.

## Submit to the platform

Use the produced delivery file for the selected profile (`index.html` or
`index.zip`, as the export report specifies). Confirm your real destination,
orientation, campaign configuration and allowed SDK version in the platform.
Run its official preview/test tool and test target devices before submitting.
Pangle here means overseas Pangle; it is not domestic 穿山甲 or Douyin.

Local SDK mocks, static budget checks and host events are recorded separately
from ad-network approval. Save official test results and device observations
with your campaign. This template has no account credentials, published app
destination or claim of official approval; external developer publication
exercises remain a roadmap acceptance step.

## Contents

- `assets/scenes/main.esscene`: authored UI, textures and selectable ships.
- `assets/textures`: unmodified Kenney Simple Space CC0 artwork.
- `src/main.ts`: selection, completion, explicit store gesture and replay.
- `src/config.ts`: your store destination.
- `playable-check.json`: declarative portrait/landscape headless scenario.
- `ASSET_LICENSES.md`: asset provenance and original license.
