# Creative workflow performance and reliability implementation plan

**Goal:** Repair the audited request/generation failures and reduce unnecessary loading, rendering and history work without changing payment, quota, permissions or upstream billing.

**Architecture:** Keep current React, Zustand, query cache and server job lifecycle. Use independent bounded patches for network recovery, canvas derived data, color loading and prompt lists. Publish only after integration tests and the existing image CI pass.

**Tech stack:** React 19, TypeScript, Bun tests, Vite, SQLite-backed job API.

## 1. Request deadlines and job recovery
- Modify `web/src/services/server-api.ts`; add focused network tests using mocked fetch/streams.
- Keep request deadlines active through response body reads; propagate cancellation to polling reads.
- Retry transient polling failures against the same job, distinguishing terminal HTTP/auth errors. Never resubmit paid generation automatically.
- Test delayed response bodies, intermittent disconnects, terminal failures and cancellation.

## 2. Canvas
- Modify `web/src/pages/canvas/project.tsx`, canvas resource helpers and focused tests.
- Reuse semantic resource derivations when only position/size changes; invalidate on metadata, type or connections.
- In image API and canvas integration, render recoverable results before archival; preserve background archival updates and clear pending-save status. Avoid losing permanent image links.

## 3. Color loading
- Modify `web/src/services/image-storage.ts` and color renderer/preview loading paths.
- Add bounded, abortable image reads. Abort obsolete preview requests and export loads; test cleanup and error paths.

## 4. Prompt lists
- Modify shared prompt grid and its page/dialog callers; add focused range tests.
- Bound mounted cards for long lists while preserving responsive layout, scroll pagination, keyboard access and dialogs.

## 5. Startup, elapsed clock and history
- Inspect public shell imports; defer noncritical modules only when bundle measurements show savings.
- Start current route module loading in parallel with authentication without rendering protected content early.
- Separate elapsed clock subscription from full generation snapshots; test listener behavior.
- Reduce history recovery to changed/recent jobs with bounded server filtering and idempotent reconciliation; preserve cross-account isolation and record recovery.

## 6. Verification and release
- Run nearest tests first (`bun test <changed test paths>`), then web typecheck, full tests and production build.
- Record bundle measurements and residual browser restrictions in pending-test; update changelog.
- Review patch, commit only intended files, invoke `pwsh -NoProfile -File ops/publish-and-deploy.ps1 -HostName 118.190.159.129 -HealthUrl https://mingche.click/health`.
- Confirm exact deployed commit, public health and actual entry assets; do not claim real provider latency or visual acceptance without evidence.
