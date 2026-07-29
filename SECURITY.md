# Security Policy

## Supported Versions

Security fixes are accepted for the `main` branch and the latest tagged release
of `zdtzn/infinite-canvas`. Older versions are handled on a best-effort basis.

## Reporting a Vulnerability

Do not publish exploit details, credentials, API keys, private user data, or
unredacted screenshots in a public issue.

Preferred reporting process:

1. Use GitHub private vulnerability reporting or open a draft Security Advisory
   for this repository, if that option is available.
2. If no private GitHub channel is available, open a public issue that only asks
   the maintainers to provide a private contact channel. Do not include technical
   exploit details in that issue.

Include the affected version or commit, reproduction steps, expected impact,
deployment mode, and redacted supporting evidence.

## Security Model

The production Docker build runs a Bun monolith with authenticated APIs, SQLite,
server-managed AI channels, and per-user project and media storage. Relevant
security boundaries include:

- Authentication, session cookies, account disablement, and administrator APIs.
- Horizontal authorization for projects, assets, generation history, jobs,
  avatars, cultivation data, and file downloads.
- Encryption and non-disclosure of platform AI provider credentials.
- Generation quota, concurrency, idempotency, refunds, and reward settlement.
- Upstream URL validation, redirects, SSRF controls, prompt-image proxying, and
  response-size limits.
- File type validation, path traversal prevention, storage quotas, imports, and
  exports.
- SQLite migration, backup, restore, and cross-account cache isolation.

The Vite development server is a separate local-only mode. In that mode, project
data and user-supplied API credentials may be stored in the browser. Do not use
the local development mode as the security model for a multi-user deployment.

## Canvas Node Plugins

Production public mode only enables trusted built-in prompt adapters and does
not allow ordinary users to execute arbitrary remote plugin or source scripts.

In local mode, a node plugin installed from a URL executes inside the web page
and can access data available to that page. Only install plugins from sources
you trust. The documented access of an explicitly installed malicious plugin is
not, by itself, a vulnerability. Bypassing installation confirmation, escaping
public-mode restrictions, or accessing another account's server data remains in
scope.

## In Scope

- XSS, CSRF, authentication bypass, privilege escalation, or session theft.
- Cross-user access to projects, assets, history, jobs, profiles, or admin data.
- API key disclosure, broken channel encryption, or secrets exposed in logs.
- SSRF, unsafe redirects, path traversal, unsafe upload/import handling, or
  unauthorized file access.
- Duplicate charging/reward settlement or quota bypass caused by concurrency or
  idempotency flaws.
- Exploitable supply-chain issues in code or default configuration shipped by
  this repository.

## Usually Out of Scope

- Vulnerabilities in third-party AI providers, hosting platforms, browser
  extensions, or the upstream npm registry outside this repository's control.
- A user voluntarily exposing their own credentials outside the application.
- Missing headers without a practical exploit path.
- Social engineering, spam, account recovery requests, or unrealistic denial of
  service scenarios.
- Dependency reports without demonstrated impact on this project.

## Disclosure

Maintainers aim to acknowledge valid reports within seven days and coordinate a
fix before public disclosure. Timelines are best effort for this community
project. Credit is available on request.
