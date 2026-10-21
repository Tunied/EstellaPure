# Bistro

Amazon Lumberyard's Paris street, drawn with the engine's own sun, sky and post-processing.

Credit and licence: see `examples/ASSETS.md` — CC BY 4.0, modified.

## What was done to the source

The source is `BistroExterior.fbx` (2.8 M triangles, 4096-pixel DDS images, 853 MB with the interior
scenes) from <https://developer.nvidia.com/orca/amazon-lumberyard-bistro>. To fit in a repository:

1. imported with the editor's FBX import (`assets/models/BistroExterior.esprefab` and the `.esmesh`,
   `.esmaterial` and image products it writes);
2. pieces whose centre lies more than 25 m from the point the original camera looks at were dropped,
   and the prefab's own camera and light were removed (the scene brings its own);
3. images were resized to 1024 pixels and, where fully opaque, saved as JPEG.

The model was imported with *Generate Lightmap UVs* on, so the bake has a patch per surface. Pieces
the reference camera cannot see (beyond about 45 m, or outside a cone around its view) were dropped.

`tools/pieces.json` is what the hierarchy came to: one entry per remaining mesh with its world
transform. `tools/build-scene.mjs` turns that into the flat scene `assets/scenes/main.esscene`, and the
bake writes the lightmap, the probe grid and the reflections beside it:

```
node examples/bistro/tools/build-scene.mjs
node pipeline/bin/estella.mjs bake-scene examples/bistro/assets/scenes/main.esscene
```

The sun is the sky's own (`followEnvironmentSun`), the sky is turned half a revolution, and the project
renders in linear light with the Neutral output transform, which keeps the awnings red where ACES walks them to cream. Leaves, flowers and ivy are cut out by alpha and bake like everything else.