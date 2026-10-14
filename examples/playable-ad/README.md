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
