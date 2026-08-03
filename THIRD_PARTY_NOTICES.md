# Third-Party Notices

## agency-orchestrator

The image prompt optimization workflow in this repository adapts prompt-rewriting and output-cleanup ideas from [jnMetaCode/agency-orchestrator](https://github.com/jnMetaCode/agency-orchestrator), reviewed at commit `588a0643fe04d795d251d5d535b237f53de4f588`.

- The upstream prompt optimizer is licensed under the Apache License 2.0. See [third_party/licenses/Apache-2.0.txt](third_party/licenses/Apache-2.0.txt).
- The upstream image prompt expert material is distributed with the AgentLand agents collection under the MIT License. See [third_party/licenses/AgentLand-MIT.txt](third_party/licenses/AgentLand-MIT.txt).
- Copyright 2026 jnMetaCode; Copyright 2025 AgentLand Contributors.

The implementation here is rewritten for Infinite Canvas. It does not include the upstream multi-agent runtime, CLI, storage layer, prompt laboratory, or global photography-only expert. Photography guidance is activated only when the user's image intent is photographic.
