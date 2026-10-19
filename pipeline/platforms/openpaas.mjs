// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// Copy into <project>/.esengine/platforms/openpaas.mjs.
// Uses Estella's shared runtime and export pipeline. PinK builds the .sp file.
export default {
    id: 'openpaas',
    label: 'SUD OpenPaaS',
    blurb: 'PinK third-party directory (2D / 3D). Device acceptance pending.',
    preset: 'openpaas',
    engineBuild: 'quickgame',
    defaultOut: 'dist-openpaas',
};
