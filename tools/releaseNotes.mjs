// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Where every user-facing commit landed in the release notes.
 *
 * `check-release-metadata` reads the CHANGELOG's STRUCTURE — that a version has
 * a section, a compare link, a supported row. Nothing read its CONTENT, so a
 * feature could ship with no note and the release would still go out green. It
 * has happened in three releases running: v0.55 lost 31 commits across two
 * batches, 0.64 lost three, 0.66 lost the whole ECS speculation line plus the
 * editor crash fix — each found only by reading `git log` by hand.
 *
 * So say it once per commit instead. A commit that changes what a creator can
 * do names the note it landed under; one that does not says why. The gate holds
 * both directions: a missing commit fails, and so does a note title that no
 * longer exists in the CHANGELOG, which is what a rename would otherwise do
 * quietly.
 */

/** The release this reaches back to. Older ones are out of scope BY DECLARATION. */
export const NOTES_FLOOR = 'v0.65.0';

/**
 * Commit subject → where it landed. `note` is a CHANGELOG headline (a prefix of
 * one is enough); `internal` is the reason a creator could not observe it.
 *
 * Subjects, not hashes: a rebase changes the hash and the line it names is what
 * the reader recognises anyway.
 */
export const NOTED = {
  'feat(editor): the input map editor captures the next key, shows key caps and flags inputs shared between actions':
    { note: 'The input map editor captures keys.' },
  'feat(editor): an input shared between actions is a quiet note beside the key, not a warning':
    { internal: 'Restyles a note the input map editor already shows.' },
  'feat(editor): the outliner selects with a soft tint, draws indent guides, tints icons by kind and shows lock and visibility only when they matter':
    { note: 'A quieter outliner.' },
  'feat(editor): an asset header names its kind and size, and a segmented switch is used only when its words fit':
    { note: "An asset's header names its kind and size." },
  "feat(editor): asset inspectors take the board's finish — a card preview, ruled key-value rows, tinted actions, a kind icon in the header":
    { note: 'Asset inspectors are redrawn.' },
  "feat(editor): Details banners, add button, segmented switches and component icons follow the board's finish":
    { note: 'Details and segmented switches get the finer finish.' },
  "feat(editor): Details takes the board's style — flat sections, coloured axis letters, segmented switches for short choices":
    { note: 'Details is redrawn in a flatter style.' },
  "feat(editor): wide Details values take the row's width, rects and sides sit two by two, and a curve key's interpolation uses the themed select":
    { note: 'Details fields fit better.' },
  'feat(editor): design tokens v2 and a tidier main interface — selection readout in the viewport, a shorter status bar':
    { note: 'The editor has a new set of design tokens and a tidier main window.' },
  'feat(editor): the interface font is a setting — rounded by default, sans, serif, or any installed family':
    { note: 'The interface font is a setting.' },
  'feat(editor): the outliner shows lock and visibility in labelled columns, and the Details header keeps help and menu in view':
    { note: 'The Outliner and Details match their new design.' },
  'feat(editor): docked panels are rounded cards with rounded tabs, and the viewport hint line is off by default':
    { note: 'Docked panels are rounded cards.' },
  'feat(editor): the content browser list tints its type column by asset type':
    { note: 'Content Browser tiles and the Details header are redrawn.' },
  'feat(editor): content browser tiles and the inspector header follow the new design':
    { note: 'Content Browser tiles and the Details header are redrawn.' },
  'fix(editor): animated sprites play in the viewport whether or not they are selected':
    { note: 'Animated sprites play in the viewport whether or not they are selected.' },
  "fix(editor): the outliner's Add label stays on one line, and the content browser keeps its breadcrumbs when the bar is crowded":
    { internal: 'Corrects layout of controls added earlier in the same unreleased work.' },
  'fix(editor): the title row no longer hides menus under open drawers, and the content browser bar fits a narrow dock':
    { internal: 'Corrects layout of controls added earlier in the same unreleased work.' },
  'feat(editor): the outliner has one Add menu and a live pill, and the launcher keeps New project in one place':
    { note: 'The Outliner and the launcher lose their duplicate controls.' },
  'feat(editor): every document editor wears one header — file name, a stat, Save, tools on a second row':
    { note: 'Every document editor and every Details view has one header.' },
  'feat(editor): one inspector header for entities, assets, folders and the live game':
    { note: 'Every document editor and every Details view has one header.' },
  'feat(editor): one title row, a Panels flyout, a Show menu, a quieter content browser and status bar':
    { note: "The editor's chrome is tidier." },
  'fix(editor): retry the template directory removal in the APK test, as the others do':
    { internal: 'A test cleanup now retries a directory removal on Windows; no creator project is affected.' },
  'feat(editor): a settings window of ten pages, one line a row, advanced settings folded':
    { note: 'The settings window is ten pages, not sixteen.' },
  'fix(editor): use the shared Button, Segmented and grid tokens in the lighting controls':
    { internal: 'The lighting controls moved onto the shared Button and Segmented components and the spacing and colour tokens; their behaviour and appearance are those of the notes they belong to.' },
  'perf(android): a package carries the phone ABI, and the template strips libc++':
    { note: 'An Android package carries the phone ABI only.' },
  'feat(editor): include the emulator ABI as an Android packaging setting':
    { note: 'An Android package carries the phone ABI only.' },
  'feat(render): editor-view studio preview lighting and preview exposure':
    { note: 'The viewport can light the scene with a studio preview, and expose it.' },
  'feat(editor): studio preview lighting and preview exposure for the viewport':
    { note: 'The viewport can light the scene with a studio preview, and expose it.' },
  'feat(environment): read OpenEXR panoramas, and low-dynamic-range pictures as a source':
    { note: 'OpenEXR panoramas import as environments.' },
  'feat(editor): OpenEXR and low-dynamic-range panorama pictures as environment sources':
    { note: 'A low-dynamic-range panorama picture can be the source.' },
  'feat(environment): environment presets in the project file, and the sky and spheres of an environment':
    { note: 'Saved environment looks.' },
  'feat(environment): one rule for the scene\'s environment light, six-image sources, and an import report':
    { note: 'One rule picks the environment light.' },
  'feat(environment): six cube faces import as an environment, and an import reports what it clipped':
    { note: 'An environment import reports what it clipped, and the sky has a width setting.' },
  'perf(assets): UASTC textures ship under zstd supercompression':
    { note: 'UASTC textures ship under zstd.' },
  'fix(ci): index neon-ascension assets and classify sound event releases':
    { note: 'The Neon Ascension example exports and boots.' },
  'feat(editor): assign six images to an environment\'s faces, and create one from the Content Browser':
    { note: 'An environment can be made from six images.' },
  'feat(editor): bind, preview and preset an environment from the Lighting panel':
    { note: 'The Lighting panel names the scene\'s environment and binds it.' },
  'feat(editor): an environment section, per-object lighting source, and six-image panorama sources':
    { note: 'The Lighting panel explains the selected object\'s light.' },
  'fix(editor-checks): settle the sound event create write before editing':
    { internal: 'An editor check waited on a file watcher event it started itself; no creator project is affected.' },
  'fix(editor): integrate Play realm network permissions for issue #97':
    { note: 'Editor Play can connect to game servers.' },
  'fix(editor): allow game networking in the Play realm':
    { note: 'Editor Play can connect to game servers.' },
  'feat(examples): exercise sound event sources in audio demo':
    { note: 'Audio demo exercises authored sound events.' },
  'perf(editor): reuse bounded audio waveform peaks':
    { note: 'Sound events have a dedicated authoring panel.' },
  'feat(editor): author and preview sound event variants':
    { note: 'Sound events have a dedicated authoring panel.' },
  'feat(editor): integrate sound event authoring':
    { note: 'Sound events have a dedicated authoring panel.' },
  'feat(audio): connect sound event sources and graph triggers':
    { note: 'Sound event sources share code and graph triggers.' },
  'feat(editor): integrate sound event source references':
    { note: 'Sound event sources share code and graph triggers.' },
  'refactor(audio): expose shared playback ownership':
    { internal: 'Provides canonical voice-state lookup, stop generations and complete cleanup for leased consumers without adding another global voice pool.' },
  'feat(audio): manage sound event playback lifetimes':
    { note: 'Sound event playback owns pending and paused voices.' },
  'feat(audio): add deterministic sound event definitions':
    { note: 'Sound event definitions share deterministic selection.' },
  'feat(editor): recognize sound event definitions':
    { note: 'Sound event definitions share deterministic selection.' },
  'fix(editor): retain audio settings when editing mixer buses':
    { note: "Mixer bus edits retain the project's voice budget." },
  'fix(physics): preserve unchanged joint projections':
    { note: 'Unchanged 2D joints retain their solver state.' },
  'fix(ecs): scope native mutations to world ownership':
    { note: 'Physics reconciliation follows component mutation cursors.' },
  'perf(physics): reuse mutation checkpoints after pause':
    { note: 'Physics reconciliation follows component mutation cursors.' },
  'fix(ecs): invalidate projections when the core changes':
    { note: 'Physics reconciliation follows component mutation cursors.' },
  'perf(physics): reconcile only changed body definitions':
    { note: 'Physics reconciliation follows component mutation cursors.' },
  'refactor(ecs): unify SDK and native mutation cursors':
    { internal: 'Provides same-tick SDK mutation cursors, generated host component IDs, native reset epochs and owned core-disconnect leases for shared sparse runtime synchronization.' },
  'refactor(ecs): expose bounded native entity change history':
    { internal: 'Adds opt-in native entity and component mutation history as infrastructure for sparse synchronization, with independent cursors, bounded storage, hierarchy roots and overflow/reset signals; no user-facing synchronization policy changes in this commit.' },
  'perf(tilemap): synchronize collision by changed chunk':
    { note: 'Tile edits preserve unaffected collision chunks and contacts.' },
  'refactor(editor): use shared tile collision chunk readback':
    { note: 'Tile edits preserve unaffected collision chunks and contacts.' },
  'perf(physics): batch composed static body poses across hosts':
    { note: 'Moving static collision uses a shared batch pose channel.' },
  'fix(physics): release static pose history while time is frozen':
    { note: 'Static physics synchronization skips unchanged body groups.' },
  'perf(physics): synchronize only changed static body groups':
    { note: 'Static physics synchronization skips unchanged body groups.' },
  'perf(editor): project visible tile collision chunks':
    { note: 'Tile collision overlays project only visible local chunks.' },
  'perf(editor): synchronize local tile collision frames':
    { note: 'Tile collision overlays project only visible local chunks.' },
  'fix(tilemap): derive collision from each layer grid':
    { note: 'Tile collision follows painted and imported layer layouts.' },
  'fix(tilemap): share exact staggered and hex grid geometry':
    { note: 'Staggered and hexagonal picking follows cell polygons.' },
  'test(editor): cover staggered polygon picking through transforms':
    { internal: 'Exercises the real editor cursor-to-cell path over native diamond and hexagonal picking, including parent rotation, negative cells and both stagger axes and indices.' },
  'test(physics): keep lifecycle fixtures on the current module contract':
    { internal: 'Updates lifecycle and shutdown module doubles to provide the new body-local one-way normal entry point while preserving native contract rejection tests.' },
  'test(editor): verify rotated tile layers through play':
    { internal: 'Extends the existing CI tilemap layout check with layer and parent rotation pixels, comparing cached draws with an explicitly rebuilt reference.' },
  'test(editor): synchronize rotated tile play checks':
    { internal: 'Pins the CI-only editor rotation acceptance cases; local verification remains headless and creates no scene or material assets in commits.' },
  'fix(tilemap): align rotated layers and collision normals':
    { note: 'Rotated tile layers share one frame for drawing, picking and collision previews.' },
  'fix(editor): align rotated tile tools and collision previews':
    { note: 'Rotated tile layers share one frame for drawing, picking and collision previews.' },
  'chore(release): classify 0.88.0 feature coverage':
    { internal: 'Registers the new release features in the certification census and records the missing packaged-pixel coverage for volume color overrides without claiming acceptance.' },
  'chore(release): prepare 0.88.0':
    { internal: 'Prepares the release version and consolidates verified tile preview caching, post-process color blending and example changes without modifying showcase assets.' },
  'feat(examples): neon-ascension rain streaks and vent steam':
    { note: 'Neon Ascension adds a night-city grey-box example.' },
  'feat(postprocess): a volume can name an effect\'s colour params, so fog takes a night colour':
    { note: 'Post-process volumes blend effect colors.' },
  'feat(examples): neon-ascension grey-box, a night city to test reflections and bloom':
    { note: 'Neon Ascension adds a night-city grey-box example.' },
  'perf(editor): reuse local tile collision geometry while moving layers':
    { note: 'Moving tile collision previews reuses local geometry.' },
  'perf(editor): synchronize tile collision placement caching':
    { internal: 'Pins local tile collision geometry caching and movement regressions, and records the existing upstream night-city example in the changelog.' },
  'perf(editor): read only changed collision chunks':
    { note: 'Tile collision edits read only changed native chunks.' },
  'perf(tilemap): read collision chunks incrementally':
    { note: 'Tile collision edits read only changed native chunks.' },
  'perf(editor): reuse unchanged tile collision preview snapshots':
    { note: 'Stable tile collision previews reuse their native content and geometry.' },
  'perf(editor): synchronize tile collision preview snapshots':
    { internal: 'Pins the editor snapshot cache and its native invalidation regressions; stable preview refreshes skip full-map export and decoding without changing release versions or scene assets.' },
  'chore(release): prepare 0.87.2':
    { internal: 'Prepares the patch version and consolidates input cadence, virtual controls, editor list and live tile preview fixes without changing showcase assets.' },
  'test(poki): sample button focus and retain failed gameplay state':
    { internal: 'Poki acceptance holds pointer presses across animation frames, acknowledges each actual hit and preserves failed gameplay state and hashed screenshots. Existing phase and hit deadlines remain enforced; the old CI export fails this stronger focus regression control.' },
  'fix(example): return training keyboard focus when play resumes':
    { note: 'Training resumes with gameplay keyboard focus.' },
  'fix(editor): refresh tile collision previews from live metadata':
    { note: 'Tile collision previews follow unsaved tileset edits and undo.' },
  'fix(editor): synchronize live tile collision preview metadata':
    { internal: 'Pins the editor live-metadata preview fix and its verification coverage, without changing scene assets or release versions.' },
  'fix(editor): attach virtual windows after ancestor refs mount':
    { note: 'Windowed editor lists attach to the scroller that actually mounted.' },
  'fix(editor): finish virtual row reveals after measurement':
    { note: 'Editor row reveals finish after real grid measurements arrive.' },
  'fix(editor): synchronize windowed list attachment and navigation':
    { internal: 'Pins the editor commits that restore virtual-list attachment and measured row navigation, with matching release notes.' },
  'fix(ui): invert rendered transforms for virtual joysticks':
    { note: 'Virtual joysticks follow the rendered transform through sheared UI hierarchies.' },
  'perf(ui): share virtual control pointer groups per sample':
    { note: 'Virtual controls share each sample\'s pointer projection.' },
  'fix(ui): release hidden virtual controls before layout':
    { note: 'Virtual controls stop when their authored UI is hidden.' },
  'fix(input): sample named actions independently for fixed steps':
    { note: 'Named actions reach fixed simulation steps independently of render frames.' },
  'test(youtube): acknowledge each hit and retain failure state':
    { internal: 'Headless YouTube acceptance acknowledges each actual training hit and retains live gameplay state and screenshots before closing a failed browser session; missing attacks still fail.' },
  'chore(release): prepare 0.87.1':
    { internal: 'Prepares the patch version and consolidates verified input, UI and change-query fixes in the release notes without changing showcase assets.' },
  'fix(input): preserve complete button taps between samples':
    { note: 'Button actions retain complete keyboard and mouse taps between samples.' },
  'fix(ui): scope screen-domain lookup to its registry':
    { note: 'Screen-domain queries reject another world\'s cached entities.' },
  'fix(ui): cancel drag captures from authored visibility changes':
    { note: 'Authored UI hiding cancels dragging before another layout pass.' },
  'fix(test): present golden browser packages on a shared display':
    { internal: 'CI presents ordinary Web and playable packages without taking focus and owns one virtual display for the controller and workers, preventing hidden-page frame throttling while preserving settle deadlines, per-worker timeout shares, minigame launch paths and failure verdicts.' },
  'perf(ecs): bind live change matchers before entity iteration':
    { note: 'Dense change queries bind their live sequence index once.' },
  'fix(ecs): track system change queries across same-frame writes':
    { note: 'System change queries see additions and writes after earlier runs in the same frame.' },
  'fix(ecs): retain same-frame removals with sequence cursors':
    { note: 'Removal queries retain events across system runs in the same frame.' },
  'fix(test): classify versioned navigation in the release corpus':
    { internal: 'Connects the finalized navigation replacement feature note to the existing navigation certification capability and its courtyard project; no new acceptance claim is made.' },
  'fix(ui): reset visibility baselines for recreated components':
    { note: 'Recreated UI components start a fresh visibility baseline.' },
  'chore(release): finalize 0.87.0 release notes':
    { internal: 'Consolidates verified changes into the prepared 0.87.0 release section without changing product code or showcase assets.' },
  'test(lifecycle): renew foreground input in suspend comparisons':
    { internal: 'Suspend acceptance releases keyboard intent before hiding and sends a new key press after showing, preserving the engine cancellation contract and comparing actual movement with uninterrupted and held-background controls.' },
  'feat(nav): explain pending navigation surface replacements':
    { note: 'Navigation replacements commit only from the latest request.' },
  'feat(nav): stage cancellable surface replacements and explain pending routes':
    { note: 'Navigation replacements commit only from the latest request.' },
  'fix(test): present settings frames on one shared virtual display':
    { internal: 'The shared Electron owner can host a controller and all restart processes on one virtual display. CI presents package windows without taking focus, avoiding hidden-window frame throttling while preserving deadlines and full failure evidence.' },
  'fix(test): replay settings transactions after confirmed GPU loss':
    { internal: 'Settings acceptance applies the shared bounded GPU failure policy to whole fresh-profile transactions, preserving each failed attempt and screenshot while refusing retries for ordinary process or settings failures.' },
  'test(nav): yield fixed-step capture work to the compositor':
    { internal: 'Headless workshop acceptance yields between fixed simulation batches so software rendering can drain before screenshots, and persists sampled facts before capture failures.' },
  'test(settings): retain restart diagnostics and focused CI evidence':
    { internal: 'Settings acceptance preserves every restart process result and screenshot in existing CI artifacts, reports explicit exit status and signal, and has a focused workflow that verifies matching runtime sources before reusing Web artifacts.' },
  'fix(test): wait for package boot before settling input':
    { internal: 'Export acceptance counts settling frames only after the startup overlay releases input and uses a wall-clock watchdog independent of animation frames. Delayed real Web startup demonstrates that early clicks were previously lost.' },
  'fix(nav): apply grid obstacle changes without bake throttling':
    { note: '2D navigation doors close without the mesh bake delay.' },
  'fix(nav): pass occupied intermediate grid waypoints safely':
    { note: 'Couriers can pass occupied intermediate grid waypoints.' },
  'fix(nav): honor final arrival radius while steering bodies':
    { note: 'Crowd followers honor the configured final arrival radius.' },
  'test(nav): sample trusted keys before paused frame cleanup':
    { internal: 'Workshop acceptance steps trusted keyboard input in its event task so paused animation frames cannot erase it before sampling; movement traces retain final agent positions for failure diagnosis.' },
  'test(nav): cover authored workshop obstacle layouts':
    { internal: 'Headless exported-workshop acceptance also loads a scene with authored obstacles enabled and verifies retained state and delivery after reopening.' },
  'fix(audio): release runtime references from finished web voices':
    { note: 'Finished Web audio handles release their runtime references.' },
  'chore(release): classify v0.87 feature verification':
    { internal: 'The shipped capability census maps v0.87 navigation features to the navigation corpus and names focused editor acceptance for viewport and inspector features.' },
  'ci(editor): install workshop acceptance browser':
    { internal: 'Navigation workshop acceptance installs the Playwright headless browser required by its verifier on clean CI hosts.' },
  'fix(example): honor authored workshop obstacle state':
    { note: 'Build and reroute deliveries in a textured 2D courtyard.' },
  'fix(audio): share decoded ownership across source aliases':
    { note: 'Audio aliases share decoded buffer ownership.' },
  'fix(audio): preserve controls on loading effect handles':
    { note: 'Loading sound-effect handles preserve playback controls.' },
  'fix(audio): stop all owned voices and pending starts':
    { note: 'Stop All stops every owned audio voice and pending start.' },
  'fix(audio): preserve latest BGM intent across loading':
    { note: 'BGM playback follows the latest request instead of load completion order.' },
  'fix(audio): reject loads from retired context generations':
    { note: 'Web audio loads cannot cross disposed or replaced contexts.' },
  'fix(audio): retire source records with owned buffers':
    { note: 'Web audio source records follow live buffer ownership.' },
  'perf(ui): use generated web pointers for live focus checks':
    { note: 'Web UI getters can reach their generated pointer accessors.' },
  'fix(ui): retire text sessions when focus eligibility changes':
    { note: 'Ineligible text fields reject late editing callbacks immediately.' },
  'fix(ui): resolve live display ancestry for keyboard focus':
    { note: 'Keyboard focus observes authored visibility between layout passes.' },
  'feat(nav): add the courtyard building navigation workshop':
    { note: 'Build and reroute deliveries in a textured 2D courtyard.' },
  'fix(ui): preserve surrogate pairs when clamping host input':
    { note: 'Text-input length limits preserve complete supplementary characters.' },
  'fix(ui): bind field rendering to the active editing owner':
    { note: 'Text fields read only the editing surface they actually own.' },
  'feat(nav): budget agent replans fairly across frames':
    { note: 'Agent replans share a fair per-frame budget.' },
  'feat(inspector): show sampled navigation planning queues':
    { note: 'Agent replans share a fair per-frame budget.' },
  'feat(editor): inspect live agent route failures on demand':
    { note: "Inspect a live agent's current route on demand." },
  'feat(inspector): inspect live agent route failures on demand':
    { note: "Inspect a live agent's current route on demand." },
  'fix(inspector): use shared controls for navigation diagnostics':
    { note: "Inspect a live agent's current route on demand." },
  'perf(nav): reuse grid search workspaces across queries':
    { note: 'Grid path searches reuse their working memory.' },
  'feat(nav): diagnose partial routes and reuse disconnected grid topology':
    { note: 'Navigation queries distinguish complete routes from best-effort paths.' },
  'perf(text): wrap native measurements with ordered advances':
    { note: 'Native text measurement wraps without rescanning growing prefixes.' },
  'fix(text): bound native measurement advance history':
    { note: 'Public native text measurement retains a bounded advance cache.' },
  'feat(viewport): fade occluded transform handles without writing scene depth':
    { note: 'Spatial transform handles fade behind scene geometry.' },
  'feat(viewport): add configurable occluded handle fading':
    { note: 'Spatial transform handles fade behind scene geometry.' },
  'fix(text): isolate font reload ownership and glyph caches':
    { note: 'Font reloads retain independent handles and glyph caches.' },
  'fix(text): encode font paths without identity collisions':
    { note: 'Project font identities preserve complete asset paths.' },
  'fix(text): retire missing-glyph warnings with cached entries':
    { note: 'Missing-glyph warning history follows the bounded cache.' },
  'test(editor): verify projection resets to 2D after gestures':
    { note: 'Automation projection settings persist across editor state changes.' },
  'test(native): retain first launch evidence before retry':
    { internal: 'Native smoke retains the rejected launch screenshot, boot log and verdict before retry output reuses the normal filenames; startup verdicts and retry policy are unchanged.' },
  'test(editor): preserve authored camera during projection changes':
    { note: 'Automation projection settings persist across editor state changes.' },
  'fix(editor): retain programmatic projection across state updates':
    { note: 'Automation projection settings persist across editor state changes.' },
  'test(viewport): preserve spatial view through tool selection':
    { internal: 'Spatial acceptance uses the actual editor projection command so selecting a tool retains the store-owned view; a focused CI workflow can reuse a proven identical runtime.' },
  'test(viewport): retain spatial drag startup diagnostics':
    { internal: 'CI spatial gesture acceptance preserves process output and reports startup failures before a trusted drag observation is available.' },
  'chore(release): classify editor capabilities for v0.86.0':
    { internal: 'Release capability census records the editor-only features and their existing unit and CI acceptance paths.' },
  'test(viewport): distinguish plane handles in axis acceptance':
    { internal: 'Pixel acceptance masks the blue XY plane using rendered axis reach so it measures the projected Z arm independently.' },
  'fix(ui): transform drag deltas through full parent matrices':
    { note: 'Pointer dragging follows sheared parent transforms.' },
  'fix(audio): release failed starts and preserve paused retries':
    { note: 'Web audio startup failures release pooled nodes and keep resumes retryable.' },
  'fix(tilemap): clip fills and preserve signed coordinate edges':
    { note: 'Tilemap rectangle fills clip safely across integer coordinate bounds.' },
  'feat(viewport): rotate around the view-axis outer ring':
    { note: 'Spatial rotation adds a view-axis outer ring.' },
  'fix(animation): keep paused sprite motions out of exit transitions':
    { note: 'Paused sprite motions wait for actual completion before exit transitions.' },
  'feat(viewport): add spatial plane and center handles':
    { note: 'Spatial transform handles expose all three planes and distinct centers.' },
  'perf(ui): search measured list bounds and retry failed syncs':
    { note: 'Measured lists locate visible items without scanning every preceding row.' },
  'feat(viewport): combine transform handles in a universal tool':
    { note: 'Universal Transform combines move, rotate and scale handles.' },
  'perf(text): wrap plain text with incremental glyph advances':
    { note: 'Plain-text wrapping avoids repeated whole-line glyph measurements.' },
  'perf(text): trim overflowing plain text with prefix advances':
    { note: 'Long plain-text overflow trims with linear glyph measurement work.' },
  'feat(viewport): transform selections around individual origins':
    { note: 'Multi-selection transforms support Individual Origins.' },
  'perf(text): bound page-free glyph caches':
    { note: 'Page-free text glyph caches stay bounded.' },
  'feat(viewport): configure transform handle size':
    { note: 'Transform handle size is configurable.' },
  'feat(viewport): highlight transform handles under the pointer':
    { note: "Transform handles preview the pointer's target before a drag." },
  'fix(checks): report non-TypeScript example failures':
    { internal: 'Example validation reports filesystem and process failures instead of dropping all non-TS diagnostics.' },
  'perf(templates): minify the WeChat publishing profile':
    { note: "The WeChat starter's publishing profile minifies its game bundle." },
  'fix(ui): refresh inherited state outside Canvas layout trees':
    { note: 'UI inheritance stays current after leaving a Canvas.' },
  'feat(templates): add WeChat gameplay and host-service starter':
    { note: 'The WeChat Mini Game starter combines gameplay and host-service examples.' },
  'feat(templates): ship a complete playable ad starter':
    { note: 'The Playable Ad starter includes a complete editable game.' },
  'test(launcher): preserve complete playable starter on creation':
    { note: 'The Playable Ad starter includes a complete editable game.' },
  'test(youtube): verify hosting CSP and negative control':
    { note: 'YouTube headless checks enforce the documented hosting policy.' },
  'fix(text): refresh bitmap glyph density when device pixel ratio changes':
    { note: 'Bitmap text follows device pixel ratio changes during an App.' },
  'feat(youtube): validate export bundle constraints':
    { note: 'YouTube exports check stored bundle constraints.' },
  'feat(youtube): connect Playables readiness pause and cloud saves':
    { note: 'YouTube Playables Web exports honor host readiness and persistence.' },
  'feat(settings): add YouTube Playables Web channel':
    { note: 'YouTube Playables Web exports honor host readiness and persistence.' },

  'fix(ui): intersect nested stencil masks and restore parent clipping':
    { note: 'Nested UI stencil masks intersect their parents and restore clipping.' },
  'perf(text): reclaim unused glyph pages at frame boundaries':
    { note: 'Unused text atlas pages retire at frame boundaries.' },
  'feat(app): hold execution across frames input and media':
    { note: 'App execution holds stop owned frames, input and media.' },
  'feat(storage): await asynchronous host persistence':
    { note: 'Storage exposes asynchronous write acknowledgment.' },
  'fix(text): rasterize enlarged bitmap glyphs within atlas limits':
    { note: 'Bitmap glyphs survive enlarged text and camera zoom.' },
  'feat(crazygames): add score submissions and saved training credits':
    { note: 'CrazyGames scores and saved training credits follow platform contracts.' },
  'feat(settings): configure CrazyGames client score encryption key':
    { note: 'CrazyGames scores and saved training credits follow platform contracts.' },
  'perf(text): cull cached glyph geometry per draw projection':
    { note: 'SDK text uploads only glyphs visible to the current draw pass.' },
  'perf(ui): keep text measurement atlases off GPU':
    { note: 'Text measurement avoids GPU glyph pages.' },
  'feat(crazygames): connect Web ads storage and host audio policy':
    { note: 'CrazyGames Web exports connect the official v3 SDK.' },
  'feat(settings): add CrazyGames Web channel selection':
    { note: 'CrazyGames Web exports connect the official v3 SDK.' },
  'fix(ui): scope inline text cleanup and release measurement pages':
    { note: 'Inline rich text releases its own measurement atlas.' },
  'docs(poki): document official Inspector URL validation':
    { note: 'Poki training documents the official Inspector URL workflow.' },
  'fix(ui): release text input measurement atlases on exit':
    { note: 'Input fields release their measurement glyph pages on exit.' },
  'chore(release): classify 0.83 host verification coverage':
    { internal: 'classifies release evidence scope without changing shipped runtime behavior' },
  'fix(text): isolate App glyph caches and release owned pages':
    { note: 'Text atlases belong to each App and release their pages on exit.' },
  'fix(audio): preserve latest Web device suspension intent':
    { note: 'Web audio preserves the latest device pause intent.' },
  'feat(poki): add authored training gameplay flow':
    { note: 'Poki training reports authored gameplay and ad outcomes.' },
  'feat(editor): point Poki settings to the training example':
    { note: 'Poki training reports authored gameplay and ad outcomes.' },
  'fix(text): preserve full transforms in SDK label rendering':
    { note: 'SDK text follows the full parent transform and skips collapsed labels.' },
  'feat(web): connect Poki channel exports to ads services':
    { note: 'Web exports can select the Poki channel.' },
  'feat(editor): expose Poki Web distribution channel':
    { note: 'Web exports can select the Poki channel.' },
  'fix(renderer): skip collapsed flat hierarchies without epsilon culling':
    { note: 'Collapsed 2D hierarchies skip geometry and recover reliably.' },
  'fix(ads): reject overlapping advertising requests':
    { note: 'Advertising requests preserve a single active break.' },

  'fix(ui): align affine visuals with picking and mask bounds':
    { note: 'UI geometry, picking and scissors retain parent-induced shear.' },
  'fix(sprite): enforce tile budgets before integer conversion':
    { note: 'Extreme sprite tile counts reach the bounded fallback on native hosts.' },
  'fix(sprite): preserve affine geometry and mirrored tile grids':
    { note: 'Sprites retain parent-induced shear in every draw mode.' },
  'fix(text): preserve long bitmap strings and cull hidden glyphs':
    { note: 'Long native bitmap text preserves UTF-8 content without uploading hidden glyphs.' },
  'feat(playable): verify scenarios in headless Chromium':
    { note: 'Playable scenarios run in headless Chromium and save bound evidence.' },

  'feat(playable): adapt asset quality to measured delivery budgets':
    { note: 'Playable asset quality adapts to the measured delivery budget.' },
  'feat(editor): show playable asset optimization decisions':
    { note: 'Playable asset quality adapts to the measured delivery budget.' },


  'fix(text): transform native bitmap glyphs and ink bounds':
    { note: 'Native bitmap text follows its complete world transform.' },
  'fix(playable): honor authored texture and audio optimization':
    { note: 'Playable exports honor authored image and audio optimization.' },

  'fix(playable): bind preview records to delivery hashes':
    { note: 'Playable preview records identify the delivered archive.' },


  'fix(ui): bound mask traversal and skip empty viewport geometry':
    { note: 'UI masks handle deep hierarchies and empty viewports.' },
  'fix(transform): preserve reflected world transforms and UI bounds':
    { note: 'World transforms preserve mirrored axes.' },

  'fix(playable): verify required SDK script presence and order':
    { note: 'Playable checks verify mandatory SDK scripts and placement.' },
  'feat(editor): label required host SDK export checks':
    { note: 'Playable checks verify mandatory SDK scripts and placement.' },

  'fix(renderer): mirror nine-slice cells and texture borders':
    { note: 'Nine-slice texture flips preserve asymmetric borders.' },
  'fix(renderer): fit nine-slice borders inside small boxes':
    { note: 'Small nine-slice visuals keep borders inside their box.' },
  'fix(docs): escape playable size limits in MDX':
    { internal: 'escapes a less-than sign in both translations so the existing size-limit text compiles as MDX and the release website can deploy' },
  'feat(playable): preview creatives in local mock containers':
    { note: 'Playable creatives have a local container preview.' },
  'feat(playable): report export checks and pending acceptance':
    { note: 'Playable exports report static checks and pending acceptance.' },
  'feat(editor): show playable export checks in package results':
    { note: 'Playable exports report static checks and pending acceptance.' },

  'perf(ui): skip fully transparent visual geometry':
    { note: 'Fully transparent UI visuals skip geometry uploads.' },
  'fix(playable): pass store destinations through the CTA bridge':
    { note: 'MRAID store clicks carry their destination.' },
  'fix(playable): observe MRAID readiness and viewability':
    { note: 'MRAID playables wait for ready and viewable hosts.' },
  'fix(ui): split long text before glyph indices wrap':
    { note: 'Long text preserves glyphs beyond the 16-bit index limit.' },
  'feat(playable): package TikTok and overseas Pangle creatives':
    { note: 'TikTok and overseas Pangle package the same playable project.' },
  'perf(ui): reuse text geometry during inherited opacity fades':
    { note: 'UI text fades reuse cached geometry.' },
  'fix(ui): keep pointer carets outside surrogate pairs':
    { note: 'Pointer carets keep supplementary characters intact.' },
  'fix(ui): deliver native text input events within the UI frame':
    { note: 'Native text-input notifications survive frame boundaries.' },
  'fix(ui): preserve rich text shadow and outline colors':
    { note: 'Rich-text colors no longer recolor shadows and outlines.' },
  'fix(ui): apply inherited opacity to all text passes':
    { note: 'UI text effects follow inherited opacity.' },
  'test(renderer): cover clip recovery between camera passes':
    { internal: 'adds cross-camera regression coverage for empty text and skeletal clips and their recovery; no runtime behavior changes' },
  'fix(release): deploy website after mirrored metadata is ready':
    { note: 'Release websites wait for mirrored download metadata.' },
  'perf(renderer): skip hidden text and skeletal vertex conversion':
    { note: 'Hidden text and skeletal batches skip vertex conversion.' },
  'perf(renderer): cull bulk draws before staging geometry':
    { note: 'Camera-excluded bulk draws skip transient geometry.' },
  'feat(playable): add Mintegral container lifecycle':
    { note: 'Playable exports handle Mintegral start, completion and retry.' },
  'perf(renderer): reject full texture runs before copying indices':
    { note: 'Full texture batches avoid unused index copies.' },
  'fix(examples): distinguish motion requests from sensor samples':
    { note: 'Mobile controls share InputMap and device capability results.' },
  'feat(examples): refresh sprite rendering with CC0 space art':
    { note: 'Sprite rendering has a complete space art example.' },
  'fix(renderer): preserve depth bias and buffer identity in batch merges':
    { note: 'Batch merging preserves depth bias and geometry bindings.' },
  'perf(renderer): coalesce sorted 2d batch index gaps':
    { note: 'Sorted 2D batches join across emission index gaps.' },
  'fix(inspector): read current native parent membership in runtime snapshots':
    { note: 'Runtime hierarchy inspection follows native parent additions and removals.' },
  'perf(inspector): index script names once per runtime tree snapshot':
    { note: 'Runtime tree inspection indexes script component names once per snapshot.' },
  'perf(inspector): reuse hierarchy links for selected runtime details':
    { note: 'Selected runtime details reuse maintained hierarchy links.' },
  'feat(input): add mobile controls and device services':
    { note: 'Mobile controls share InputMap and device capability results.' },
  'feat(editor): author and verify mobile controls in Play':
    { note: 'Mobile controls share InputMap and device capability results.' },
  'fix(inspector): clear destroyed runtime entity selections':
    { note: 'Runtime inspectors clear destroyed entity selections.' },
  'perf(inspector): reuse membership and readers for snapshot visibility':
    { note: 'Runtime snapshots reuse visibility membership and direct readers.' },
  'perf(ecs): batch builtin component inspection through the core':
    { note: 'Runtime inspection batches builtin membership across the core boundary.' },
  'perf(ecs): avoid duplicate component checks during inspection':
    { note: 'Runtime inspection avoids duplicate builtin component checks.' },
  'perf(renderer): allocate transient stream storage on first use':
    { note: 'Unused transient streams no longer reserve GPU buffers.' },
  'fix(profiler): label live gpu storage estimates':
    { note: 'GPU memory estimates include buffers and render targets.' },
  'fix(profiler): account for live gpu resource storage':
    { note: 'GPU memory estimates include buffers and render targets.' },
  'fix(profiler): capture every frame from the play realm':
    { note: 'Play-mode performance captures include every recorded frame.' },
  'fix(physics): retain edits made to inactive 2d bodies':
    { note: 'Inactive 2D bodies retain pending collider and body edits.' },
  'fix(animation): refresh replaced clips on paused sprites':
    { note: 'Paused sprites refresh replaced animation clips.' },
  'fix(ui): bound scrollbar geometry for empty viewports':
    { note: 'Empty and collapsed scroll views keep finite scrollbar geometry.' },
  'perf(ui): avoid geometry writes for idle scrollbar thumbs':
    { note: 'Idle scrollbars stop forcing UI layout work.' },
  'fix(tilemap): refresh layers after tileset publication changes':
    { note: 'Running tilemaps follow published tileset updates.' },
  'fix(tilemap): own lazy tileset loads and retry failures':
    { note: 'Lazy tilemaps acquire and release tileset slots correctly.' },
  'fix(tilemap): compare cell dimensions independently':
    { note: 'Fractional tile cell edits refresh the drawn and hit grids.' },
  'fix(scene): reject mutations from unloaded contexts':
    { note: 'Unloaded scene contexts reject late mutations.' },
  'fix(scene): transfer ownership when adopting live entities':
    { note: 'Scene adoption transfers existing entity ownership.' },
  'fix(scene): retire ownership records on world despawn':
    { note: 'Scenes forget runtime entities when the World destroys them.' },
  'fix(audio): bind asset releases to retained buffer generations':
    { note: 'Old audio asset leases do not release replacement clips.' },
  'fix(audio): retire pending loads when clip sources change':
    { note: 'Audio source updates retire pending decodes.' },
  'fix(audio): release decodes that finish after disposal':
    { note: 'Late audio decodes do not repopulate closed devices.' },
  'fix(editor): preserve skeletal dependencies across failed reloads':
    { note: 'Missing skeletal sources keep their recovery paths.' },
  'fix(editor): refresh skeletal previews after directory changes':
    { note: 'Skeletal previews reload after directory changes.' },
  'fix(asset): refresh deleted and restored sprite images':
    { note: 'Deleted sprite images clear and restored images reload.' },
  'fix(editor): release obsolete bindings after skeletal loads':
    { note: 'Late skeletal loads release obsolete viewport bindings.' },
  'fix(editor): refresh open skeletal scenes after source edits':
    { note: 'Open skeletal scenes refresh after source edits.' },
  'fix(asset): invalidate resident skeletal atlas images':
    { note: 'Skeletal atlas edits invalidate resident textures.' },
  'fix(dragonbones): release atlas pages with their skeleton owners':
    { note: 'DragonBones atlas textures follow skeleton ownership.' },
  'fix(scene): roll back entities after publication failures':
    { note: 'Late scene-load errors roll back the new entities.' },
  'fix(prefab): roll back prepared spawns on parent rejection':
    { note: 'Prepared prefab spawns reject failed parent attachments.' },
  'fix(asset): transfer standalone spawn resources to entity owners':
    { note: 'Standalone scene and prefab spawns release their resources.' },
  'fix(prefab): roll back spawns when parent attachment fails':
    { note: 'Prefab spawns roll back when their parent disappears.' },
  'fix(scene): reject transitions when completion callbacks fail':
    { note: 'Scene completion errors settle the transition promise.' },
  'feat(examples): demonstrate independent sprite playback controls':
    { note: 'Sprite playback can be tried independently of its state machine.' },
  'fix(ui): stop released scroll flings on input cancellation':
    { note: 'Input cancellation stops released scroll flings.' },
  'fix(input): reset native input when the host hides':
    { note: 'Native input resets when the host hides.' },
  'fix(input): preserve gestures when touch IDs are reused':
    { note: 'Reused touch IDs preserve both gestures.' },
  'fix(input): cancel touch state when mini-games hide':
    { note: 'Cancelled touch input no longer becomes a click.' },
  'fix(storage): preserve empty mini-game values':
    { note: 'Mini-game storage preserves empty strings.' },
  'fix(examples): restore audio preferences across game restarts':
    { note: 'Audio preferences survive game restart.' },
  'fix(test): await atomic scale-report persistence':
    { internal: 'Scale measurements await their ordered report writes; budgets and measured operations are unchanged.' },
  'feat(cache): protect offline versions during budget cleanup':
    { note: 'Disk cache budgets preserve offline content versions.' },
  'feat(profiler): manage connected-device disk caches':
    { note: 'Disk cache budgets preserve offline content versions.' },
  'fix(cache): repair legacy entries and verify release artifacts':
    { note: 'Release optimization commits valid WASM artifacts atomically.' },
  'fix(ci): keep cache verifier comments within source gates':
    { internal: 'Verification fixture comments and generated-output exclusion do not change a shipped game or editor.' },
  'perf(editor): reuse lightmap workers for relighting':
    { note: 'Lightmap bounces reuse exact gather visibility.' },
  'fix(lightmap): align CLI poses with runtime precision':
    { note: "Command-line baking uses the editor's transform precision." },
  'perf(lightmap): reuse exact gather visibility across bounces':
    { note: 'Lightmap bounces reuse exact gather visibility.' },
  'test(audio): certify authored source playback after packaging':
    { note: 'Authored sound is verified in a packaged game.' },
  'fix(test): resolve golden output paths before spawning tools':
    { note: 'Package verification resolves output folders consistently.' },
  'fix(animation): hand off completed native tween loops':
    { note: 'Finite native tween loops hand off their sequences.' },
  'fix(animation): preserve looping tween phase across long frames':
    { note: 'Looping tweens preserve long-frame remainder.' },
  'fix(animation): complete immediate value tweens safely':
    { note: 'Immediate value tweens produce their endpoint.' },
  'fix(animation): preserve value tween callback control':
    { note: 'Value tween callbacks preserve playback control.' },
  'fix(animation): honor activity changes during frame callbacks':
    { note: 'Animation callbacks respect entity activity immediately.' },
  'fix(ui): preserve focus selected by text submit handlers':
    { note: 'Text submission preserves callback-selected focus.' },
  'fix(ui): bind text input events to the active session':
    { note: 'Text input events stay with the active editing session.' },
  'perf(ui): measure text caret prefixes in one pass':
    { note: 'Text caret picking measures long strings once.' },
  'fix(ui): reject input on disabled text fields':
    { note: 'Disabled text fields reject queued input.' },
  'fix(ui): blur removed text input surfaces':
    { note: 'Removed text fields release OS input focus.' },
  'fix(ui): isolate text input cleanup per app':
    { note: 'Text input surfaces stay with their own apps.' },
  'fix(render): refresh tilemap meshes after layout changes':
    { note: 'Tilemap atlas and grid edits refresh cached meshes.' },
  'perf(physics): reuse static parent transform snapshots':
    { note: 'Static siblings reuse their parent transform snapshot.' },
  'fix(ecs): compose transforms through transformless groups':
    { note: 'Transformless hierarchy groups preserve child world poses.' },
  'fix(tilemap): preserve inactive layers and own runtime colliders':
    { note: 'Tilemap activity preserves painted data and owns generated collision.' },
  'fix(physics): synchronize static body transforms in place':
    { note: 'Static 2D bodies follow authored transforms and parent movement.' },
  'fix(tilemap): invalidate caches when a layer is recreated':
    { note: 'Recreated tilemap layers discard old geometry and collision.' },
  'fix(tilemap): isolate runtime tools and scene codecs per world':
    { note: 'Tilemap runtimes and saved chunks stay with their own worlds.' },
  'fix(tilemap): rebuild native collision after live map edits':
    { note: 'Native tilemap collisions follow live edits.' },
  'perf(tilemap): skip unchanged tile writes and empty chunk allocation':
    { note: 'Unchanged tile writes preserve chunk caches.' },
  'fix(audio): distinguish source completion from interrupted voices':
    { note: 'Audio sources distinguish interrupted voices from completed clips.' },
  'fix(editor): refresh camera previews against the live CPU budget':
    { note: 'Camera preview scheduling follows its current CPU budget.' },
  'fix(test): unregister mini-game host keyboard subscribers':
    { note: 'Mini-game verification unregisters keyboard callbacks.' },
  'fix(test): forward mini-game touch gestures in package verification':
    { note: 'Mini-game verification forwards touch gestures.' },
  'fix(ui): integrate inertial scroll distance across frame rates':
    { note: 'Inertial scrolling travels consistently across frame rates.' },
  'fix(video): synchronize the decoded endpoint before playback ends':
    { note: 'WASM video progress reaches the decoded endpoint.' },
  'fix(video): support duration and seeking for single-timestamp streams':
    { note: 'Single-timestamp MPEG videos report duration and support seeking.' },
  'fix(video): synchronize live component playback settings':
    { note: 'Video component playback settings update live streams.' },
  'fix(video): isolate plugin cleanup and stream ownership per app':
    { note: 'Video plugin cleanup releases only the selected App.' },
  'fix(video): replace live streams when component sources change':
    { note: 'Video components switch streams when their source changes.' },
  'fix(export): reject failed video transcoding for wasm targets':
    { note: 'WASM video exports fail when required transcoding fails.' },
  'fix(export): prune obsolete cooked assets and packs':
    { note: 'Repeated exports remove obsolete cooked assets and packs.' },
  'fix(export): remove obsolete web runtime files on rebuild':
    { note: 'Repeated Web exports drop obsolete runtime files.' },
  'fix(editor): report failed exports accurately':
    { note: 'Editor export results report failed builds accurately.' },
  'fix(assets): release app-owned loaders during plugin cleanup':
    { note: "Asset loaders release their App's resources on shutdown." },
  'fix(particles): refresh LUT heap views after allocation':
    { note: 'Particle gradient uploads survive WASM memory growth.' },
  'fix(input): cancel held web input on focus loss':
    { note: 'Web focus loss cancels held pointer input and pending edges.' },
  'fix(audio): retain mini-game playback intent during device suspension':
    { note: 'Mini-game audio keeps playback ownership through device suspension.' },
  'fix(profiling): attribute async Box2D systems to physics':
    { note: 'Async Box2D systems retain their physics performance category.' },
  'fix(physics): isolate async Box2D module ownership by app':
    { note: 'Box2D initialization and shutdown belong to their App.' },
  'perf(render): skip geometry outside UI scissor viewports':
    { note: 'Screen-excluded UI scissor regions no longer submit draws.' },
  'fix(animation): isolate despawn subscriptions by app':
    { note: 'Animation despawn subscriptions belong to their App.' },
  'perf(animation): apply sprite frames through direct storage accessors':
    { note: 'Sprite animation applies frames through direct component accessors.' },
  'fix(audio): share native completion events across backend subscribers':
    { note: 'Native audio completion subscriptions are independent.' },
  'fix(audio): retire platform handles before completion callbacks':
    { note: 'Mini-game and native audio completion retires ownership before callbacks.' },
  'fix(audio): freeze fade clocks during device suspension':
    { note: 'Audio device suspension freezes volume fades.' },
  'fix(audio): preserve manual minigame pauses on device resume':
    { note: 'Mini-game device resume preserves manual audio pauses.' },
  'fix(audio): isolate plugin cleanup by app':
    { note: 'Audio plugin cleanup belongs to each App.' },
  'fix(audio): guard reused pool nodes from retired handles':
    { note: 'Retired WebAudio handles cannot modify reused pool nodes.' },
  'fix(audio): retain paused voice ownership and tracked base gains':
    { note: 'Paused voices remain owned by the audio API.' },
  'fix(audio): preserve playback position across rate changes':
    { note: 'WebAudio position stays continuous across playback-rate changes.' },
  'fix(audio): apply live source parameters without restarting voices':
    { note: 'Playing audio sources follow live parameter edits.' },
  'fix(ui): bound ancestor traversal across cyclic hierarchy adapters':
    { note: 'UI ancestor walks terminate on malformed hierarchy adapters.' },
  'fix(ui): retire unavailable dropdown popups before selection':
    { note: 'Unavailable dropdowns retire their open lists.' },
  'fix(ui): reconcile dropdown options and guard popup teardown':
    { note: 'Dropdown labels and open rows follow live option edits.' },
  'fix(ui): reconcile toggle indicator targets and callback removals':
    { note: 'Toggle indicators follow target replacements safely.' },
  'fix(ui): cancel unavailable slider capture and use local track dimensions':
    { note: 'Slider capture expires with input and target availability.' },
  'fix(ui): reconcile slider visuals after range and target edits':
    { note: 'Slider visuals follow range and target edits.' },
  'fix(ui): retire object drag capture before cancelled movement':
    { note: 'Object drags stop when their input or target becomes unavailable.' },
  'fix(ui): cancel scroll capture and motion when input ownership changes':
    { note: 'Cancelled scroll gestures stop without flinging.' },
  'fix(ui): apply live scroll settings and isolate replaced motion':
    { note: 'Scene scroll settings update while the game is running.' },
  'fix(ui): follow scroll content hierarchy and reference changes':
    { note: 'Scroll views follow content hierarchy edits.' },
  'fix(ui): resize scroll extents together and retire missing content':
    { note: 'Scroll views retain valid offsets across simultaneous resizes.' },
  'fix(ui): keep hit testing from bypassing interaction membership':
    { note: 'Scene-authored scroll views receive hover and wheel input.' },
  'fix(input): retire held state when release events are consumed':
    { note: 'Claimed input releases cannot leave gameplay controls held.' },
  'fix(ui): release gesture bindings and expire cancelled click markers':
    { note: 'UI gesture bindings expire with their targets and App.' },
  'fix(ui): scope safe-area resize subscriptions to their apps':
    { note: 'Safe-area resize listeners belong to their App.' },
  'fix(camera): align canvas fitting with hierarchy and scene filters':
    { note: 'Camera fitting and editor previews use outer canvases consistently.' },
  'fix(editor): use outer canvases for previews and UI hosting':
    { note: 'Camera fitting and editor previews use outer canvases consistently.' },
  'fix(ui): traverse nested canvases once and inherit their layers':
    { note: 'Nested canvases keep their parent layout and authored draw order.' },
  'fix(ui): bound hierarchy walks and preserve sibling order':
    { note: 'UI hierarchy walks tolerate deep scene groups and broken child links.' },
  'fix(ui): preserve traversal spans for large subtrees':
    { note: 'Large UI subtrees keep their full traversal span.' },
  'perf(ui): preserve transform composition across clean layout passes':
    { note: 'Static UI layout preserves composed world transforms.' },
  'fix(ui): bound hit caches to live pointer frames':
    { note: 'Touch hit caches release ended pointer IDs.' },
  'fix(ui): cancel pointer events invalidated by callbacks':
    { note: 'Pointer callbacks cancel invalid UI interactions immediately.' },
  'fix(ui): revalidate focus targets after synchronous callbacks':
    { note: 'UI focus transitions recheck callback changes.' },
  'fix(animation): guard reentrant updates and frame-list changes':
    { note: 'Sprite callbacks cannot recursively advance the same animation update.' },
  'fix(build): link context tests with WebGL 2 symbols':
    { internal: 'The context regression harness pulls in the WebGL overload even with a mock backend; its normal and sanitizer links require the same WebGL 2 symbols as the engine. Shipping engine behavior is unchanged.' },
  'fix(animation): preserve elapsed phase and coalesce crossed events':
    { note: 'Sprite playback catches up without replaying a time backlog.' },
  'fix(animation): preserve listener snapshots and callback ownership':
    { note: 'Sprite animation events tolerate listener and entity changes.' },
  'fix(tilemap): scope paint strokes and respect layer locks':
    { note: 'Tilemap edits respect layer locks and stroke ownership.' },
  'fix(editor): sync tilemap stroke ownership checks':
    { note: 'Tilemap edits respect layer locks and stroke ownership.' },
  'fix(engine): register tilemap data before renderer initialization':
    { note: 'Tilemap data is available before renderer initialization.' },
  'fix(tilemap): complete bounded fills and avoid repeated boundary reads':
    { note: 'Tilemap bucket fills finish every discovered cell within the safety limit.' },
  'fix(editor): sync bounded tilemap fill corrections':
    { note: 'Tilemap bucket fills finish every discovered cell within the safety limit.' },
  'fix(tilemap): discard obsolete layer palette reads':
    { note: 'Switching tilemap layers clears the previous palette before drawing.' },
  'fix(editor): sync tilemap layer loading cancellation':
    { note: 'Switching tilemap layers clears the previous palette before drawing.' },
  'fix(tilemap): keep palette selection and reuse loaded assets':
    { note: 'Tilemap palette refresh keeps the selected tileset.' },
  'fix(editor): sync tilemap palette refresh changes':
    { note: 'Tilemap palette refresh keeps the selected tileset.' },
  'fix(docs): restore the original README showcase':
    { note: 'The website keeps its original editor showcase.' },
  'fix(site): restore the original editor showcase':
    { note: 'The website keeps its original editor showcase.' },
  'fix(site): serve download metadata from the website origin':
    { note: 'Website download details load from the same origin.' },
  'test(ui): type the required layout measurement in the WASM regression':
    { internal: 'The real-WASM viewport regression requires the measured-height export; its non-null type assertion matches the verified test precondition without changing runtime code.' },
  'fix(ui): synchronize virtualized lists with resolved viewport bounds':
    { note: 'Virtualized lists follow their resolved UI viewport.' },
  'fix(samples): keep virtualized UI inside device safe areas':
    { note: 'Native UI follows the device safe area.' },
  'fix(verification): read renderer counters after a completed frame':
    { internal: 'Packaged-game acceptance waits for actual render frames before reading counters and separates Windows Electron app arguments; shipping engine and editor behavior are unchanged.' },
  'fix(native): keep authored UI inside live device safe areas':
    { note: 'Native UI follows the device safe area.' },
  'chore(release): isolate compositor capture and preserve GPU diagnostics':
    { internal: 'Release-only capture separates the virtual-display compositor from software WebGL, retains game-canvas/window images and logs, and continues to fail on any game error; runtime behavior is unchanged.' },
  'fix(editor): resolve the installed macOS executable from its bundle metadata':
    { note: 'The installed macOS MCP entry launches the bundled editor.' },
  'fix(editor): preserve prefab painter order when saving scenes':
    { note: 'Saving Prefab instances preserves authored draw order.' },
  'chore(release): verify installed editor upgrades before publishing':
    { internal: 'Release acceptance installs the previous and candidate packages on clean CI hosts and verifies saved project continuity before publication; editor and runtime behavior are unchanged.' },
  'fix(editor): keep camera preview refresh within its CPU budget':
    { note: 'Camera previews keep a conservative CPU budget.' },
  'fix(release): publish a verified frame of the exported sample':
    { note: 'The website preview comes from the exported game.' },
  'fix(render): preserve sprites with incompatible WebGL S3TC dimensions':
    { note: 'Compressed sprites keep their authored dimensions on WebGL.' },
  'fix(sdk): keep indexed access valid for strict consumers':
    { internal: 'Preserves supported pool and cleanup behavior while satisfying strict compiler consumer type checks.' },
  'fix(sdk): resolve spawned entities before tracking scene ownership':
    { note: 'Scene assets have scoped ownership.' },
  'Fix engine activity, asset ownership and material rendering':
    { note: 'Entity activity follows the hierarchy.' },
  'Strengthen import and native release verification':
    { note: 'Imported material textures resolve correctly.' },
  'Own live material texture bindings and preserve asset identities':
    { note: 'Material state can be applied as one complete snapshot.' },
  'Skip stale queued material previews after disposal or reconnect':
    { note: 'Asset previews release obsolete work.' },
  'Fix editor document lifecycle and runtime integration':
    { note: 'Scene assets have scoped ownership.' },
  'Fix asset preview ownership and material editing':
    { note: 'Asset previews release obsolete work.' },
  'Apply material texture edits with scoped async ownership':
    { note: 'Live material texture edits match saved Play.' },
  'Cancel queued asset previews when the scene lifetime ends':
    { note: 'Asset previews release obsolete work.' },
  'Keep scene bindings coherent when resource cleanup fails':
    { note: 'Asset previews release obsolete work.' },
  'Isolate audio preview failures and stop previews on project replacement':
    { note: 'Audio preview failures stay with their own clip.' },
  'Make audio waveform previews cancellable and preserve every channel':
    { note: 'Waveforms preserve every audio channel.' },
  'fix(audio): stop all tracked voices during device disposal':
    { note: 'Stopping editor Play stops game audio.' },
  'fix(editor): release game audio on warm Play stop':
    { note: 'Stopping editor Play stops game audio.' },
  'perf(i18n): cache bounded plain translations with invalidation':
    { note: 'Unchanged plain translations use a bounded cache.' },
  'fix(editor): stabilize camera previews and hidden authoring checks':
    { note: 'A selected camera has a preview without advancing gameplay.' },
  'fix(release): prepare v0.77.0 candidate and portable validation':
    { note: 'Release checks compare the content that ships.' },
  'feat(build): the size panel says which budget each byte is on':
    { note: "The build's size panel marks which files are in a subpackage." },

  'fix(size): a subpackage is off the main package, and a compressed engine is still the engine':
    { note: "The size report counts a mini-game's main package without its subpackages." },

  'fix(project): seven packaging settings a project could declare did nothing':
    { note: "A WeChat package can put its engine binary in a compressed subpackage." },

  'feat(play): a cold start that never says hello now says what its frame did':
    { note: 'A game that fails to start says what its frame actually did.' },

  'refactor(theme): a type scale with one job per step, and steps you can tell apart':
    { note: "The editor's smaller labels are readable — one body size instead of three within 2px." },

  'refactor(theme): one name per value — three alias vocabularies collapse into one':
    { internal: "Editor token names only; the editor looks pixel-identical and no creator writes them." },

  "fix(export): a web package no longer carries another host's SDK":
    { note: "A web build stops shipping the WeChat SDK entries next to the one its page loads." },

  'fix(pipeline): the esengine specifiers a game can write are the ones the SDK publishes':
    { note: 'A page no longer carries a module mapping that resolves to a file it does not have.' },

  'fix(sdk): a subsystem installs one plugin, however many callers registered it':
    { note: 'A build that ships Spine or DragonBones installs one of each again, not two.' },

  'fix(scale): the frame ceilings are set from both machines, not one':
    { internal: 'A repository perf budget; no creator runs it.' },

  'fix(scale): a wasm budget is denominated in wasm, not in a JS loop':
    { internal: 'A repository perf budget; no creator runs it.' },

  'docs(theme): the alias block says what it is, not what it was for':
    { internal: "A comment in the editor's token file; nothing a creator sees changes." },

  'fix(docs): the plugin manual named two CSS variables the editor does not have':
    { note: 'A plugin styled from the manual gets the editor\'s real colours instead of none.' },

  'fix(editor): six CSS variables that were never defined, so they drew nothing':
    { note: "The Inspector's effect stack draws its toggle, its rows and its Add button again." },

  'feat(gates): a CSS variable that nothing defines is refused':
    { internal: "A repository gate over the editor's own stylesheets; no creator runs it." },

  'fix(examples): the starfield tiles, as its texture was drawn to':
    { note: "space-shooter's background no longer stretches a 256px starfield over the whole screen." },

  'chore(gates): the reds behind the first one':
    { internal: 'Generated artifacts and gate bookkeeping; nothing a creator sees changes.' },

  'test(editor): a sprite tiles when its scene says to, and stops when told not to':
    { internal: 'A repository check over the editor; no creator runs it.' },

  "feat(editor): a whole screen's heading is a step of the scale, not a raw 25px":
    { internal: 'One heading moved onto an existing scale; nothing a creator sees changes size.' },

  'fix(api): a public field may not be typed by an unfrozen enum':
    { internal: 'A tier declaration on a generated enum; the type a creator sees is unchanged.' },

  'feat(gates): the editor counts the controls it rolled by hand':
    { internal: "A repository ratchet over the editor's own components; no creator runs it." },

  'test(sdk): the optional subsystems are asserted against what ships, not what compiles':
    { internal: 'A repository test over the built bundle; no creator runs it.' },

  'fix(sdk): a subsystem registers by being called, not by being imported':
    { note: 'An optional subsystem is installed again in builds where a bundler had dropped it.' },

  'fix(api): a new component field is optional, so a frozen promise holds':
    { note: 'Sprite.drawMode is optional, so existing SpriteData code still compiles.' },

  'feat(gates): a colour that names a thing only colours that thing':
    { internal: "A repository gate over the editor's own palette; no creator runs it." },

  'fix(editor): a viewport colour names a thing, and four panels borrowed one':
    { note: 'Record, mute, delete and unsaved read as what they are, not as viewport colours.' },

  'feat(editor): the build dialog offers Douyin, because the registry says it exists':
    { note: 'Douyin is selectable in the build dialog and has its own texture Import'
      + ' Settings tab.' },

  "feat(gates): the visual layer's drift is measured, not just its contrast":
    { internal: "A repository gate over the editor's own stylesheets and icons; no creator runs it." },

  "feat(runtime): a mini-game reports its boot through the host's indicator":
    { note: 'A mini-game says how far along its boot is, not just that it is loading.' },

  'fix(gates): the notes ledger parses again':
    { internal: 'Repairs this very file after a quote broke it; no creator reads it.' },

  'perf(sdk): a declaration list is an authority, not a build entry':
    { internal: 'Withdraws an unmeasured build entry from the commit before it; a package is 1,794 bytes lighter than that mistake, and unchanged otherwise.' },

  'fix(gates): the optional-subsystem ratchet counts what a package actually holds':
    { internal: "A repository gate over the SDK's own imports; no creator runs it." },

  'feat(export): a project can be packaged for Douyin':
    { note: 'A project can be exported as a Douyin (抖音) mini-game.' },

  'feat(render): a sprite says how it fills its box, instead of its texture saying':
    { note: 'A sprite can be drawn whole even when its texture carries a 9-slice border.' },

  'refactor(sdk): 2D physics declares where its declarations end':
    { internal: 'Where the same code lives; behaviour and the public surface are unchanged.' },

  'feat(export): a mini-game carries the optional subsystems its project uses':
    { note: 'A WeChat mini-game now carries only the optional subsystems its project uses.' },

  'refactor(sdk): the core runtime names no optional subsystem at all':
    { internal: 'Same subsystems, same behaviour; a lean build now says when it ships without one.' },

  'refactor(sdk): the scene loader asks for Spine and DragonBones, and does not name them':
    { internal: 'Same subsystems, same behaviour; only which file reaches them changed.' },

  'refactor(sdk): an entry point decides which optional subsystems it ships':
    { internal: 'The same plugins are installed; only which file names them changed.' },

  "feat(gates): the core runtime's pull on optional subsystems is a ratchet":
    { internal: 'A repository gate over the SDK\'s own imports; no creator runs it.' },

  'feat(export): a mini-game package says which subsystem each byte came from':
    { internal: 'A field on the export result; no panel shows it yet, so nothing a creator sees.' },

  'feat(export): a packaged game says it is loading':
    { note: 'A packaged game now says it is loading.' },

  'fix(checks): a play realm that never came up says what it did say':
    { internal: "What an editor check prints when it fails; no creator runs the checks." },

  'fix(gates): the exit criteria ask a host only what that host can answer':
    { internal: 'Which CI shard answers which release criterion; no creator runs the list.' },

  'feat(gates): spacing off the 4px grid is a ratchet, not a demand for zero':
    { internal: "A repository gate over the editor's stylesheets; no creator runs it." },

  'fix(export): a mini-game package carries only what its packer will upload':
    { note: 'A WeChat package no longer carries files the upload would refuse.' },

  'refactor(assets): what a restaged .bin really is, answered in one place':
    { internal: 'One reader for a packaging spelling; what resolves is unchanged.' },

  "fix(export): the shared mini-game entry names no vendor's API":
    { internal: 'Fixes an unreleased commit from this same cycle; the shipped behaviour never had it.' },

  'feat(theme): a dialog title reads as a title':
    { note: "A dialog's title now looks like one." },

  'feat(export): the engine binary can ship in a 分包 the host loads at startup':
    { note: "The engine can ship outside a WeChat mini-game's main package entirely." },

  'feat(build): the engine binary can ship in a subpackage':
    { note: "The engine can ship outside a WeChat mini-game's main package entirely." },

  'refactor(export): the entry asks for the runtime where the layout put it':
    { internal: 'One author for a path inside the package; what it answers is unchanged.' },

  'fix(assets): a load that failed is warned, not only recorded':
    { note: 'An asset that fails to load says so.' },

  'feat(export): the engine binary can ship as .wasm.br to a host that takes one':
    { note: 'A WeChat mini-game can ship its engine compressed, freeing a third of the main' },

  'feat(build): a mini-game can ship its engine binary compressed':
    { note: 'A WeChat mini-game can ship its engine compressed, freeing a third of the main' },

  'fix(gates): project-health tests a warning with a field that still is one':
    { internal: "The preflight check's own fixture; it follows the sprite-texture change and no creator runs it." },

  'fix(gates): the MCP end-to-end tests required-empty with a field that still is one':
    { internal: "The end-to-end gate's own fixture; it follows the sprite-texture change and no creator runs it." },

  'fix(gates): a gate that needs a required field asks which one is still required':
    { note: 'A sprite with no texture is no longer reported as unfinished.' },

  'fix(export): a Meta playable is judged against the 5MB Meta publishes':
    { note: 'A Meta playable can spend all 5MB Meta allows.' },

  'feat(build): a preflight refusal about the content can be answered':
    { note: 'A build the preflight objects to can be packaged anyway.' },

  'fix(gates): the build adjudicator gate reads both halves of the decision':
    { internal: 'A repository gate reading the editor source; no creator runs it.' },

  'feat(gates): the text ramp is held to 4.5:1 on the surfaces text sits on':
    { note: "The editor's faintest label colour is readable." },

  'feat(gates): check-theme holds the panel ramp quieter than the viewport':
    { note: "The build size chart's video slice stops shouting." },

  "fix(theme): the size chart's video series is a panel colour, not a viewport one":
    { note: "The build size chart's video slice stops shouting." },

  "fix(gates): the acknowledged build's cleanup retries, as every recursive delete must":
    { internal: "An editor check's own temp-directory cleanup; no creator runs it." },

  'feat(render): the WebGPU backend draws the scene and the backbuffer multisampled':
    { note: 'Geometry edges are anti-aliased on WebGPU, which is every native build.' },

  'feat(build): a limit that is over names the files filling it, and what to do':
    { note: 'The build size report says why a file is in your package, and what changed since the' },
  'fix(inspector): a Sprite with no texture is not an unfinished entity':
    { note: 'A sprite with no texture is no longer reported as unfinished.' },

  'feat(build): the size panel says why a file is in the package, and what moved':
    { note: 'The build size report says why a file is in your package, and what changed since the' },

  'feat(export): the size report says why a file is in the package, and what moved':
    { note: 'The build size report says why a file is in your package, and what changed since the' },

  'feat(render): a game is told the device came back, and which target it drew is blank':
    { note: 'The picture comes back after the GPU is lost.' },

  'fix(render): a video and a canvas come back after the GPU is lost':
    { note: 'The picture comes back after the GPU is lost.' },

  'feat(render): the device warns when what it keeps for a loss passes a budget':
    { note: '`getResourceStats()` reports the memory kept to survive a lost GPU.' },

  'perf(render): glyph and skeleton atlas pages come back from what made them':
    { note: 'The picture comes back after the GPU is lost.' },

  'feat(render): the device counts the memory it keeps to survive a loss':
    { note: '`getResourceStats()` reports the memory kept to survive a lost GPU.' },

  'fix(render): the device rebuilds every object it issued behind the same handle':
    { note: 'The picture comes back after the GPU is lost.' },

  'fix(render): a vertex stage names gl_InstanceID only after its attributes':
    { note: '3D meshes draw on Windows with WebGL2 again.' },

  'fix(render): the probe block stays a constant buffer under ANGLE on D3D11':
    { note: 'An imported model lit by an environment with a reflection draws on Windows.' },

  'fix(render): a uniform changed after its first upload reaches WebGPU draws':
    { note: 'A material parameter changed after its first frame takes effect on WebGPU.' },

  'fix(platform): a hot update on a native build is stored under a name the host accepts':
    { note: 'A hot update on iOS, Android and desktop builds is still there after a restart' },

  'fix(export): the WeChat total budget is the 30MB WeChat allows':
    { note: 'A WeChat mini-game is judged against WeChat\'s real 30MB total.' },

  'fix(gates): a package is judged at one frame of game time per rendered frame':
    { internal: 'The package launcher the verifiers share; no creator runs it.' },

  'fix(gates): third-person runs its package on one frame of game time per frame':
    { internal: 'A verifier and its launcher; no creator runs them.' },

  'fix(render): a mesh with no colour channel draws, as white vertices':
    { note: 'A baked decal draws on devices and under WebGPU.' },

  'fix(render): a material that writes only its fragment draws on a mesh under WebGPU':
    { note: 'A material that writes only its fragment stage draws on a mesh under WebGPU and on' },

  'fix(gates): an Electron download the host refuses is retried, and third-person says when no game ran':
    { internal: 'Verifier tooling; no creator runs it.' },

  'fix(editor): a project opened from inside the editor finishes loading':
    { note: 'Opening a project from inside the editor no longer leaves the loading screen up.' },

  'feat(editor): one ledger says when the editor has caught up, and every capture waits for it':
    { note: 'An agent\'s picture of the editor shows the edit it made.' },

  'fix(checks): captures wait for an idle editor, and the per-check waits go':
    { internal: 'The editor checks\' capture helper; the editor did not change.' },

  'fix(tests): the flipbook creation test stubs the create door the clip now goes through':
    { internal: 'A test stub; the editor did not change.' },

  'fix(assets): adopting a file never replaces the sidecar its creator wrote':
    { note: 'A new prefab, material, animation clip or graph keeps the id it was created' },

  'fix(assets): a new asset\'s sidecar lands before its content, through one door':
    { note: 'A new prefab, material, animation clip or graph keeps the id it was created' },

  'fix(checks): gizmo-near-clip reads the beam once the viewport has drawn it':
    { internal: 'An editor check; the editor did not change.' },

  'fix(play): a realm whose frame was not in the page says so':
    { note: 'A Play that never comes up says how far it got.' },

  'fix(play): automation waits for Play as long as the session may take, and says why it failed':
    { note: 'A Play that never comes up says how far it got.' },

  'fix(checks): captures wait for a viewport that has stopped changing':
    { internal: 'The editor checks\' capture helper; the editor did not change.' },

  'fix(gates): the release-notes ledger reads whole histories, and says so when it cannot':
    { internal: 'A repository gate; no creator runs it.' },

  'fix(checks): camera-frustum takes a capture once two in a row agree on the viewport':
    { internal: 'An editor check; the editor did not change.' },

  'fix(checks): dodge-graph reads the HUD a frame after the loss, and a restart\'s leftovers by identity':
    { internal: 'An editor check; the editor did not change.' },

  'fix(checks): sprite-frame judges the picture the sprite reaches, not the first still one':
    { internal: 'An editor check; the editor did not change.' },

  'fix(play): a project prepares one play realm at a time':
    { note: 'Play started while the editor was still preparing it gets a whole game.' },

  'fix(tilemap): a layer hidden in Tiled is hidden in the game':
    { note: 'A layer hidden in Tiled stays hidden.' },

  'fix(play): a realm that misses its deadline is asked where it is, and a replaced one is not heard':
    { note: 'A Play that never comes up says how far it got.' },

  'fix(play): a Play that never comes up says how far it got':
    { note: 'A Play that never comes up says how far it got.' },

  'fix(automation): an editor a program drives ends when the program does':
    { note: 'An editor an agent started closes when the agent does.' },

  'fix(golden): Electron is fetched once before editors launch side by side':
    { internal: 'The golden verifier launching its own editors; no creator runs it.' },

  'fix(golden): a retry is handed the attempt that failed':
    { internal: 'What the golden verifier prints about its own retries.' },

  'fix(golden): a missing frame says what the attempt printed, and blames the GPU only on evidence':
    { internal: 'What the golden verifier prints about its own retries.' },

  'fix(ci): the parity frames a golden failure keeps are actually uploaded':
    { internal: 'CI artifacts only.' },

  'fix(golden): lighting-3d\'s points follow the surface shading at its real place':
    { internal: 'The expected pixels moved to where the surface is; the engine did not change.' },

  'fix(checks): dodge-graph plays paused, so only a step moves the player':
    { internal: 'An editor check; the editor did not change.' },

  'fix(checks): scatter-scale measures the editor\'s half, out of the eye\'s view':
    { internal: 'An editor check; the editor did not change.' },

  'fix(checks): camera-frustum captures after the toggle is drawn, not after a sleep':
    { internal: 'An editor check; the editor did not change.' },

  'feat(render): what a shiny thing reflects indoors is the room, not the sky':
    { note: 'What a shiny thing reflects indoors is the room, not the sky.' },

  'fix(lightmap): the bake\'s ray tracer walked its own tree wrong':
    { note: "The bake's ray tracer walked its own tree wrong." },

  'fix(lightmap): a scene with nothing in it no longer walks one node forever':
    { note: "The bake's ray tracer walked its own tree wrong." },

  'feat(bake): the editor bakes reflections too, and says which column each probe got':
    { note: 'What a shiny thing reflects indoors is the room, not the sky.' },

  'fix(render): a material shades at the place its surface really is':
    { note: 'A material-shaded surface shaded itself at z = 0.' },

  'fix(texture): WebGPU stops dividing a texture by its alpha twice':
    { note: 'A half-transparent texture looks the same on WebGPU as on WebGL2.' },

  'fix(render): a mirror reads its reflection at level 0 on WebGL2 too':
    { note: 'A mirror has no seam across it on WebGL2.' },

  'fix(native): the host evaluates a script by its size, not by strlen':
    { note: 'A native build runs a script that holds a NUL character.' },

  'fix(export): a playable exports from the hosts an editor ships':
    { note: 'The editor packages playable ads again.' },

  'fix(export): the editor prebuilds every host an export asks for':
    { note: 'The editor packages playable ads again.' },

  'fix(verify): a pixel gate whose scene could not load an asset fails and names it':
    { internal: 'Only the render gates read it: a scene missing an asset now fails its own check.' },

  'fix(verify): a scene load says which assets it could not load':
    { internal: 'The automation door the render gates drive; no creator calls it.' },


  'feat(render): a wall stops the frame from drawing what stands behind it':
    { note: 'A wall can stop a frame from drawing what is behind it.' },

  'feat(editor): the box an occluder blocks sight with, drawn where you place it':
    { note: 'A wall can stop a frame from drawing what is behind it.' },

  'feat(corpus): the corridor walls say sight stops at them':
    { note: 'A wall can stop a frame from drawing what is behind it.' },

  'feat(decal): a projector you can place, and a bake that prints it':
    { note: 'Decals you can place.' },

  'feat(decal): the surface under a projector, cut to its box':
    { note: "A decal's geometry, cut." },

  'feat(render): a material can say its surface goes ON another one':
    { note: 'A surface can say it goes ON another one.' },

  'feat(editor): a scatter brush, and one stroke that undoes in one step':
    { note: 'A scatter brush.' },

  'feat(render): the per-object record leaves the vertex attributes':
    { note: 'A mesh has somewhere to put its own vertex attributes.' },

  'feat(render): indirect light per instance, so a probe stops refusing the merge':
    { note: 'A scene can hold a thousand of something again.' },

  'test(render): the instancing check asks a scene that has probes in it':
    { internal: 'The check moved with the fix; what a creator sees is the fix.' },

  'feat(editor): what a frame costs, and the first check to ask about scale':
    { note: 'Automation can read what a frame cost.' },

  'feat(logic): a graph can call another graph, and pay for it out of one budget':
    { note: 'A graph can call another graph.' },

  'feat(logic): a signature to declare and a graph to call, on the shared canvas':
    { note: 'A graph can call another graph.' },

  'feat(scene): a graph can change the scene, through the door every surface holds':
    { note: 'A graph can change the scene.' },

  'feat(scene): the scene verbs describe themselves in the palettes':
    { note: 'A graph can change the scene.' },

  'feat(audio): a sound anything authored can start':
    { note: 'A sound anything authored can start.' },

  'feat(audio): the audio verbs describe themselves in the palettes':
    { note: 'A sound anything authored can start.' },

  'feat(logic): a graph can spawn a prefab, and the node says which one':
    { note: 'Gameplay you can draw.' },

  'feat(prefab): a prefab you can spawn in one frame, because its loading is done':
    { note: 'Gameplay you can draw.' },

  'feat(logic): a graph can reach a keyboard, another entity, and who an event named':
    { note: 'Gameplay you can draw.' },

  'feat(logic): wires that clear the nodes, nodes that say which one they are':
    { note: 'Gameplay you can draw.' },

  'feat(logic): gameplay you can draw, and a corpus that draws some':
    { note: 'Gameplay you can draw.' },

  'fix(play): Run brings the realm up from wherever the author is standing':
    { note: 'Run works from wherever you are standing.' },

  'fix(logic): a node starved of its input does not run on an invented value':
    { internal: 'Inside the script graph, which no shipped corpus authors yet.' },

  'feat(logic): a script graph is something you can draw':
    { internal: 'The editor half of the script graph. The whole feature gets one note once a shipped example authors a graph.' },

  'feat(logic): the edits a script-graph editor makes, and the rules they obey':
    { internal: 'The graph ops the panel drives. No creator meets them except through that panel.' },

  'feat(assets): a script graph is a live asset like the other authored graphs':
    { internal: 'The .esgraph asset slot. Nothing authors one yet — no panel, no new-asset entry.' },

  'feat(assets): the Content Browser knows a .esgraph when it sees one':
    { internal: 'Badge and icon for an asset type nothing can create yet.' },

  'feat(logic): an entity can carry a graph, and the graph can reach the world':
    { internal: 'The engine binding and the built-in value vocabulary. Still nothing authors a graph — the asset has no editor yet.' },

  'feat(logic): a graph is nodes, wires, and one vocabulary it shares':
    { internal: 'The script-graph core and the registry half it needs. Nothing authors one yet — no asset type, no component, no panel.' },

  'fix(platform): a mini-game reads the file the package actually carries':
    { note: 'A mini-game package can read its own prefabs and materials.' },

  'fix(pipeline): a bake writes the ref a package can resolve':
    { note: 'A baked room is lit in the package too.' },

  'feat(lighting): a scene says how it is lit, and whether its light still describes it':
    { note: 'A scene says how it is lit, and whether its light still describes it.' },
  'feat(lighting): a Lighting panel, and a scene that says whether its light is stale':
    { note: 'A scene says how it is lit, and whether its light still describes it.' },

  'feat(render): a bake solves the probes in the light field it already has':
    { note: 'A bake now solves the probes too, and refuses to light what moves.' },
  'feat(lighting): Bake Lighting solves the probes, and refuses to light what moves':
    { note: 'A bake now solves the probes too, and refuses to light what moves.' },

  'feat(render): a thing that moves takes the light of the room it is in':
    { note: 'Light probes: what lights a thing a bake cannot hold still.' },
  'feat(lighting): a probe volume is a box a creator can see and place':
    { note: 'Light probes: what lights a thing a bake cannot hold still.' },

  'fix(sdk): a reloaded bundle addresses the world it is reloading into':
    { note: 'A hot reload no longer empties the running game of every resource' },
  'feat(sdk): an app says what its resources are called':
    { internal: 'the door it replaces was only ever wrong between two unreleased commits — a creator sees the same resource names either way' },
  'fix(editor): the resource door reads the declared name, and the live check asks about it':
    { internal: 'the same unreleased window — and the live check it extends is a criterion, which a creator never runs' },

  'feat(corpus): a room that is actually lit, and a gate that keeps it lit':
    { note: 'A room in the corpus is actually lit.' },
  'refactor(engine): the collector composes a transform through the SDK\'s own':
    { internal: 'where one expression lives — the matrix it produces is identical' },

  'feat(lighting): stock geometry takes a bake, and a refused one says why':
    { note: 'Stock geometry takes a bake, and the density suits this engine\'s units.' },
  'feat(render): a bake derives UVs for geometry that has no file':
    { note: 'Stock geometry takes a bake, and the density suits this engine\'s units.' },

  'feat(lighting): a bounce carries the colour of what it came off':
    { note: 'A bounce carries the colour of what it came off.' },
  'feat(render): a surface reflects the colour it actually has':
    { note: 'A bounce carries the colour of what it came off.' },

  'feat(lighting): Bake Lighting, and the atlas the scene reads it from':
    { note: 'Bake Lighting.' },
  'chore(editor): the bake reaches the menu':
    { note: 'Bake Lighting.' },

  'refactor(pipeline): the PNG encoder gets its own file':
    { internal: 'where one exported function lives — the bytes both imports write'
      + ' are identical before and after' },
  'feat(pipeline): a scene of placed surfaces becomes an atlas, and says what it skipped':
    { note: 'Bake Lighting.' },

  'feat(render): lights become an atlas a mesh can be read through':
    { note: 'The bake itself: lights become an atlas.' },

  'feat(render): a model can be unwrapped for the light that will be baked into it':
    { note: 'A model can be given somewhere to receive baked light.' },
  'feat(import): Generate Lightmap UVs reaches the mesh it decides':
    { note: 'A model can be given somewhere to receive baked light.' },

  'feat(render): a mesh can be read through the light baked into it':
    { note: 'A mesh can be read through the light that was baked into it.' },
  'fix(checks): the watcher check survives a loaded machine, and says what it saw':
    { internal: 'the same check\'s start-up race and its assertion — the watcher'
      + ' it questions behaved the same before and after' },
  'fix(checks): a watch that never fires says so':
    { internal: 'a check\'s own wait, which reported a timeout as a type error —'
      + ' the watcher it questions behaved the same before and after' },

  'feat(gates): the per-object mesh record is described in one shape':
    { internal: 'a gate over four declarations of one vertex layout — a game draws'
      + ' the same whether or not they can drift' },
  'perf(render): a model matrix travels as three rows, not four':
    { internal: '16 bytes an instance and one attribute slot, both spent on a row that'
      + ' is (0,0,0,1) on every transform — the frame is identical either way' },

  'fix(gates): the animator parameter census reads a blend over a plane':
    { internal: 'a gate reading a project\'s own animator files — a game plays the'
      + ' same whether or not the census can see a blend over a plane' },

  // — after 0.66.0 —
  'feat(gates): a feature that ships without a note fails the build':
    { internal: 'a gate over this repository\'s own release process — a creator'
      + ' downloads the engine, not the checks that decided it could ship' },

  // — 0.66.0, engine —
  'feat(assets): the shapes a model was authored to blend between arrive with it':
    { note: 'A model brings the shapes it can be blended towards.' },
  'feat(render): a mesh is drawn in the shape its weights ask for':
    { note: 'A model brings the shapes it can be blended towards.' },
  'feat(anim): a clip can say what shape a mesh is in':
    { note: 'A model brings the shapes it can be blended towards.' },
  'feat(assets): an FBX brings its blend shapes':
    { note: 'A model brings the shapes it can be blended towards.' },
  'feat(assets): a list field can say where its row names come from':
    { note: 'A model brings the shapes it can be blended towards.' },
  'feat(anim): a controller is a STACK of machines, not one':
    { note: 'A controller is a stack of machines, not one.' },
  'feat(anim): the graph ops address a layer, without a second vocabulary':
    { note: 'A controller is a stack of machines, not one.' },
  'feat(anim): a layer writes the part of the rig it was given':
    { note: 'A layer writes the part of the rig it was given.' },
  'feat(anim): a silent layer says nothing, including with a sprite sheet':
    { note: 'A layer writes the part of the rig it was given.' },
  'feat(anim): a 1D blend mixes its neighbours instead of picking one':
    { note: 'A blend mixes its neighbours instead of picking one.' },
  'feat(anim): a blend over a plane, by the operation the line already used':
    { note: 'A blend over a plane.' },
  'feat(examples): the third-person rig runs and swings at the same time':
    { note: 'The third-person rig runs and swings at the same time.' },
  'feat(anim): a clip means the same thing on a rig bound differently':
    { note: 'A clip means the same thing on a rig bound differently.' },
  'feat(anim): a retargeted step travels as far as the rig would':
    { note: 'A clip means the same thing on a rig bound differently.' },
  'feat(anim): one clip drives rigs that do not share its bone names':
    { note: 'One clip drives rigs that do not share its bone names.' },
  'feat(anim): the posed skeleton can be made to reach something':
    { note: 'The posed skeleton can be made to reach something.' },
  'feat(anim): a constraint is an edit like any other':
    { note: 'The posed skeleton can be made to reach something.' },
  'feat(ecs): a step of gameplay nobody has seen yet, and can take back':
    { note: 'A step of gameplay nobody has seen yet, and can take it back.' },
  'feat(ecs): a system asks for a speculation the way it asks for anything else':
    { note: 'A step of gameplay nobody has seen yet, and can take it back.' },
  'feat(ecs): a step can be asked whether it is a function of the world':
    { note: 'A step can be asked whether it is a function of the world.' },
  'feat(net): the rule reconciliation replays can be asked whether it replays':
    { note: 'A step can be asked whether it is a function of the world.' },
  'refactor(anim): a state says what it plays one way, from the file in':
    { note: 'A state says what it plays one way, from the file in.' },
  'fix(anim): a layer\'s clips ship, and reach the game that plays them':
    { note: 'A layer\'s clips reach the game that plays them.' },
  'fix(anim): a blend weights its displacement the way it weights its pose':
    { note: 'A blend weights its displacement the way it weights its pose.' },
  'feat(anim): the blend twins are both on the public surface':
    { note: '`isBlend1D` was never on the public surface' },
  'fix(golden): the editor\'s frame shares the rasterizer too':
    { internal: 'a verifier reading the editor\'s own capture — no packaged game changes' },
  'fix(gates): the editor capture gets the settle window the package gets':
    { internal: 'a verifier\'s timing, not the engine\'s' },

  // — 0.66.0, editor —
  'feat(inspector): a mesh\'s shapes are editable, under their own names':
    { note: 'A model brings the shapes it can be blended towards.' },
  'feat(animator): the editor edits a layer, and says which one':
    { note: 'A controller is a stack of machines, not one.' },
  'feat(animator): a blend is something an author can make':
    { note: 'A blend is something an author can make.' },
  'refactor(animator): the panel asks one question about a motion, not four':
    { note: 'A state says what it plays one way, from the file in.' },
  'feat(animator): constraints are something an author can place':
    { note: 'The posed skeleton can be made to reach something.' },
  'feat(animator): an avatar can be described from the rig itself':
    { note: 'A clip means the same thing on a rig bound differently.' },
  'feat(animator): an avatar measures the rig it describes':
    { note: 'A clip means the same thing on a rig bound differently.' },
  'feat(project): an avatar is an asset the editor can make':
    { note: 'A clip means the same thing on a rig bound differently.' },
  'fix(editor): a crash dialog must not hold the process it warns about':
    { note: 'An unexpected error no longer takes the editor with it.' },
  'fix(play): step reports the frames that ran, and the checks start from a frozen world':
    { note: '`step` reports the frames that ran, not the number it was asked for.' },
  'fix(checks): ready is not the physics module having arrived':
    { internal: 'an editor check\'s own synchronisation' },
  'fix(checks): a four-minute step is a four-minute silence':
    { internal: 'an editor check\'s own synchronisation' },
  'fix(checks): a file on disk is not the registry having adopted it':
    { internal: 'an editor check\'s own synchronisation' },
  'fix(checks): let the 3D step finish, and say how long it took':
    { internal: 'an editor check\'s own budget' },
  'fix(checks): "before" is a state the world was in, not seven moments':
    { internal: 'an editor check\'s own reading' },
  'fix(checks): a name on the command line selects again':
    { internal: 'the check runner\'s argument parsing' },
  'fix(automation): a capture waits as long as the package it is compared to':
    { internal: 'a verifier\'s timing, not the engine\'s' },
  'fix(export): a web package ships the chunks its entries reach':
    { note: 'A web build no longer carries the mini-game and native SDKs.' },
  'refactor(sdk): four modules named support.ts, one flat chunk namespace':
    { internal: 'the names inside the SDK build\'s own chunk output' },
  'fix(size): the bundle report names subsystems, not the chunks they landed in':
    { note: 'The size report says which subsystem each byte of the scripts came from.' },
  'fix(gates): a start screen that faded is not one that never did':
    { internal: 'a verifier\'s reading of a boot it already watched finish' },
  'fix(wechat): an atlas page is one file however many sprites name it':
    { note: 'A mini-game export no longer fails on a project whose sprites are atlased.' },
  'fix(wechat): the package installs its platform by calling for it':
    { note: 'A WeChat mini-game boots again.' },
  'fix(sdk): the lean WeChat entry is an entry, so it declares its side effects':
    { internal: 'a declaration about the package, read by bundlers rather than people' },
  'fix(cli): an over-budget package says which settings would fit it':
    { internal: 'the wording of a message the export already printed' },
  'fix(details): the Inspector names the new reason a texture ships raw':
    { note: 'A texture that encodes larger than its source now ships as the source.' },
  'fix(native): a packaged game script gets the three new subpaths':
    { internal: 'what a native host publishes to the scripts it runs' },
  'fix(app): build order is declared, not the shape of an array':
    { internal: 'the order a stack of plugins is assembled in' },
  'docs(manual): the AI, tilemap and script-graph pages import from their subpaths':
    { internal: "a manual page's import line, following the move it documents" },
  'refactor(play): the play realm asks for the whole import map by name':
    { internal: "the editor's preview page names the same subpaths it always did" },
  'fix(settings): the module page reads the same asset table the build installs from':
    { note: 'The Engine Modules page no longer calls a module unused that the build then carries.' },
  'feat(export): the build says what the start screen\'s logo costs the page':
    { note: "The build says what the start screen's logo costs the page." },
  'feat(agent): a person can record which models their account has seen take an image':
    { note: 'You can tell the editor which models your account has seen take an image.' },
  'fix(play): a Play that lands inside the prewarm waits for it':
    { note: 'Pressing Play while the editor is still warming up no longer loses the engine.' },
  'fix(gates): the service-support check runs where its subject compiles':
    { internal: 'Moves a repository check between suites; the dialog it guards is unchanged.' },
  'feat(gates): a mini-game package is asked what it does when a 分包 is refused':
    { internal: 'A repository gate over the corpus; the package it judges is unchanged.' },
  'fix(play): a realm asked for a still world is handed one, not stopped later':
    { note: 'A game started paused is handed the scene already held.' },
  'fix(build): the service row uses the editor\'s own tooltip and spacing':
    { internal: 'The row from the commit before it, drawn with the editor\'s own tooltip and grid; nothing it says changes.' },
  'chore(gates): bank three reaches the gameplay subpath move removed':
    { internal: 'A repository ratchet baseline; no source changed.' },
  'feat(gates): the start screen is judged over a link a phone actually has':
    { internal: 'A repository gate over the corpus; the package it measures is unchanged.' },
  'feat(runtime): the bar moves while the engine downloads, not only when it lands':
    { note: 'The loading bar moves while the engine downloads.' },
  'refactor(theme): the asset tints are tokens, under the same contract as --cat-*':
    { internal: "The content browser's colours move into the theme file; measured identical, so nothing a creator sees changes." },
  'feat(gates): the asset ramp answers to the panel\'s saturation ceiling':
    { internal: "A repository gate over the editor's own palette; no creator runs it." },
  'fix(agent): a refused picture is told apart from a refused request':
    { note: 'An agent told its screenshot was too big hears that, not "the request was refused".' },
  'refactor(profiler): a token has one author, not a copy beside every read':
    { internal: "The profiler's canvas reads the same tokens it always did; the duplicated fallbacks are gone and nothing it draws changes." },
  "refactor(theme): a graph port's colour is a token, in one family for both graphs":
    { internal: 'The two graph editors read their port colours from the theme; all eight resolve to the hex they replaced, so nothing drawn changes.' },
  "feat(gates): a file whose colours are not the palette's says so":
    { internal: "A repository ratchet over the editor's own source; no creator runs it." },
  'refactor(theme): twelve font sizes that were a scale step, written as a number':
    { internal: 'The editor reads its own type scale where it had restated it; every size resolves to the px it replaced.' },
  'chore(gates): bank the type-scale convergence':
    { internal: 'A repository ratchet baseline; no source changed.' },
  'refactor(icons): two names for one stroke weight become one':
    { internal: 'Two icon stroke widths that render within 1.7% of each other become one; a whole-frame diff moves 131 pixels of 1.29M.' },
  'chore(gates): bank the stroke-width collapse':
    { internal: 'A repository ratchet baseline; no source changed.' },
  'refactor(ui): the node-graph editors\' buttons are IconButton and Button':
    { internal: 'Editor chrome: node-graph toolbar and side buttons take the shared components; no behaviour changes.' },
  'chore(gates): bank the node-graph button migration':
    { internal: 'A repository ratchet baseline; no source changed.' },
  'refactor(ui): the agent drawer\'s, code block\'s and asset field\'s icon buttons are IconButton':
    { internal: 'Editor chrome: icon buttons take the shared component; the agent history toggle shows open in the accent fill.' },
  'feat(gates): an icon-only button is an IconButton, or says why not':
    { internal: 'A repository gate and its baseline; no source changed.' },
  'refactor(theme): every colour the editor draws comes from the palette':
    { internal: 'Editor colours move onto tokens; on the default layout no pixel moves by more than 24.' },
  'feat(gates): colour literals are counted as colours, and bank zero':
    { internal: 'A repository gate and its baseline; no source changed.' },
  'fix(i18n): the agent\'s strings go back to the agent module':
    { internal: 'Strings moved between source modules; every one resolved before and after.' },
  'feat(agent): Settings can ask an endpoint whether a model reads pictures':
    { note: 'Settings can find out whether a model reads pictures, instead of asking you to know.' },
  'feat(agent): a capture can be the overview or the close-up':
    { note: 'The agent can take an overview and a close-up instead of one full-size picture.' },
  'fix(ui): an IconButton\'s icon is centred':
    { internal: 'Editor chrome: small icon buttons move their icon 1-3px to centre; no behaviour changes.' },
  'refactor(ui): the event, tileset, flipbook, localisation, tilemap and controller icon buttons are IconButton':
    { internal: 'Editor chrome: panel buttons take the shared component; no behaviour changes.' },
  'feat(gates): an aria-* or data-* written on Button / IconButton is a finding':
    { internal: 'A repository gate and its baseline; no source changed.' },
  'refactor(ui): nine more icon buttons are IconButton':
    { internal: 'Editor chrome: nine buttons take the shared component; no behaviour changes.' },
  'chore(gates): bank the nine-button migration':
    { internal: 'A repository ratchet baseline; no source changed.' },
  'refactor(theme): the play colour means the game is running, and nothing else':
    { internal: 'Editor colours: success states take --ok and the Y axis its own colour; no behaviour changes.' },
  'feat(gates): the play overlay may draw the axis colours':
    { internal: 'A repository gate; no source changed.' },
  'refactor(inspector): effect-order, gradient-stop and component-options buttons are IconButton':
    { internal: 'Editor chrome: Inspector buttons take the shared component at the same sizes; no behaviour changes.' },
  'chore(gates): bank the inspector button migration':
    { internal: 'A repository ratchet baseline; no source changed.' },
  'refactor(ui): a row\'s remove button is one IconButton':
    { internal: 'Editor chrome: nine remove buttons take one look and one hover colour; no behaviour changes.' },
  'chore(gates): bank the remove-button migration':
    { internal: 'A repository ratchet baseline; no source changed.' },
  'refactor(content): the back / forward / up buttons are IconButton':
    { internal: 'Editor chrome: three content-browser buttons take the shared component; 2px larger.' },
  'fix(theme): colours named from a vocabulary the editor does not have':
    { internal: 'Hover and border colours move from stray literals onto the palette; no behaviour changes.' },
  'fix(gates): in the editor, a var() whose name nothing defines is a finding even with a fallback':
    { internal: 'A repository gate; no source changed.' },
  'fix(a11y): pickers are listboxes and the Sequencer\'s views are tabs':
    { internal: 'Accessibility roles only; nothing renders or behaves differently for a mouse or keyboard user.' },
  'chore(gates): bank the picker and tab roles':
    { internal: 'A repository ratchet baseline; no source changed.' },
  'feat(gates): an item or a shared control\'s own button is not hand-rolled':
    { internal: 'A repository gate and its baseline; no source changed.' },
  'refactor(sequencer): its keyframe and add-track menus are ContextMenus':
    { internal: 'Two Sequencer popovers move onto the shared menu; same entries, gains keyboard navigation and roles.' },
  'chore(gates): bank the Sequencer menus':
    { internal: 'A repository ratchet baseline; no source changed.' },
  'refactor(log): the category filter is a ContextMenu':
    { internal: 'The Output Log filter moves onto the shared menu; it gains keyboard navigation and item roles, same entries.' },
  'chore(gates): bank the log category menu':
    { internal: 'A repository ratchet baseline; no source changed.' },
  'feat(ui): the editor draws its own tips':
    { note: "The editor's tooltips are its own." },
  'feat(gates): a tip is data-tip, never the operating system\'s title':
    { internal: 'A repository gate and its baseline; no source changed.' },
  'refactor(plugins): the panel\'s buttons are Button':
    { internal: 'The same markup through the shared component; nothing renders differently.' },
  'chore(gates): bank the Plugins panel buttons':
    { internal: 'A repository ratchet baseline; no source changed.' },
  'refactor(theme): colours that name one thing stop colouring others':
    { internal: 'Editor chrome colours: Outliner folders match the content browser, a lock is amber; no behaviour changes.' },
  'feat(gates): each identity colour says what it names and where that is drawn':
    { internal: 'A repository gate; no source changed.' },
  'refactor(icons): 15 and 17px icons are 16px, 19px are 18px':
    { internal: 'Editor icons move one pixel onto sizes that render crisper at 2x.' },
  'chore(gates): bank the 16px and 18px icon collapse':
    { internal: 'A repository ratchet baseline; no source changed.' },
  'refactor(icons): 11px and 13px icons are 12px':
    { internal: 'Editor icons move one pixel onto the size that renders crisp at 2x.' },
  'chore(gates): bank the 12px icon collapse':
    { internal: 'A repository ratchet baseline; no source changed.' },
  'refactor(theme): 11-25px odd spacings step down to the grid':
    { internal: 'One-pixel tightening of editor chrome; measured on screen, no row height changes.' },
  'chore(gates): bank the larger odd spacing steps':
    { internal: 'A repository ratchet baseline; no source changed.' },
  'refactor(theme): a 3px spacing is 2px':
    { internal: 'One-pixel tightening of editor chrome; measured on screen, no row height changes.' },
  'chore(gates): bank the 3px spacing step':
    { internal: 'A repository ratchet baseline; no source changed.' },
  'refactor(theme): 7px and 9px spacings are 6px and 8px':
    { internal: 'One-pixel tightening of editor chrome; measured on screen, no row height changes.' },
  'chore(gates): bank the 7px and 9px spacing steps':
    { internal: 'A repository ratchet baseline; no source changed.' },
  'refactor(theme): a 5px spacing is 4px':
    { internal: 'One-pixel tightening of editor chrome; measured on screen, no row height changes.' },
  'fix(gates): a fractional offset is not a spacing step':
    { internal: 'A repository gate and its baseline; no source changed.' },
  'refactor(theme): the spacing grid is 2px':
    { internal: 'A token nothing reads, and the gate rule derived from it; no pixel moves.' },
  'chore(gates): bank the 2px spacing grid':
    { internal: 'A repository ratchet baseline; no source changed.' },
  'feat(agent): a screenshot says whether it was sent, withheld, or taken':
    { note: "Every screenshot in the agent's transcript says where it went." },
  'fix(agent): a screenshot weighs what the model is billed for it':
    { note: 'Looking at its work no longer makes the agent forget the conversation.' },
  'refactor(theme): the last type sizes between two steps take one':
    { note: "The Inspector's light and LOD explanations are readable." },
  'feat(gates): a glyph drawn as an icon says so, and raw font-size banks zero':
    { note: "The Inspector's light and LOD explanations are readable." },
  'fix(checks): the wheel check asks whether it turned, not where it stopped':
    { internal: 'A repository check over the editor; the wheel joint it judges is unchanged.' },
  'feat(export): what each packaging target can do, before a build exists':
    { note: 'The build dialog says which engine services a target can provide.' },
  'feat(build): the dialog says which engine services a target can provide':
    { note: 'The build dialog says which engine services a target can provide.' },
  'fix(gates): the on-device crash check builds for the ABI the device reports':
    { note: 'The on-device crash check runs on whatever Android you have.' },
  'fix(native): every App factory installs the optional subsystems from the registry':
    { note: 'A packaged native game gets the subsystems its project uses.' },
  'fix(agent): nothing claims a model cannot see when nobody has said so':
    { note: 'Nothing claims a model cannot see when nobody has said so.' },
  'fix(agent): what a model can see is resolved per model, in three states':
    { note: 'A model that can see is no longer told it cannot.' },
  'fix(runtime): a packaged host looks a resource up in the registry that holds it':
    { note: 'A packaged game answers "how do I get there?" again.' },
  'fix(play): a realm ignores a hand-over that lands during its own boot':
    { note: 'Pressing Play could kill the session it was starting.' },
  'fix(play): the scene is handed to the realm once per start, not once per door':
    { note: 'Pressing Play could kill the session it was starting.' },
  'fix(theme): the size bar reads as a measurement, not as a running state':
    { note: "The build's size bar stopped borrowing Play's green." },
  'refactor(theme): the spacing grid has one author, the token that declares it':
    { internal: 'the gate repeated the 4px grid the theme already declared; no visible change' },
  'fix(play): a realm says its page ran before it reads the engine':
    { note: 'A Play session that times out now says whether it ever started.' },
  'fix(export): a 分包 that did not load says which one and why':
    { note: 'When a 分包 will not come down, the package says which one and why.' },
  'fix(export): a progress notice is never what takes a mini-game boot down':
    { note: 'A package whose engine ships in a 分包 now starts.' },
  'fix(assets): a group load names what failed instead of returning an empty bundle':
    { note: 'A group that failed to load says so instead of handing back an empty bundle.' },
  'docs(settings): the wasm compression switch names what it now compresses':
    { internal: 'the switch now compresses the side modules too, which its own label did not say' },
  'feat(export): a mini-game compresses its side modules, not just its engine':
    { note: "A mini-game's side modules compress too, not just its engine." },
  'feat(export): a mini-game entry raises the host indicator on its first line':
    { note: 'A mini-game says it is starting before it parses the game.' },
  "feat(export): the start screen carries the project's logo, colour and hold":
    { note: 'The start screen is yours: a logo, a background and a minimum display time.' },
  'feat(build): a target states its size caps before you package':
    { note: "The build dialog states a platform's size caps before you package." },
  'fix(export): a mini-game takes the engine build a mini-game host can load':
    { note: 'A Douyin package could not start.' },
  'fix(export): every mini-game target gets the mini-game engine runtime':
    { note: 'A Douyin package could not start.' },
  'fix(export): a module the project forced in brings its binary too':
    { note: "Forcing a module in now ships its wasm binary too, not just its JavaScript." },
  'feat(project): a build target can answer differently about a module':
    { note: "A build target can include or exclude an engine module without changing the project's answer." },
  'feat(settings): each engine module says what this project does with it':
    { note: "The Engine Modules page says which of your documents put each module in use." },
  'feat(details): a component whose module the project refused cannot be added':
    { note: "A component whose module Project Settings excludes is greyed out in Add Component, not hidden." },
  'fix(project): every module a project can refuse is one a build can detect':
    { note: "Excluding 3D physics, DragonBones or script graphs is now enforced like every other module." },
  'feat(project): a project can force an engine module in, or refuse one':
    { note: "Project Settings has an Engine Modules page: force a module into the build, or refuse one." },
  'feat(settings): an Engine Modules page, one row per module':
    { note: "Project Settings has an Engine Modules page: force a module into the build, or refuse one." },
  'refactor(bundle): the published subpaths move to a module the renderer can read':
    { internal: "where one table lives; the list it holds is unchanged" },
  'fix(engine): two of the four subsystem switches did not build with them off':
    { internal: "CMake options no shipped build changes; every release has all four ON" },
  'fix(editor-checks): a realm that never came up is unanswered, not a verdict':
    { internal: "how CI classifies its own bad minute; no creator-facing behaviour" },
  'feat(minigame): the engine subpackage fetch says how far along it is':
    { note: "A mini-game that fetches its engine from a 分包 shows the download's progress." },
  'fix(theme): the colour-literal rule guards the code, not only the theme':
    { internal: "an editor gate's scope; no creator-facing behaviour" },
  'refactor(gameplay): the gameplay runtime moves to its own subpath':
    { note: "The gameplay runtime is a subpath: `import { Health } from 'esengine/gameplay'`." },
  'refactor(gameplay): the viewport imports MeleeAttack from its subpath':
    { note: "The gameplay runtime is a subpath: `import { Health } from 'esengine/gameplay'`." },
  'fix(douyin): the config file, the appid and a payment slot':
    { note: "A Douyin package carries Douyin's config file and Douyin's appid." },
  'fix(douyin): a Douyin package carries a Douyin appid':
    { note: "A Douyin package carries Douyin's config file and Douyin's appid." },
  'feat(size): the report says what the export\'s own packing bought':
    { note: "The build size report says what compressing the engine binary actually saved." },
  'fix(play): the realm trace keeps the evidence for the failure it explains':
    { note: "When the play realm never comes up, the editor says more about why." },
  'fix(export): a build comparison blames the setting that moved, not the content':
    { note: "The build size report no longer blames content for a packaging change." },
  'fix(agent): the tool catalog stops promising spineVersion decides a build':
    { note: "The built-in agent is no longer told that the Spine runtime setting decides what a build ships." },
  'feat(export): a web package ships the subsystems it uses':
    { note: "A web package ships only the subsystems its project uses." },
  'fix(sdk): a host entry keeps the platform when the web one loads too':
    { internal: 'which platform adapter wins inside one Node process; no creator-facing behaviour' },
  'fix(sdk): the headless entry joins the shared chunk graph':
    { note: "A dedicated server built on `esengine/node` replicates again." },
  'refactor(play): the play host installs replication from its subpath':
    { note: "Replication is a subpath: `import { Net, Replicated } from 'esengine/replication'`." },
  'refactor(net): replication moves to its own subpath':
    { note: "Replication is a subpath: `import { Net, Replicated } from 'esengine/replication'`." },
  'fix(app): an optional subsystem\'s plugin is built per app, not shared':
    { note: "Two games in one process no longer share an optional subsystem's plugin." },
  'refactor(ai): the AI runtimes move to their own subpath':
    { note: "The AI runtimes are a subpath: `import { NavAgent } from 'esengine/ai'`." },
  'refactor(ai): the editor imports the AI runtimes from their subpath':
    { note: "The AI runtimes are a subpath: `import { NavAgent } from 'esengine/ai'`." },
  'refactor(logic): the script-graph API moves to its own subpath':
    { note: "Script graphs are a subpath: `import { … } from 'esengine/logic'`." },
  'refactor(logic): the editor imports script graphs from their subpath':
    { note: "Script graphs are a subpath: `import { … } from 'esengine/logic'`." },
  'refactor(tilemap): the editor imports tilemaps from the subpath that owns them':
    { note: "Tilemaps are a subpath: `import { Tilemap } from 'esengine/tilemap'`." },
  'refactor(tilemap): the tilemap API moves to its own subpath':
    { note: "Tilemaps are a subpath: `import { Tilemap } from 'esengine/tilemap'`." },
  'fix(assets): compression that cannot pay for its decoder is skipped':
    { note: 'A project whose art weighs less than the transcoder no longer compresses any of it.' },
  'fix(assets): a texture ships in whichever form is smaller':
    { note: 'A texture that encodes larger than its source now ships as the source.' },
  'fix(cli): the temp build dir is swept however the run ends':
    { internal: 'a working directory of the repo\'s own tooling' },
  'feat(ui): a HUD can clear the host\'s own menu, not just the notch':
    { note: 'A UI node can keep clear of WeChat\'s capsule menu, which the safe area does not cover.' },
  'feat(services): a game can record a run and share the clip':
    { note: 'A game can record a run and share the clip.' },
  'feat(pipeline): every bundle of a project\'s scripts resolves the official packages':
    { note: 'Sharing, in-game purchase, the friends leaderboard and the recorder can be used at all.' },
  'feat(editor): a project resolves and type-checks the official packages the editor ships':
    { note: 'Sharing, in-game purchase, the friends leaderboard and the recorder can be used at all.' },
  'feat(examples): record a run and share the clip':
    { note: 'The `record-share` example.' },
  'feat(editor): a project carries the official packages for tsc and an outside editor':
    { note: '`tsc` and an outside editor type-check the official packages too.' },
  'feat(tooling): the examples type-check the official packages the way a project does':
    { note: '`tsc` and an outside editor type-check the official packages too.' },
  'feat(render): a frame capture spans every pass, names each draw\'s entities, and replays after the pass that drew it':
    { note: 'A frame can be captured draw call by draw call, and replayed up to any one of them.' },
  'feat(editor): capture a frame draw by draw and replay it, in the viewport and the running game':
    { note: 'A frame can be captured draw call by draw call, and replayed up to any one of them.' },
  'feat(editor): the Frame Debugger panel lists a frame\'s draws, why each started, and replays up to one':
    { note: 'A frame can be captured draw call by draw call, and replayed up to any one of them.' },
  'feat(editor): the Frame Debugger names each draw\'s material and every texture it bound':
    { note: 'A frame can be captured draw call by draw call, and replayed up to any one of them.' },
  'feat(render): a frame capture lists every texture a draw bound':
    { note: 'A frame can be captured draw call by draw call, and replayed up to any one of them.' },
  'fix(animation): a controller loads the avatar its clips were authored on, and retargets through each rig\'s space':
    { note: 'Retargeting works: one character\'s clips play on another\'s skeleton.' },
  'fix(prefab): an override that names no entity of its prefab is reported':
    { note: 'A prefab instance\'s override that names no entity of its prefab is reported.' },
  'fix(examples): the character-rig hero and knight stand where the scene puts them':
    { note: 'The `character-rig` example shows what it is for.' },
  'feat(render): a directional light\'s source is the sun\'s size by default':
    { note: 'A Directional light\'s source is the sun\'s size by default, so its shadows have a penumbra.' },
  'fix(render): a hard shadow\'s edge is filtered, not stepped along the shadow map\'s grid':
    { note: 'A hard shadow\'s edge is a clean line, not a row of stair-steps.' },
  'feat(render): the sky is drawn from the panorama it was imported from':
    { note: 'A drawn sky is the panorama you imported, not a blur of it.' },
  'feat(editor): importing a panorama writes the sky it is drawn from':
    { note: 'A drawn sky is the panorama you imported, not a blur of it.' },
  'fix(render): a drawn sky fills the frame from every angle':
    { note: 'A drawn sky no longer vanishes, or half-vanishes, as the view turns.' },
  'fix(render): the profiler and the draw-call count cover every camera of the frame':
    { note: 'With more than one camera, the profiler and the draw-call count cover the whole frame.' },
  'fix(play): a Play pressed while the engine warms up starts the game once, not again ten seconds later':
    { note: 'A game started right after the project opened no longer restarts itself about ten seconds in.' },
  'fix(play): the game starts once when Play is pressed during the warm-up':
    { note: 'A game started right after the project opened no longer restarts itself about ten seconds in.' },
  'feat(editor): the Frame Debugger panel ships with the editor':
    { note: 'A frame can be captured draw call by draw call, and replayed up to any one of them.' },
  'fix(viewport): a paused game is not covered or dimmed; the ring says paused':
    { note: 'A paused game is no longer covered or dimmed.' },
  'feat(project): opening a project gives its tsconfig the official-packages mapping':
    { note: '`tsc` and an outside editor type-check the official packages too.' },
  'feat(project): every template and example maps estella-plugin-* to the mirrored packages':
    { note: '`tsc` and an outside editor type-check the official packages too.' },
  'feat(export): a project can be packaged for Kuaishou':
    { note: 'A project can be packaged for Kuaishou (快手).' },
  'feat(editor): Kuaishou is a build target':
    { note: 'A project can be packaged for Kuaishou (快手).' },
  'fix(runtime): a mini-game host with only WebGL1 is told the game cannot start':
    { note: 'A mini-game host that offers only WebGL1 is told the game cannot start there' },
  'feat(export): a project can be packaged for Bilibili':
    { note: 'A project can be packaged for Bilibili (B 站).' },
  'feat(editor): Bilibili is a build target, and a cap can be per subpackage':
    { note: 'A project can be packaged for Bilibili (B 站).' },
  'feat(runtime): a mini-game host that asks to hear the first frame is told':
    { note: 'A mini-game host that asks to hear when the first screen has rendered is told' },
  'fix(runtime): a mini-game host other than WeChat keeps its lifecycle':
    { note: 'A mini-game on any host but WeChat no longer throws at boot.' },
  'fix(export): a mini-game that fails to start says why':
    { note: 'A mini-game that fails to start says why.' },
  'fix(cli): a project platform exports headless, and an unknown id is refused':
    { note: '`estella export --platform <id>` packages a platform the project defines' },
  'feat(export): a project can be packaged as a quick game':
    { note: 'A project can be packaged as a quick game' },
  'feat(editor): the quick game is a build target, with its package name, version code and release key':
    { note: 'A project can be packaged as a quick game' },
  'fix(runtime): a WebGL2 context does not offer the WebGL1 extensions it made core':
    { note: 'A mini-game whose host\'s WebGL2 context also offers `OES_vertex_array_object` renders instead of hanging' },
  'feat(export): a project can be packaged for Alipay':
    { note: 'A project can be packaged for Alipay (支付宝小游戏).' },
  'feat(editor): Alipay is a build target':
    { note: 'A project can be packaged for Alipay (支付宝小游戏).' },
  'feat(export): a project can be packaged as a Huawei quick game':
    { note: 'A project can be packaged as a Huawei quick game (华为快游戏).' },
  'feat(editor): the Huawei quick game is a build target':
    { note: 'A project can be packaged as a Huawei quick game (华为快游戏).' },
  'fix(agent): the history toggle presses grey again, not the accent':
    { note: "The agent drawer's History button shows it is open with a grey press again, not the accent colour 0.71 gave it." },
  'fix(bench): a locked screen is a question this machine cannot take':
    { internal: 'a release criterion\'s own measuring conditions; the engine is unchanged' },
  'fix(recorder): a Douyin recording the host ends on its own keeps its video':
    { note: 'A Douyin recording the host ends on its own keeps its video, and an interruption is not counted as recorded time.' },
  'feat(frame-debugger): a development build can be captured from the editor over the network':
    { note: 'The Frame Debugger can capture and replay a frame of a development build running outside the editor.' },
  'feat(frame-debugger): capture a frame from a development build running elsewhere':
    { note: 'The Frame Debugger can capture and replay a frame of a development build running outside the editor.' },
  'fix(hot-update): an update says which stages it reached, and the next launch starts on a whole version':
    { note: 'A hot update reports how far it got — verified, applied, stored for the next launch, cached for offline — instead of one `ok`; two updates at once no longer both commit or lose the newer one; and an update stored by an older build no longer covers a newer one the player installed.' },
  'fix(minigame): a hot update reaches a mini-game, and survives its next launch offline':
    { note: 'A hot update on a mini-game is stored for the next launch and its assets are cached on the device, so the updated game starts offline; before, a mini-game went back to what shipped.' },
  'feat(debug): a development build\'s log, frame stats and controls reach the editor':
    { note: 'A development build connected to the editor can be watched and driven from it.' },
  'feat(profiler): a development build\'s frames, log and clock, read and driven from the editor':
    { note: 'A development build connected to the editor can be watched and driven from it.' },
  'fix(app): a frame-rate cap keeps a cadence, so 30 on a 60 Hz display is 30':
    { note: 'A frame-rate cap now holds: `setTargetFrameRate(30)` on a 60 Hz display runs at 30, not 24.' },
  'feat(debug): a device answers with its world, and a question asked while it boots waits':
    { note: 'The Outliner can show a connected development build\'s world.' },
  'feat(outliner): a connected build\'s world, shown read-only beside this editor\'s':
    { note: 'The Outliner can show a connected development build\'s world.' },
  'feat(debug): the debug channel reports what it costs the game it watches':
    { internal: 'a number the channel reports for its own budget check; the profiler does not show it yet' },
  'fix(minigame): a WeChat development build reaches the editor, and its replays come back':
    { note: 'A WeChat development build connects to the editor from WeChat DevTools (the domain check is turned off for that build only), and frame replays come back from a mini-game.' },
  'fix(hot-update): a mini-game fetches its update from the CDN, and shows it offline':
    { note: 'Hot update works on mini-games: the update is fetched from the CDN, verified, applied and cached, and after a restart without a network the game starts on it with its updated art.' },
  'fix(native): a CDN texture loads on a native build, and from the cache when offline':
    { note: 'A native build loads a remote group\'s textures from the CDN — they never loaded before — and after a hot update, from its disk cache when offline.' },
  'fix(app): the frame loop runs on vivo\'s quick game, not just its first frame':
    { note: 'Games on vivo\'s quick game run past their first frame: the frame loop now hands requestAnimationFrame a handler the runtime accepts.' },
  'fix(debug): the debug channel holds up on a slow host with a noisy console':
    { note: 'The debug channel works on vivo\'s quick game: logs arrive in batches, and a replay is sent at the size the Frame Debugger shows instead of the whole screen.' },
  'fix(frame-debugger): a device\'s replay is asked for at the size the panel shows':
    { note: 'The debug channel works on vivo\'s quick game: logs arrive in batches, and a replay is sent at the size the Frame Debugger shows instead of the whole screen.' },
  'fix(minigame): a tap on vivo\'s quick game lands where the finger is':
    { note: 'A tap on vivo\'s quick game lands where the finger is: the host reports touches in physical pixels, and every tap landed off the screen.' },
  'fix(ui): a quick tap on a slow frame still clicks':
    { note: 'A quick tap on a slow frame still clicks a button: a finger that landed and lifted between two frames was seen only lifting, so the button never saw a press.' },
  'fix(minigame): the loading notice comes down on vivo\'s quick game':
    { note: 'On vivo\'s quick game the loading notice comes down once the game starts; it could stay over the running game.' },
  'fix(examples): the hot-update demo says when it could not reach the update endpoint':
    { note: 'The hot-update demo no longer says the remote manifest matches when it could not reach one; offline it says it keeps the local content.' },
  'fix(lifecycle): a page opened in a background tab knows it is in the background':
    { note: 'A web game opened in a background tab starts paused and reports itself hidden until it is shown; before, it counted as visible.' },
  'fix(debug): a device in the background refuses a capture at once':
    { note: 'Capturing a development build whose tab is in the background says so at once, instead of waiting 30 seconds for a frame the browser will not draw.' },
  'feat(profiler): the Profiler shows what a connected device spends on its debug channel':
    { note: 'The Profiler shows what the debug channel costs a connected build per frame.' },
  'feat(profiler): a device\'s frame shows what its debug channel costs':
    { note: 'The Profiler shows what the debug channel costs a connected build per frame.' },
  'feat(debug): a connected build says what device it runs on':
    { note: 'Connected development builds are named by the device they run on.' },
  'feat(debug): connected builds are named by the device they run on':
    { note: 'Connected development builds are named by the device they run on.' },
  'fix(debug): a shipping package no longer carries the debug channel':
    { note: 'A shipping package no longer carries the development debug channel\'s code (13 KB on a WeChat package): only a development export that names an editor imports it, as `esengine/debug-channel`.' },
  'fix(net): a mini-game socket whose dial is refused on a phone redials':
    { note: 'On a WeChat phone, a socket whose connection is refused now reports that it closed, so a development build keeps redialing the editor (and a game\'s socket reconnects) instead of giving up after the first refusal.' },
  'fix(export): a mini-game\'s assets are named by their content, so an update gets new URLs':
    { note: 'Mini-game exports name assets by their content, as web exports already did: a hot update to a remote texture now shows on a phone (it kept the old picture under the same URL), and a CDN can hold two versions without v1 players getting v2 files.' },
  'fix(ui): a button can act inside the player\'s tap, where WeChat requires a share':
    { note: '`createButton({ userGesture: true })` runs its click inside the host\'s own release event: on a WeChat phone, sharing a recording from a button was refused ("require user interaction (only in touchend event)"), because a click ran on the frame after the tap.' },
  'fix(minigame): the pixel ratio is read once, not on every frame':
    { note: 'A mini-game reads the host\'s pixel ratio once and again after a resize, instead of calling getSystemInfoSync several times a frame (on vivo, a synchronous call across its bridge each time).' },
  'feat(export): the size report says what the start screen weighs':
    { note: 'The build\'s size report shows the start screen on its own line.' },
  'feat(build): the size panel names what the start screen weighs':
    { note: 'The build\'s size report shows the start screen on its own line.' },
  'feat(debug): a connected build reports its hot-update status to the editor':
    { note: 'The Profiler shows which content revision a connected build runs.' },
  'feat(profiler): a connected build says which content it runs and what update waits':
    { note: 'The Profiler shows which content revision a connected build runs.' },
  'feat(native): a native build can connect to the editor over the debug channel':
    { note: 'A native development build connects to the editor.' },
  'feat(build): a desktop development build can dial the editor':
    { note: 'A native development build connects to the editor.' },
  'fix(android): a native Android app can reach the network':
    { note: 'A native Android app can reach the network: its manifest never asked for it, so a remote group\'s assets, hot updates and the debug channel all failed on Android. A development build also allows plain http (a LAN CDN); a shipping build is held to https, and the export warns when its CDN is http.' },
  'feat(native): a native build names its device when it connects':
    { note: 'A native development build names its device to the editor.' },
  'feat(build): an Android development build can dial the editor':
    { note: 'A native Android app can reach the network: its manifest never asked for it, so a remote group\'s assets, hot updates and the debug channel all failed on Android. A development build also allows plain http (a LAN CDN); a shipping build is held to https, and the export warns when its CDN is http.' },
  'test(android): a Studio project\'s manifest has every placeholder filled':
    { internal: 'A test of the generated Android Studio project; nothing a creator sees changes.' },
  'fix(android): every Android package fills its manifest from one list':
    { note: 'A native Android app can reach the network: its manifest never asked for it, so a remote group\'s assets, hot updates and the debug channel all failed on Android. A development build also allows plain http (a LAN CDN); a shipping build is held to https, and the export warns when its CDN is http.' },
  'feat(native): a native build\'s frame can be captured and replayed':
    { note: 'A connected native build\'s frame can be captured and replayed.' },
  'fix(native): a native build reports its draws, and what the debug channel costs it':
    { note: 'A native development build\'s Profiler shows its draw calls, triangles, sprites and VRAM, and what the debug channel costs it: all read 0 on a native build.' },
  'fix(android): the Gradle project and App Bundle settings reach the export':
    { note: 'Android\'s "Android Studio project" and "App Bundle (.aab)" settings take effect: the project file never read them back, so every Android export wrote an APK and nothing else.' },
  'fix(export): the Build dialog\'s export reads the project the way the command line does':
    { note: 'An export from the Build dialog and one from `estella export` now read the project the same way. The dialog\'s builds keep the engine modules a project includes or excludes, which they ignored; the command line\'s carry the project\'s app id (a native package was always `com.estella.game`, so two games replaced each other on a phone), its script entry and scenes folder, its desktop channel and Steam app, and a playable\'s ad network.' },
  'fix(export): the editor and the command line export a project from one reading of it':
    { note: 'An export from the Build dialog and one from `estella export` now read the project the same way. The dialog\'s builds keep the engine modules a project includes or excludes, which they ignored; the command line\'s carry the project\'s app id (a native package was always `com.estella.game`, so two games replaced each other on a phone), its script entry and scenes folder, its desktop channel and Steam app, and a playable\'s ad network.' },
  'feat(export): a project names its exports as profiles, and the command line builds one':
    { note: '**Export profiles.** A project can name several exports of one target in `packaging.profiles` — a test and a production WeChat build, each with its own AppID, CDN root and development or shipping configuration, writing only what differs from the project\'s settings. The Build dialog creates, edits and deletes them per target, marking each setting a profile overrides with a reset that hands it back to the project; `estella export --profile <name>` and the agent\'s `export_game` build the same one, and the size history records which profile a build used.' },
  'feat(build): the Build dialog packages with a project\'s export profile':
    { note: '**Export profiles.** A project can name several exports of one target in `packaging.profiles` — a test and a production WeChat build, each with its own AppID, CDN root and development or shipping configuration, writing only what differs from the project\'s settings. The Build dialog creates, edits and deletes them per target, marking each setting a profile overrides with a reset that hands it back to the project; `estella export --profile <name>` and the agent\'s `export_game` build the same one, and the size history records which profile a build used.' },
  'feat(build): the Build dialog and the agent package with an export profile':
    { note: '**Export profiles.** A project can name several exports of one target in `packaging.profiles` — a test and a production WeChat build, each with its own AppID, CDN root and development or shipping configuration, writing only what differs from the project\'s settings. The Build dialog creates, edits and deletes them per target, marking each setting a profile overrides with a reset that hands it back to the project; `estella export --profile <name>` and the agent\'s `export_game` build the same one, and the size history records which profile a build used.' },
  'fix(play): opening a project no longer waits ten seconds for the play realm':
    { note: 'Opening a project no longer holds the editor behind "Preparing play realm…" for about ten seconds: the play realm\'s warm-up was being cut off and the editor waited out its deadline. A project now opens in under a second, and the first Play is still warm.' },
  'feat(build): export profiles are created, edited and deleted in the Build dialog':
    { note: '**Export profiles.** A project can name several exports of one target in `packaging.profiles` — a test and a production WeChat build, each with its own AppID, CDN root and development or shipping configuration, writing only what differs from the project\'s settings. The Build dialog creates, edits and deletes them per target, marking each setting a profile overrides with a reset that hands it back to the project; `estella export --profile <name>` and the agent\'s `export_game` build the same one, and the size history records which profile a build used.' },
  'feat(export): a shipping Android build is signed with the project\'s release key':
    { note: '**Android release signing.** A Shipping APK (and App Bundle) is signed with the release key the project names under Project Settings → Android → Signing — two PEM paths, the passphrase kept in this machine\'s keychain (the command line reads `ESTELLA_ANDROID_KEY_PASSPHRASE`); Development builds keep the development key. A Shipping build without one says it will be refused by Google Play.' },
  'feat(settings): Android release signing is set in Project Settings':
    { note: '**Android release signing.** A Shipping APK (and App Bundle) is signed with the release key the project names under Project Settings → Android → Signing — two PEM paths, the passphrase kept in this machine\'s keychain (the command line reads `ESTELLA_ANDROID_KEY_PASSPHRASE`); Development builds keep the development key. A Shipping build without one says it will be refused by Google Play.' },
  'fix(export): an Android release key may be named under the home directory':
    { note: '**Android release signing.** A Shipping APK (and App Bundle) is signed with the release key the project names under Project Settings → Android → Signing — two PEM paths, the passphrase kept in this machine\'s keychain (the command line reads `ESTELLA_ANDROID_KEY_PASSPHRASE`); Development builds keep the development key. A Shipping build without one says it will be refused by Google Play.' },
  'fix(debug): a device reports the step of its clock with what the channel costs it':
    { note: 'The Profiler no longer reports a connected build\'s debug-channel cost as 0 ms when the device\'s clock is too coarse to measure it — a browser that is not cross-origin isolated steps by 0.1 ms. The device reports its clock\'s step, the row reads "< 0.100 ms", and `profile_frames` returns it as `channelClockMs`.' },
  'fix(profiler): a channel cost below the device clock reads as below it, not as 0':
    { note: 'The Profiler no longer reports a connected build\'s debug-channel cost as 0 ms when the device\'s clock is too coarse to measure it — a browser that is not cross-origin isolated steps by 0.1 ms. The device reports its clock\'s step, the row reads "< 0.100 ms", and `profile_frames` returns it as `channelClockMs`.' },
  'feat(export): the CDN root is the project\'s packaging setting, and export profiles override it':
    { note: 'The CDN root remote asset groups and hot updates use is a packaging setting of the project (`packaging.remoteRoot`, the Package dialog\'s CDN root field), and export profiles override it — a production profile carries the real CDN while the project stays same-origin. `.esengine/asset-groups.json`\'s `activeProfile` / `profiles` are still read for a project that sets no root of its own; hot-update-demo and the hot-update docs use the new shape.' },
  'feat(build): the CDN root field writes the project\'s setting':
    { note: 'The CDN root remote asset groups and hot updates use is a packaging setting of the project (`packaging.remoteRoot`, the Package dialog\'s CDN root field), and export profiles override it — a production profile carries the real CDN while the project stays same-origin. `.esengine/asset-groups.json`\'s `activeProfile` / `profiles` are still read for a project that sets no root of its own; hot-update-demo and the hot-update docs use the new shape.' },
  'fix(export): a compressing host no longer runs the boot bar to the end of the engine download early':
    { note: 'On a host that compresses the engine binary (most CDNs and static hosts), the web boot bar no longer runs to the end of the engine download a third of the way through and stands there for the rest of it: the page divided decompressed bytes by the compressed Content-Length. The export now records the binary\'s own size (`engineBytes` in `game.config.json`) and the bar measures against that.' },
  'fix(settings): the start screen\'s logo says it is for web exports':
    { note: 'Project Settings says the start screen\'s logo is for web exports; a mini-game shows its host\'s own start screen and loading text.' },
  'feat(export): the start screen shows the game\'s code downloading':
    { internal: 'Reverted before release: golden web packages stalled after 29 frames on the CI runners; see the revert.' },
  'feat(export): a WeChat project can render through EmscriptenGLX':
    { note: '**EmscriptenGLX on WeChat.** A WeChat project can ship the engine linked with WeChat\'s EmscriptenGLX (Project Settings → WeChat → Render through EmscriptenGLX, off by default), which issues the engine\'s GL calls natively instead of through JavaScript: a draw-heavy scene spent about 12% less time rendering on an Android phone. It adds about 310KB of wasm and needs base library 3.8.12 on Android, or iOS in 高性能+ mode; any other host renders through WebGL2 as before, and the log says which. The engine is built once with `node build-tools/cli.js build -t wechat-glx`, which fetches WeChat\'s library at a pinned version and hash, and emsdk 4.0.10 beside the main one; an export that asks for it without it says so.' },
  'feat(settings): WeChat\'s EmscriptenGLX is a project setting':
    { note: '**EmscriptenGLX on WeChat.** A WeChat project can ship the engine linked with WeChat\'s EmscriptenGLX (Project Settings → WeChat → Render through EmscriptenGLX, off by default), which issues the engine\'s GL calls natively instead of through JavaScript: a draw-heavy scene spent about 12% less time rendering on an Android phone. It adds about 310KB of wasm and needs base library 3.8.12 on Android, or iOS in 高性能+ mode; any other host renders through WebGL2 as before, and the log says which. The engine is built once with `node build-tools/cli.js build -t wechat-glx`, which fetches WeChat\'s library at a pinned version and hash, and emsdk 4.0.10 beside the main one; an export that asks for it without it says so.' },
  'feat(debug): a connected build says which graphics API it draws through':
    { note: 'A connected development build says which graphics API it draws through' },
  'feat(profiler): the Profiler shows which graphics API a device draws through':
    { note: 'A connected development build says which graphics API it draws through' },
  'fix(export): a mini-game package draws each atlas sprite as its own frame':
    { note: 'A WeChat or other mini-game package draws each sprite from a packed atlas as its own frame again, not as the whole atlas page shrunk into the sprite. The package\'s scenes now keep their `@uuid:` references as the web package does, and a reference by bare uuid finds its atlas frame too.' },
  'fix(minigame): sprite masks draw in a mini-game package':
    { note: 'Sprite masks work in WeChat and other mini-game packages: the game\'s WebGL context was created without a stencil buffer, so every mask drew as if it were not there (space-shooter\'s hull bar read as empty). The web, playable and mini-game hosts now create the context with the same attributes.' },
  'test(golden): space-shooter is certified on WeChat by the pixels it claims':
    { internal: 'A repository golden check; no creator runs it.' },
  'feat(debug): a connected build answers with the whole frame it composited':
    { note: 'A connected development build can be asked for the whole frame it composited' },
  'feat(agent): device_screenshot shows what a connected build shows its player':
    { note: 'A connected development build can be asked for the whole frame it composited' },
  'fix(wechat): a WeChat package registers the engine components and AI names again':
    { note: 'A WeChat package registers every engine component and the built-in AI names again. The WeChat entries lost their start-up calls to the bundler, so a scene using a component with no typed definition — a rigged model\'s MeshSkin among them — loaded without it ("Unknown component type") and its character was never skinned.' },
  'fix(ecs): a list field reads back as an array on every read path':
    { note: 'Reading a component whose field is a list of entities — a node\'s Children, a skin\'s joints — returns an array from every read path and frees the engine\'s copy. `world.tryGet` and query iteration handed back the engine\'s vector: an animated rig leaked one per joint per frame, and on the WeChat EmscriptenGLX engine, whose vectors cannot be iterated, the animator threw every frame.' },
  'fix(import): import-model registers the images a model names on disk':
    { note: '`estella import-model` registers the images a model references on disk, so an export ships them. It wrote the materials and prefab that name them and left the images themselves unregistered, and a package built from the command line carried none of its textures.' },
  'feat(render): KTX2 textures under zstd supercompression decode on web and mini-games':
    { note: 'Web and mini-game packages decode Zstandard-supercompressed KTX2' },
  'refactor(build): the GLX engine adds its exports to the WeChat lists':
    { internal: 'The WeChat GLX engine exports the same functions as before; its link flags now extend the WeChat lists instead of restating them.' },
  'fix(export): the size report reads a Windows path as it reads any other':
    { note: 'The package size report on Windows attributes the SDK\'s bytes to the directories they come from again: every module read as "project", since the source map\'s paths were spelled with backslashes.' },
  'test(launch): the launchers print every warning and error, and count a logged error':
    { internal: 'Repository launchers; no creator runs them.' },
  'fix(render): a compressed texture is sampled with the mip chain it carries':
    { note: 'Compressed (KTX2) textures on web and mini-games are sampled with their mip chain. The cook has always written one into every texture it compresses, and only level 0 reached the GPU: a compressed texture shimmered as it shrank into the distance, and the rest of its bytes shipped for nothing. A texture decoded to RGBA on a device with no compressed format gets its chain generated.' },
  'feat(export): an authored single-level KTX2 ships with a mip chain':
    { note: 'A single-level KTX2 made outside Estella ships with a mip chain' },
  'perf(export): the cook reads back a texture encode it already did':
    { note: 'Exporting again is fast when the art has not changed' },
  'feat(asset): a scene preload reports what each asset type cost':
    { note: 'A scene\'s preload says what each asset type cost it' },
  'perf(asset): KTX2 textures transcode on worker threads':
    { note: 'KTX2 textures transcode on worker threads' },
  'fix(asset): a preload times itself without a platform':
    { internal: 'The per-type preload timings landed one commit earlier and never shipped; they read the platform clock, which a realm without a platform (the SDK tests) does not have.' },
  'feat(asset): the runtime reads an asset out of the pack its export put it in':
    { note: 'Web exports pack their small assets into a few files' },
  'feat(export): a web export packs its small local assets into a few files':
    { note: 'Web exports pack their small assets into a few files' },
  'fix(render): a two-channel normal map lights its surface':
    { note: 'Normal maps stored in two channels light correctly. The shader rebuilds Z from X and Y instead of reading blue, so a BC5 map, or one a converter wrote with blue at 0 — every normal map of Bistro\'s glTF conversion — no longer points its surface\'s normals inward, which left normal-mapped surfaces unlit by their sun.' },
  'feat(import): a model brings its DDS maps as PNG and reads a packed specular map':
    { note: 'Importing a model converts its DDS textures to PNG' },
  'feat(import): a model\'s specular map is read as its import settings say':
    { note: 'An FBX model\'s specular map can be read as packed ORM' },
  'feat(cook): textures encode on every core':
    { note: 'Exporting compresses textures on every core' },
  'fix(render): a double-sided mesh is lit on the side the camera sees':
    { note: 'A double-sided mesh is lit on the side the camera sees' },
  'fix(postprocess): an effect before bloom or SSAO takes effect':
    { note: 'A post-process effect placed before bloom or SSAO takes effect' },
  'feat(import): an FBX material takes its alpha from its base colour, and .DoubleSided draws both sides':
    { note: 'An FBX material takes its alpha from its base colour image' },
  'fix(texture): data maps are sampled as data under the linear pipeline':
    { note: 'Normal, roughness/metalness and occlusion maps are sampled as data' },
  'fix(import): a model\'s data maps reach their .meta as not sRGB':
    { note: 'Normal, roughness/metalness and occlusion maps are sampled as data' },
  'feat(project): a project file\'s settings that nothing reads are named':
    { note: 'A project file\'s settings that nothing reads are named instead of dropped' },
  'feat(project): opening a project names the settings its file carries that nothing reads':
    { note: 'A project file\'s settings that nothing reads are named instead of dropped' },
  'feat(health): a shader declares which textures it reads as data':
    { note: 'Project Health names the textures a material reads as data while they are still decoded as colour' },
  'feat(health): the preflight names data maps decoded as colour, and fixes them':
    { note: 'Project Health names the textures a material reads as data while they are still decoded as colour' },
  'feat(render): a cutout\'s edge is antialiased':
    { note: 'A cutout\'s edge is antialiased' },
  'feat(import): a model brings its lights and cameras':
    { note: 'Importing a model brings its lights and cameras' },
  'feat(assets): a cutout\'s mips keep its coverage':
    { note: 'A cutout\'s mip levels keep its coverage' },
  'feat(import): images several materials share get every setting they ask for':
    { note: 'A cutout\'s mip levels keep its coverage' },
  'fix(render): textures are mipmapped on WebGPU':
    { note: 'Textures are sampled through mip levels on WebGPU' },
  'fix(render): WebGPU post-processing keeps the picture the right way up':
    { note: 'WebGPU post-processing keeps the picture the right way up' },
  'fix(render): ambient occlusion works behind another effect':
    { note: 'Ambient occlusion works behind another post-process effect' },
  'fix(render): a shipped game\'s textures are mipmapped':
    { note: 'A shipped game\'s textures are sampled through mip levels' },
  'fix(render): a shipped game samples data textures as data':
    { note: 'A shipped game samples normal maps and roughness maps as data' },
  'fix(render): normal maps stay on up close':
    { note: 'Normal maps stay on up close' },
  'feat(bake): the editor bakes a lit surface\'s indirect light off the main thread':
    { note: 'The editor stays responsive while it bakes' },
  'feat(bake): baked light is a lit surface\'s indirect light':
    { note: 'Baked light is a lit surface\'s indirect light' },
  'perf(bake): a bake uses every core':
    { note: 'A bake uses every core, in C++' },
  'perf(bake): the editor bakes on every core':
    { note: 'A bake uses every core, in C++' },
  'perf(bake): the rays of a bake run in a C++ kernel on every core':
    { note: 'A bake uses every core, in C++' },
  'perf(bake): the editor bakes through the C++ kernel':
    { note: 'A bake uses every core, in C++' },
  'perf(bake): a texture\'s average reads sRGB through a table':
    { note: 'A bake uses every core, in C++' },
  'perf(bake): the kernel averages a bake\'s textures on every core':
    { note: 'A bake uses every core, in C++' },
  'fix(bake): a baked atlas is read the way up it was baked':
    { note: 'Baked light lands where it was baked' },
  'fix(bake): a baked atlas ships at the size it was baked':
    { note: 'A baked atlas ships at the size it was baked' },
  'fix(bake): the editor\'s atlas takes the import settings a bake owns':
    { note: 'A baked atlas ships at the size it was baked' },
  'fix(environment): a panorama is read as it was shot, not mirrored':
    { note: 'An environment is no longer mirrored' },
  'feat(environment): a directional light can be the environment\'s sun':
    { note: 'A directional light can be the environment\'s sun' },
  'feat(editor): a light following the environment\'s sun is drawn along it':
    { note: 'A directional light can be the environment\'s sun' },
  'fix(bake-scene): a scene of prefab instances is refused, not crashed on':
    { note: '`bake-scene` refuses a scene made of prefab instances instead of crashing on it' },
  'fix(editor): the viewport draws textures compressed, as a build ships them':
    { note: 'A large project opens in minutes, not half an hour' },
  'refactor(assets): one texture cook for a build and the editor':
    { note: 'A large project opens in minutes, not half an hour' },
  'fix(gates): texture-format reads the cook where the texture decision now lives':
    { internal: 'a static gate reading moved source; nothing a creator runs changes' },
  'fix(bake): an atlas\'s import settings are the bake\'s, and --check holds them':
    { note: 'physics-3d\'s lightmap is read as the light it is' },
  'feat(assets): a texture\'s Compression is Auto, GPU compressed or Original image':
    { note: 'A texture\'s Compression is Auto, GPU compressed or Original image, and a build does what it says' },
  'feat(editor): a texture\'s Compression is Auto, GPU compressed or Original image':
    { note: 'A texture\'s Compression is Auto, GPU compressed or Original image, and a build does what it says' },
  'fix(bake): a coloured light bakes the colour it lights with':
    { note: 'A coloured light bakes the colour it lights with' },
  'fix(bake): the collector reads the colour space from the engine host':
    { internal: 'Moves where an unreleased change reads a value from; it only mattered to tests that could not load.' },
  'fix(bake): the collector bakes lights in the project\'s colour space':
    { note: 'A coloured light bakes the colour it lights with' },
  'fix(bake): texels on an edge two triangles share are not an overlap':
    { note: 'A model whose second UV set cannot be baked into' },
  'perf(renderer): a draw\'s uniform blocks are ranges of shared pages, uploaded once per pass':
    { note: 'A scene of thousands of meshes draws its first frame in seconds' },
  'perf(editor): a texture unchanged since the last open is answered from its cache file':
    { note: 'A large project opens in minutes, not half an hour' },
  'refactor(assets): the texture cook reports the cache file it used':
    { note: 'A large project opens in minutes, not half an hour' },
  'fix(editor): a texture\'s remembered cache entry is relative to the project':
    { note: 'A project that moves keeps answering its textures from its own cache' },
  'fix(eht): the generator writes LF on every platform':
    { internal: 'The engine header tool is a repository generator; on Windows it rewrote every generated file with CRLF, which only a contributor there ever saw.' },

  // v0.77.0: audited engine and editor changes.
  "fix(tools): load production hierarchy button styles (#87)":
    {"internal":"Loads shipped styles in a repository measurement harness; no production behavior changes."},
  "fix(ui): escape text cache parameter boundaries (#86)":
    {"note":"Text cache entries respect overflow and parameter boundaries."},
  "fix(ui): invalidate text cache when overflow changes (#85)":
    {"note":"Text cache entries respect overflow and parameter boundaries."},
  "fix(ui): restrict nested dialog focus to inner modal (#84)":
    {"note":"Keyboard and pointer focus stay with eligible UI controls."},
  "fix(ui): retain quick-click edges for pointer focus (#81)":
    {"note":"Keyboard and pointer focus stay with eligible UI controls."},
  "fix(ui): exclude hierarchically hidden dialogs from focus scope (#80)":
    {"note":"Keyboard and pointer focus stay with eligible UI controls."},
  "fix(ui): clear focus when live navigation eligibility changes (#79)":
    {"note":"Keyboard and pointer focus stay with eligible UI controls."},
  "fix(ui): keep Web keyboard traversal in the game (#78)":
    {"note":"Keyboard and pointer focus stay with eligible UI controls."},
  "feat(events): expose immutable dispatch observations for UI debugger (#75)":
    {"note":"The UI Debugger follows the live game."},
  "fix: integrate less intrusive 2D gizmo interaction":
    {"note":"Gizmo controls keep a 2D scene easier to edit."},
  "feat: publish screen UI projection helpers for debugger picking":
    {"note":"The UI Debugger follows the live game."},
  "feat(ui): export mask mode and verify nested mask inspection":
    {"note":"The UI Debugger follows the live game."},
  "feat(ui): verify layout and input inspection in Web fixture (#73)":
    {"note":"The UI Debugger follows the live game."},
  "feat(ui): add pseudolocalization and text layout diagnostics":
    {"note":"UI text inspection and pseudolocalization previews."},
  "feat: render camera previews without advancing gameplay":
    {"note":"A selected camera has a preview without advancing gameplay."},
  "fix(editor): integrate selected-only gizmos and 2D priorities":
    {"note":"Gizmo controls keep a 2D scene easier to edit."},
  "fix: publish Android frame reports without source hooks":
    {"note":"Device reports can inspect prebuilt native apps."},
  "fix: verify prebuilt native apps without packaging templates":
    {"note":"Device reports can inspect prebuilt native apps."},
  "feat: add device quality policy and lighting validation":
    {"note":"Device quality profiles can be previewed in the editor."},
  "fix(editor): align UI debugger hierarchy rows (#17)":
    {"note":"The UI Debugger follows the live game."},
  "fix(editor): preserve event recording across debugger tabs (#16)":
    {"note":"The UI Debugger follows the live game."},
  "fix(editor): inspect text input and dialog components (#15)":
    {"note":"The UI Debugger follows the live game."},
  "feat(editor): inspect live runtime focus and Tab traversal (#14)":
    {"note":"The UI Debugger follows the live game."},
  "fix(editor): clarify event paths and filtered empty state (#13)":
    {"note":"The UI Debugger follows the live game."},
  "feat(editor): record actual entity event dispatch in UI debugger (#12)":
    {"note":"The UI Debugger follows the live game."},
  "fix: reduce gizmo clutter and inactive handle interception":
    {"note":"Gizmo controls keep a 2D scene easier to edit."},
  "feat: add UI debugger element picking and live inspection":
    {"note":"The UI Debugger follows the live game."},
  "feat(ui): diagnose ancestor masks and rectangular clipping":
    {"note":"The UI Debugger follows the live game."},
  "feat(ui): inspect layout bounds and input configuration (#10)":
    {"note":"The UI Debugger follows the live game."},
  "feat(ui): add localization preview and text overflow inspector":
    {"note":"UI text inspection and pseudolocalization previews."},
  "feat: add selected camera preview and editor acceptance checks":
    {"note":"A selected camera has a preview without advancing gameplay."},
  "fix(viewport): show detailed gizmos for selected entities":
    {"note":"Gizmo controls keep a 2D scene easier to edit."},
  "fix: test paired engine changes in editor CI":
    {"internal":"Chooses the matching engine branch in editor CI; changes only contributor verification."},
  "feat: preview device quality and stabilize lighting workflows":
    {"note":"Device quality profiles can be previewed in the editor."},
};
