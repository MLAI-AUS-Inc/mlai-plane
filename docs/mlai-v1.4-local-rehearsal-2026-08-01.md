# Historical Plane v1.4 local rehearsal — 1 August 2026

This record preserves the useful evidence from the August deployment proposal,
[PR #1](https://github.com/MLAI-AUS-Inc/mlai-plane/pull/1), reconciled with `main`
on 3 October 2026. It describes a disposable local rehearsal. It does not certify
the current deployment or authorize infrastructure, migration, or traffic changes.

The original proposal remains available at immutable commit
[`616a129947936fb900a1a4a383dbc5f0e64e9944`](https://github.com/MLAI-AUS-Inc/mlai-plane/tree/616a129947936fb900a1a4a383dbc5f0e64e9944).
Its [full rehearsal report](https://github.com/MLAI-AUS-Inc/mlai-plane/blob/616a129947936fb900a1a4a383dbc5f0e64e9944/docs/mlai-local-acceptance-2026-08-01.md)
and [pinned image manifest](https://github.com/MLAI-AUS-Inc/mlai-plane/blob/616a129947936fb900a1a4a383dbc5f0e64e9944/deployments/mlai/release-manifest.json)
are historical inputs rather than current operational instructions.

## Recorded observations

The original report records a fresh empty-volume Community v1.4.0 boot with
telemetry, public signup, magic links, and additional workspace creation disabled.
A disposable administrator exercised project and work-item CRUD, password login
with a host-only session cookie, and an HTTPS public-host attachment presign.

Its bundled PostgreSQL/MinIO backup and restore drill stopped the proxy and
application writers. The recorded restore recovered an instance-name change and
an object-store marker, cleared stale cache state, and rechecked authentication
policy. These observations apply to that disposable August environment.

The accompanying edge rehearsal recorded cookie isolation and a temporary
gateway canary. The original staging worker was returned to its fail-closed
placeholder after the rehearsal. The report expressly left named Tunnel, Access,
browser, SMTP/OAuth, attachment-byte transfer, monitoring, and production
durability acceptance outstanding.

## Reconciliation with current main

At reconciliation, main was `2ce3abde9fa47fd00c6f407ff6759f9adcbbca18`. Its
authoritative operational profile is [deploy/mlai](../deploy/mlai/README.md),
which builds the MLAI fork, deploys immutable GHCR digests, uses the canonical
`plane.mlai.au` staging hostname, and requires approval tied to the exact
migration plan and target database. Application deploys exclude migrations.

The August `deployments/mlai` scripts and configuration are therefore retained
in history only. Reintroducing their alternative deployment and restore paths
would obscure the newer operational and migration controls. The reconciliation
preserves the original proposal as a merge parent without restoring those paths
to the current working tree.

## Verification on 3 October 2026

Inspection of the original proposal passed shell syntax, manifest digest shape,
local documentation links, generated disposable environment validation, Compose
configuration validation, duplicate-key rejection, and parent-cookie-domain
rejection. No services, database migrations, backups, restores, or runtime
acceptance tests were rerun for this archival change.
