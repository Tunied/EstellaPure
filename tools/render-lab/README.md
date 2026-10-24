# Render lab

Small scenes with known answers, drawn by Blender (Cycles) and by the engine from the same glTF, the same camera, sun and sky. A sphere's
brightness is a formula and a shadow's edge is where a ray goes, so what the two renderers disagree about points at one formula.

Scenes are listed in `lab_specs.py`: `balls_sun`, `balls_env` (six spheres, dielectric and metal at roughness 0.15 / 0.45 / 0.9, under a sun
alone or a uniform white sky alone), `shadow`, `shadow_soft` (a floor, a box and a sphere, a hard sun and one of 3.4 degrees), `strands`
(cards of fine stripes seen small: a cut-out, an opaque one, a ramp).

```bash
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"; O=D:/estella/output/render-lab
"$B" --background --python tools/render-lab/build_lab.py -- balls $O/balls.glb             # the scene, as a GLB
"$B" --background --python tools/render-lab/lab_ref.py -- balls_sun $O/balls.glb $O/ref_balls_sun.png
BACKEND=webgl2 bash tools/render-lab/run-lab.sh balls_sun $O/balls.glb                     # or BACKEND=webgpu (opens a window)
python tools/render-lab/lab_compare.py balls_sun $O/ref_balls_sun.png $O/engine_balls_sun.png $O/cmp_balls_sun.png
```

Blender renders with the Standard view transform and the engine with no output transform, so the two PNGs compare as they are. A Blender sun of
strength S lights a white diffuse surface to S / pi; the engine's sun of intensity I to I, so the lab gives Blender pi times the engine's intensity.
`sourceAngle` is in degrees in the engine and radians in Blender. Spheres stand three metres apart so one does not light another (the engine has
no bounce light by default; Blender has twelve bounces).
