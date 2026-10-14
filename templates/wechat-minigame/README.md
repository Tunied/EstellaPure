# WeChat Mini Game starter

Select the three ships, replay the round, request login, share a card or opt in
to a rewarded video. CC0 artwork and its original license are included in
[ASSET_LICENSES.md](ASSET_LICENSES.md). The scene and scripts are editable.

Choose **WeChat Mini Game** in the launcher's Templates gallery to copy this
project. `src/config.ts` contains your rewarded-video ad unit and share title.
The ad unit is deliberately empty until you configure your own; its button is
disabled. Web preview also disables unavailable login, share and ad capabilities.

`Identity.login()` yields a short-lived code. Implement `exchangeLoginCode` in
`src/config.ts` to send it to your own HTTPS server. Return true only after that
server authenticates the session. Keep the AppSecret on the server. The default
implementation reports that a code was received and server integration is still
required; it never claims the player is signed in or saves/logs their code.

Share requests do not report whether the player actually shared. The template
shows that uncertainty and never grants share rewards. Only a completed rewarded
video grants a credit. Credits save on this device and restore on reload;
unreadable or externally changed saves are preserved, and failed writes leave
earned progress in session. This is not cloud backup or cross-account progress.

From the engine repository, replace the project path with your new project:

Install/build the matching runtime first. A source checkout builds the WeChat
runtime with `node build-tools/cli.js build -t wechat` and the Web runtime with
`node build-tools/cli.js build -t web`; an ES-module Web glue file cannot be used
as a WeChat engine. The packaged editor offers the corresponding runtime in
Package Project. Use `--wasm /path/to/matching-runtime` for an explicit CLI runtime.

```sh
node pipeline/bin/estella.mjs export /path/to/project --profile wechat --out output/my-wechat --json output/my-wechat.json
node pipeline/bin/estella.mjs export /path/to/project --profile web --out output/my-web --json output/my-web.json
```

The WeChat profile puts the engine in a startup subpackage and compresses WASM
to `.wasm.br`. Use WeChat base library 2.14.0 or newer for compressed WASM and
set the minimum version in your console. The exported size report separates
initial and subpackage bytes. Review its budget verdicts before publishing.
Use your real AppID and valid ad unit in WeChat DevTools and campaign settings;
no account credentials or unrelated sample identifiers are shipped.

Keep the Canvas, Score and Ship 1/2/3 scene names or update their script lookup.
The responsive Canvas is square, while packaging requests portrait orientation.
Re-skin in the scene and replace the CC0 artwork with licensed assets as needed.

Before release, verify login with your server, valid-domain configuration,
share UI, completed/cancelled/failed rewarded videos, local save reload, subpackage
failure, startup progress and device orientation in DevTools and on real phones.
Local contract hosts and unit tests cannot certify WeChat's actual base library,
ad inventory, server authentication or device acceptance. Independent external
developer publication exercises remain a separate roadmap acceptance step.
