# Generated World

A world laid out by rules as you walk through it: the ground goes on for ever, the biomes follow moisture and stone, pines stand in
groves round an elder tree, rocks lie in groups with their scree, copper crops out where the stone does, and a home clearing and a
road are kept open.

- **`Terrain`** is ground without end from the engine's noise provider (`estella:noise`, version 1).
- **`WorldGen`** names the rules in `src/main.ts`: three biomes, five recipes and three layers (groups, resources, detail). The engine
  lays them out round the camera in chunks, nearest first, and lets them go behind it.
- **`WorldZone`**s plan by hand: the home keeps everything out and holds the meadow; the road keeps out trees and rocks.
- **Keys:** W A S D walk, Q E turn, M mines the nearest copper (a change the world keeps), B builds a house in front of you (a zone
  that keeps the wild out of its ground).

The ground textures and the pine are the Wilds example's; the rock and the scene are made by `tools/build.mjs`:

```
node build-tools/cli.js sdk
node examples/worldgen/tools/build.mjs
```

`WORLDGEN_TOP=1` writes the scene with the camera looking straight down on the home, to see how the world is laid out.
`.esengine/asset-groups.json` ships the models and materials the recipes name by path, which no scene references.
