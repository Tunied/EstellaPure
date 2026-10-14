# Playable Ad

Tap the three ships to complete a fleet, use the persistent install button, and
choose Try Again to restart. The CC0 space art and responsive Canvas support
portrait and landscape ad containers.

The default playable network is Mintegral. `playableGameEnd()` marks a win;
`playableRetry()` reports an explicit restart; `playableCta()` uses the network's
store hook. The runtime announces loaded resources and observes host start/close
callbacks. Game and audio pauses preserve their own user-controlled state.

Open the project normally for a local preview, or export the Playable target to
produce `index.html` and the matching `index.zip` required by the official test
tool. A plain Web preview has no store destination. Mintegral's
official test container supplies its own install, ready, end and retry methods.
An offline mock verifies wiring, not ad-network approval.

See [asset licenses](ASSET_LICENSES.md) and the
[official Mintegral test guide](https://www.playturbo.com/review/doc).

Named export profiles `mintegral`, `tiktok`, and `pangle` package the same scene.
For example: `node pipeline/bin/estella.mjs export examples/playable-ad --profile tiktok`.
TikTok and overseas Pangle include a root `config.json` declaring both orientations,
with each network's documented field casing. They load the mandatory official host
SDK before game scripts and use `window.openAppStore()` through `playableCta()`.
Both use the live lowercase CDN SDK URL documented by Pangle; TikTok's mixed-case
URL returned 404 during verification. The profiles are not domestic Douyin or
domestic Pangle exports. Validate uploads in the appropriate Ads Manager preview.

Specifications: [TikTok](https://ads.tiktok.com/resources/help/article/playable-ads?lang=en),
[overseas Pangle](https://ads.tiktok.com/resources/help/article/how-to-create-tiktok-pangle-playable-ads).
