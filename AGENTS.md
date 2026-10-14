# Project priorities

- The product focus is 2D. Prioritize 2D authoring, UI, sprites and animation,
  tilemaps, input, audio, and reliable Web / minigame delivery when choosing
  roadmap work and ordering cards.
- Schedule specialized 3D rendering, large-world features, and character tools
  after the 2D production workflow. Shared fixes that also benefit 2D remain
  eligible for early work.
- Review actual PR merge status and verification evidence before updating
  roadmap completion. A merged PR alone does not prove device acceptance.
- Do not add generated-by attribution or assistant co-author trailers to
  commits, pull requests, roadmap updates, or other deliverables.

# Delivery workflow

- Local verification must not launch the editor, Electron windows, or other visible
  apps. Use genuine headless browser and CLI checks; run editor acceptance in CI.

- After completing appropriate verification, commit and push changes directly to
  the main branch (currently master). Do not create pull requests unless the user
  explicitly requests one.
