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

The `mraid`, `unity`, and `applovin` profiles wait for host readiness and viewability.
A hidden ad pauses gameplay and audio; cleanup removes container listeners. Plain
browser preview remains active. Network upload and device acceptance remain separate
from a local mock-container check.

For MRAID store buttons, pass your app’s destination to `playableCta(storeUrl)`
or let the ad host supply `window.clickTag`. HTTP(S), Android `market:` and iOS
`itms-apps:` store links are supported. Without a valid destination the bridge
reports the missing configuration and does not call `mraid.open`. The sample
project has no published app destination; configure yours before network acceptance.

Exports return a `playableCheck` report. Save it with `--json report.json` on the CLI,
or inspect it in the editor’s package result. It records HTML/delivery hashes,
network budgets, literal resource references and required orientation config.
CTA, host lifecycle, dynamic requests and network/device acceptance remain marked
for runtime verification; a static pass does not imply ad approval.

## Local container preview

After exporting, run from the engine repository:

```sh
pnpm preview:playable output/preview-mintegral/index.html --report output/preview-mintegral.json
pnpm preview:playable output/preview-unity/index.html --report output/preview-unity.json --store-url https://example.com/your-store-url
```

The command prints a loopback URL and opens no browser. Open the URL yourself when
wanted. The source HTML is read once, remains unchanged, and is identified by its
SHA256; restart the command after exporting a new build. `--report` verifies the
file hash and derives the network from the export result. Without a report, choose
`--network mintegral`, `mraid`, `unity`, `applovin`, `tiktok`, `pangle`, `google`,
`meta`, or `generic` explicitly.

For MRAID, Ready releases the host-loading state, then Show makes the ad viewable.
Mintegral announces Creative Ready after resources load; Show calls gameStart and
Hide calls gameClose. Completion and close stay separate. The creative's Try Again
button calls gameRetry; reloading the iframe restarts the whole scene. TikTok/Pangle
mock their mandatory SDK and observe page visibility. Google/Meta expose their
store hooks; their lifecycle still needs the real network container.

The viewport selector checks portrait and landscape. Store calls are logged rather
than opened; enter your own store destination for MRAID. Save Log downloads a JSON
record marked `local-mock`, with the original HTML hash. External requests are
blocked in this preview and recorded as violations, so this is a controlled mock,
not proof of the original package's behavior in the real SDK. Official previews
and physical devices remain separate acceptance steps.

The `google` and `meta` named profiles export the same scene for the existing
networks. Mandatory SDK checks now verify both presence and placement: Google
Exit API in head, TikTok/Pangle before game scripts in body. SDK addresses merely
appearing in an allowlist or in JavaScript text do not satisfy this check.

When a full export result is supplied, the preview also verifies the actual ZIP
beside the HTML against its delivery SHA256. Relocated exports use the archive
filename, not the old absolute output path. A changed archive is rejected even
when index.html stayed identical. Saved logs include both hashes and the delivery
filename; HTML-only previews are labeled as such. Event history retains the last
1,000 entries and displays/saves the count of omitted earlier events.

Run the same scene without a browser window using its declarative click scenario
(Node 20+ and Playwright Chromium):

```bash
pnpm exec playwright install chromium
pnpm verify:playable output/playable-ad/index.html --report output/playable-ad.json --scenario examples/playable-ad/playable-check.json --out output/playable-check --store-url https://example.com/store
```

Use your actual export paths. The store URL here is a test destination; the mock
records it without opening it. `runtime-check.json` and canvas screenshots bind
the original HTML, actual delivery, export report, scenario, verifier and mock
hashes. The command always launches headless Chromium and mutes audio; it does not
launch the editor. A failed export/static check, unexpected request (including a
blocked attempt), page error, wrong event count, hidden input/animation, truncated
history or input changes makes verification fail.

`playable-check.json` declares canvas-relative coordinates, observed intervals
and per-network expectations. Each viewport starts fresh. Store checks observe
trusted pointer releases and active browser user activation; they do not prove
the original SDK's synchronous gesture requirements. Google/Meta lifecycle steps
are explicitly not applicable, with missing coverage retained as pending. All
records remain `local-mock`: original host SDK behavior, visual/audio quality,
audio lifecycle, official tools and physical devices still need separate review.
