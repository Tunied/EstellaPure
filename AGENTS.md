# Project priorities

- 2D and 3D are equally important product directions. Weigh 2D authoring, UI,
  sprites and animation, tilemaps, input, audio and reliable Web / minigame
  delivery together with 3D rendering, lighting, large-world features and
  character tools when choosing roadmap work and ordering cards. Do not defer
  3D behind 2D. Public descriptions (README, docs, repository summary) name
  both.
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

- Routine roadmap work must not bump versions, create tags, or publish releases.
  Release actions require an explicit user request.
