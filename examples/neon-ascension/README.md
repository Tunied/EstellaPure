# Neon Ascension (grey-box)

A rain-soaked night city built from boxes, to answer one question before any
art is made: do reflections, warm/cold light contrast and emissive bloom read
the way the concept target does? It is not the finished scene.

## Rebuild

```
node tools/generate-night-env.mjs                                        # assets/env/night.hdr
node ../../pipeline/bin/estella.mjs import-hdr assets/env/night.hdr assets/env
node tools/make-greybox.mjs                                              # scene, materials, project file
```

The night panorama is both the sky behind the scene and what the wet deck
reflects, so its windows and neon carry real HDR radiance. Everything in the
scene is derived from numbers in the two scripts.

## Known gaps (measured on 2026-10-15)

- `distanceFog`'s colour cannot be set from a `PostProcessVolume`: the effect
  definition surfaces floats and textures only, and a colour written there
  blanks the frame once bloom follows. The fog keeps its bright default.
- The wet floor reflects the baked panorama only, not nearby geometry or the
  river; planar reflection would be an engine addition.
- At most 16 point lights are drawn per frame.
