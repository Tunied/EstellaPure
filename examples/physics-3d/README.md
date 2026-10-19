# 3D Physics

A playable Jolt workshop with a character, crates, a hinged door, ropes, welded
bodies, a lift, and authored SwingTwist / SixDOF joints. Shapes use the runtime
physics debug overlay; no additional character or model assets are required.

- WASD / arrows: walk; Space: jump; F1: toggle shape drawing.
- J: reverse the shoulder and carriage motors without rebuilding their joints.
- Select UpperArm or SixDOFCarriage in the editor to edit their limits and motors.
  The viewport displays read-only limits; Inspector angles are degrees while
  serialized angles remain radians.

The shoulder's elliptical cone limits are 0.5 / 0.7 radians with twist ±0.35.
The carriage translates ±100 world units along X and rotates ±0.3 radians around
Y; other axes are locked. Both motors start enabled for demonstration. A newly
added joint component defaults to motors off.

`node tools/check-physics3d.mjs` exercises actual Jolt bounds and motor reversal.
SDK tests cover unit conversion, rebuilding and lifecycle; editor checks run in
CI. Headless software results do not constitute native or physical-device
acceptance. Export through the existing project build command.
