# Third-Party Notices

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

## IMG.LY Background Removal Node

The server-side `灵彩抠图` engine uses [`@imgly/background-removal-node`](https://github.com/imgly/background-removal-js), including its ONNX model assets and Sharp/ONNX Runtime dependencies.

- The package is distributed under the GNU Affero General Public License; its package license and third-party notices are included in the installed server dependency.
- The model runs on the application server. Uploaded images are processed by this application and are not sent to an external background-removal provider.
