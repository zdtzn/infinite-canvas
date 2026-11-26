# Third-Party Notices

## Infinite Canvas upstream

The video-frame encoding cancellation and media URL cleanup in `web/src/lib/canvas/canvas-media-tools.ts` adapt the implementation from [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas/blob/4c67f1ece4f4edaef81e58e964eb78abb1e9809d/packages/workbench/src/lib/canvas/canvas-video-frame.ts), reviewed at commit `4c67f1ece4f4edaef81e58e964eb78abb1e9809d`.

The native call presets under `web/src/services/api/call-presets` adapt the same upstream commit's `packages/model-runtime/src/call-scripts`. The host execution, task recovery, and configuration integration are adapted for this fork.

- Copyright (c) 2026 basketikun.
- The adapted upstream code is distributed under the MIT License. See [third_party/licenses/Infinite-Canvas-MIT.txt](third_party/licenses/Infinite-Canvas-MIT.txt).

## 3D Director Desk

The editor under `web/src/features/director-desk/studio` and its scene/layout contracts adapt `plugins/director-desk` from [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas/tree/4c67f1ece4f4edaef81e58e964eb78abb1e9809d/plugins/director-desk). The upstream editor is based on [jiguang132/storyai-3d-director-desk](https://github.com/jiguang132/storyai-3d-director-desk) and uses procedural characters.

- The editor is distributed under the MIT License, copyright (c) 2026 YZ. The supplied license is preserved at [web/src/features/director-desk/LICENSE](web/src/features/director-desk/LICENSE).
- The Infinite Canvas integration is distributed under the upstream MIT License, copyright (c) 2026 basketikun; see the upstream notice above.
- The editor runs in a separate bundled document. This fork's host integration uses the existing account, project, and asset services.
- Distribution copies of both MIT licenses are included under `web/public/licenses`; dependency legal comments are retained in the embedded editor bundle.

## Film-Luts

The Color Alchemy film LUT library includes the `.cube` LUTs and preview thumbnails from [BigNerdCoding/Film-Luts](https://github.com/BigNerdCoding/Film-Luts), vendored under `web/public/film-luts` and loaded on demand.

- The upstream repository is published under the MIT License. The accompanying license is included at `web/public/film-luts/LICENSE`.
- The upstream README notes that some film emulation names and looks may have separate copyright or trademark considerations. Review those terms before commercial redistribution.

## agency-orchestrator

The image prompt optimization workflow in this repository adapts prompt-rewriting and output-cleanup ideas from [jnMetaCode/agency-orchestrator](https://github.com/jnMetaCode/agency-orchestrator), reviewed at commit `588a0643fe04d795d251d5d535b237f53de4f588`.

- The upstream prompt optimizer is licensed under the Apache License 2.0. See [third_party/licenses/Apache-2.0.txt](third_party/licenses/Apache-2.0.txt).
- The upstream image prompt expert material is distributed with the AgentLand agents collection under the MIT License. See [third_party/licenses/AgentLand-MIT.txt](third_party/licenses/AgentLand-MIT.txt).
- Copyright 2026 jnMetaCode; Copyright 2025 AgentLand Contributors.

The implementation here is rewritten for Infinite Canvas. It does not include the upstream multi-agent runtime, CLI, storage layer, prompt laboratory, or global photography-only expert. Photography guidance is activated only when the user's image intent is photographic.

## React Bits

The homepage Light Rays effect and the authenticated-app Splash Cursor effect adapt components from [DavidHDev/react-bits](https://github.com/DavidHDev/react-bits).

- React Bits is distributed under the MIT + Commons Clause License Condition v1.0. See [third_party/licenses/React-Bits-MIT-CC.txt](third_party/licenses/React-Bits-MIT-CC.txt).
- Copyright (c) 2026 David Haz.

The adapted effects are integrated only as part of the Infinite Canvas application and are not offered as standalone components.
