# ADR 0001: Plane edition and application boundary

- Status: Accepted for the staff pilot
- Date: 1 August 2026
- Decision owners: MLAI platform maintainers
- Production approval: pending licensing/security sign-off

## Context

MLAI needs a project-management workspace at `admin.mlai.au` using the public
`makeplane/plane` repository. The existing public website is a React Router
Cloudflare Worker, while Plane requires a web application, API, live WebSocket
service, background workers, PostgreSQL, Valkey/Redis, RabbitMQ, and object
storage. The hostname is also occupied by MLAI's existing operations Worker.

Plane Community Edition does not provide every paid Plane or current Linear
capability. Installing Community Edition therefore cannot honestly be described
as complete Linear parity.

## Decision

1. Start the staff pilot on Plane Community Edition `v1.4.0`, upstream commit
   `917b23a6c16d93fc00cef67900eff2755e8b13f7`.
2. Run Plane as a standalone stateful deployment. Do not embed, iframe, or copy
   Plane into the `mlai-au` Cloudflare Worker.
3. Keep this public fork as the corresponding-source location and retain
   `makeplane/plane` as the `upstream` Git remote.
4. Pin every deployed image by OCI digest. Never deploy moving `preview`,
   `latest`, or `stable` tags.
5. Preserve the existing `mlai-admin` application at `ops.mlai.au` before Plane
   takes `admin.mlai.au`.
6. Use the versioned parity matrix to decide each feature as Community
   configuration, Commercial Plane, custom AGPL work, external integration, or
   an explicitly approved difference.
7. Prefer configuration, Plane Apps, REST APIs, and signed webhooks over core
   forks. Any deployed program modification must remain available as
   corresponding source.

## Consequences

- Core project/work-item functionality can be piloted without a commercial
  contract.
- Paid-tier and custom-development decisions remain explicit release gates.
- Plane infrastructure and operations are independent of website deployment.
- Literal current Linear parity remains a multi-wave programme rather than the
  initial cutover criterion.
- Production requires a legal review of AGPL obligations and any Commercial
  Plane EULA before commercial code is introduced.
