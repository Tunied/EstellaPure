// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { SwingTwistJoint3D, SixDOFJoint3D, joint3DSettingsError } from '../src/physics3d/AdvancedJoint3D';
import { assertPhysics3DContract } from '../src/physics3d/Physics3DModule';

describe('advanced joint validation', () => {
  it('accepts all defaults and independent free/limited axes', () => {
    expect(joint3DSettingsError(structuredClone(SwingTwistJoint3D._default))).toBeNull();
    const d = structuredClone(SixDOFJoint3D._default);
    d.rotationMotion = { x: 2, y: 1, z: 0 };
    expect(joint3DSettingsError(d)).toBeNull();
    d.rotationLower.y = 1;
    d.rotationUpper.y = -.2;
    expect(joint3DSettingsError(d)).toMatch(/lower bound/);
  });
  it('rejects nonfinite motors, invalid modes, and parallel frames', () => {
    const d = structuredClone(SixDOFJoint3D._default);
    d.maxMotorForce = Infinity;
    expect(joint3DSettingsError(d)).toMatch(/Motor force/);
    d.maxMotorForce = 0;
    d.translationMotion.x = 3;
    expect(joint3DSettingsError(d)).toMatch(/Axis motion/);
    d.translationMotion.x = 0;
    d.normalAxis = { ...d.axis };
    expect(joint3DSettingsError(d)).toMatch(/parallel/);
  });
  it('rejects a stale physics module at load, before the first simulation frame', () => {
    expect(() => assertPhysics3DContract({})).toThrow('_physics3d_addSwingTwistJoint');
    expect(() => assertPhysics3DContract({})).toThrow('_physics3d_addSixDOFJoint');
  });
});
