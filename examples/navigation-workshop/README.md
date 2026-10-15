# Citadel Route Workshop

A playable 2D courtyard for navigation authoring. The scene contains CC0 pixel
art, an editable gate and storehouse, and eight authored couriers.

- **G / Toggle gate:** close the passage when clear. Couriers approach the near
  side, retain their destination and resume after reopening. Closing on an
  occupied passage is refused; nobody is teleported out of the way.
- **B / Storehouse:** place or remove the warehouse on its marked plot. A plot
  occupied by a courier is refused. Existing destinations take a detour.
- **C / Crowd:** switch between eight and 24 couriers, then dispatch them again.
- **R / Reset:** reset deliveries while preserving the gate/building settings.
- **U / Reload terrain:** load `assets/navigation/courtyard.json` through the
  asset system and atomically replace the grid. Couriers keep their targets and
  wait while loading; live gate/storehouse obstacles are applied to the new grid.
- **Esc / Cancel reload:** retain the current grid and resume its routes. A late
  asset result cannot commit after cancellation or a newer reload request.

The buttons support pointer/touch input; the keys are desktop shortcuts. The
status shows completed deliveries and plans waiting in the engine's fair queue.
In the editor, select a courier during Play and use **Inspect current route**.
Pending terrain requests report **Navigation is updating**. Terrain data loads
asynchronously; this example does not move mesh baking to a worker. The request
owner releases the JSON lease even when its result is cancelled or superseded.

`Gate` and `Warehouse` are scene-authored `NavObstacle` entities. Their
visuals follow their authored `enabled` fields, including edits during
Play; placement guards read the current extents and courier radii/speeds. The floor and
stonework are grouped in the Outliner; the eight starting couriers are ordinary
scene entities with `NavAgent`. Extra crowd members are spawned at runtime.
The script installs a 23×13 grid; obstacle marking and replanning belong to the
engine, not a second pathfinder in this sample. Periodic replanning is disabled
to demonstrate topology-triggered replanning.

Assets and their licenses are listed in [ASSET_LICENSES.md](ASSET_LICENSES.md).
Editable workshop graphics are in `art/`. Rebuild scene art with
`node tools/generate-navigation-workshop.mjs` from the repository root.
