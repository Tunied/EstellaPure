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

The scene (`assets/scenes/main.esscene`) is written by `tools/build-scene.mjs`.
