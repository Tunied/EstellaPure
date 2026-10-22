# Wilds

A lake under mountains at dusk, made to show what the ground, the water, the plants and the sky can do together.

- **`Terrain`** reads `assets/textures/height.png` (sixteen bits packed in red and green) and cuts it into sixteen by sixteen chunks, each at four levels of detail, painted by height and slope through the **Terrain** material.
- **`Water`** is a plane on the **Water** material: the depth is measured against the scene behind it, so the lake goes from pale teal at the shore to deep blue, with foam where it is shallow.
- **`Foliage`** grows a meadow of grass round the camera and a forest of pines over the foothills. Both sway through the **Foliage** material; far pines are drawn as cards.
- **The sky** is the Sky Atmosphere effect, with clouds that cast shadows on the land, and a `TimeOfDay` that holds the sun low.

There is no source art: the four ground textures, the pine and the heightmap are made from numbers.

```
node build-tools/cli.js sdk
node examples/wilds/tools/build.mjs
```

The numbers are at the top of `tools/build.mjs`: change the lake's level or place, the heights, the tree counts, and run it again. The ground and the plants are built a few chunks a frame, so the picture fills in over its first second.
