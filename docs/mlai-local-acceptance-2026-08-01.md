# MLAI Plane local acceptance evidence — 1 August 2026

This record covers the pinned Community `v1.4.0` deployment assets only. It is
local, disposable evidence and is not a substitute for Tunnel, gateway, Access,
managed-service, browser, integration, performance, or production acceptance.

## Fresh boot

A final new Compose project (`mlai-acceptance8`) was started from empty volumes using
`deployments/mlai/compose.yaml` and the OCI digests in
`deployments/mlai/release-manifest.json`. Before creating an administrator,
Django assertions proved:

- `current_version == 1.4.0`;
- setup was incomplete and telemetry was disabled;
- `ENABLE_SIGNUP=0`;
- `ENABLE_MAGIC_LINK_LOGIN=0`;
- `DISABLE_WORKSPACE_CREATION=1`; and
- `ENABLE_EMAIL_PASSWORD=1`.

The `instance-bootstrap` service completed before the API and workers, and none
of those services restarted during the acceptance run.

## Authenticated core workflow

`deployments/mlai/scripts/bootstrap-local-smoke.sh` passed against the
loopback-only proxy. It used a generated in-memory password and verified:

1. initial administrator creation (`302`);
2. MLAI workspace creation (`201`);
3. application password sign-in with a host-only `__Host-plane-session`;
4. private project create, read, update, and delete;
5. default workflow-state retrieval;
6. work-item create, update, read, and delete;
7. a v2 attachment presign whose URL was exactly HTTPS on the public
   `plane-staging.mlai.au` host, not the private origin; and
8. `404` responses after both deletions.

The script is intentionally hard-coded to `127.0.0.1:8080`, refuses an already
configured instance, never prints the generated password or session values, and
does not provision production data.

## Backup and restore drill

The final bundled drill first validated the exact release manifest and safe
runtime settings, stopped the public proxy plus all application writers, and created its directory/dump/marker at
mode `0700`/`0600`/`0600`. It captured a PostgreSQL custom-format dump, the
MinIO export, the release manifest, and a completion timestamp. After the
backup:

- the instance name was changed to `MUTATED AFTER BACKUP`; and
- a known object-store marker present in the backup was removed.

The confirmation-gated restore matched the release manifest and parsed the dump
before changing data. It then stopped writers, force-recreated the configured
database, restored PostgreSQL and `/export`, purged RabbitMQ queues and Valkey,
and restarted application services behind the new MinIO readiness gate. Both
backup and restore logs proved the proxy was stopped before object copying or
replacement and restarted only with the application services.
Post-restore assertions proved the instance name was again `MLAI`, setup was
complete, telemetry remained disabled, public signup and magic login remained
off, workspace creation remained disabled, email/password remained enabled, the
stale cache marker was absent, and the object marker was restored. All dependency
health checks, including MinIO, passed after restart.

The drill also found and corrected an incompatibility before restore: the
pinned MinIO image has no `find` executable. The restore now clears only the
contents of the explicit `/export` mount using the image's available `rm`.

## Edge unit evidence

The separate `mlai-plane-edge` Workerd suite passed 31 tests. It covers exact
incoming MLAI-cookie removal, future denylist entries, response-cookie domain
sanitisation, multiple `Set-Cookie` fields, streaming bodies, redirects,
WebSocket response preservation, spoofed forwarding headers, fail-closed
configuration, legacy service-binding rollback, and legacy logout cookie
deletion. TypeScript and a production Wrangler dry run also passed.
The final two tests require an immutable public-fork commit and verify the
well-known AGPL source disclosure without contacting the origin.

A disposable Workers.dev/Quick Tunnel rehearsal then reached the local Plane
stack and returned `200` with the expected release, telemetry state, noindex,
framing, and cookie-domain policy. A separate boolean-only origin canary proved
the deployed Worker removed `access_token`, `refresh_token`, `sessionid`, and
`CF_Authorization`, preserved `__Host-plane-session`, and kept two response
cookies distinct without a parent-domain attribute. The temporary tunnels were
terminated and the staging Worker was returned to its `.invalid`, fail-closed
origin; a fresh request returned `503`. Immutable Worker version IDs and exact
scope are recorded in the edge repository's `ACCEPTANCE.md`.

## Still required

No persistent named Tunnel origin, Cloudflare Access policy, `mlai.au` staging
hostname, production data service, SMTP/OAuth provider, WebSocket handshake,
browser workflow, actual attachment byte transfer, monitoring, or
disaster-recovery target was available in this run. The named Tunnel must use
the checked-in public-host rewrite and staging must prove OAuth `redirect_uri`
plus signed upload/download hosts before release. Those remain release gates.
