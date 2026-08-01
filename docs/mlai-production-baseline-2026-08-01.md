# MLAI production baseline before Plane cutover

Captured: 1 August 2026 (Australia/Melbourne)

This baseline is the rollback reference. It records current public revisions and
deployments without claiming that a Worker deployment is byte-for-byte mapped to
a Git commit unless the deployment metadata proves that mapping.

| System | Repository `origin/main` | Current deployment evidence | Current domain | Owner/evidence |
| --- | --- | --- | --- | --- |
| Public website | `MLAI-AUS-Inc/mlai-au` at `c964657379d3dba30f81286a40adef38946b878d` | Worker version `f5733abc-3f1a-4563-b162-fb2e8887ddce`, deployed 2026-08-01 05:24:03Z; main build run 30685703572 passed | `mlai.au`, `www.mlai.au` | Worker deployment author `tom@mlai.au`; repository/platform accountability to be confirmed |
| Existing admin | `MLAI-AUS-Inc/mlai-admin` at `a932d12fc24e79ee38f61cf1ddfb85db53815ac1` | Worker version `350086c1-119e-4639-aa10-1ad31922ddf8`, deployed 2026-07-25 09:39:42Z; main build run 30153145004 passed | `admin.mlai.au` | Worker deployment author `sam@mlai.au`; repository/platform accountability to be confirmed |
| Django API | `MLAI-AUS-Inc/mlai-backend` at `202e1ef19269a3d3af5d87d38c13e1c0952ba2af` | Main deploy run 30687425844 passed at 2026-08-01 06:25:26Z | `api.mlai.au` | Workflow uses the production host configured by the repository; infrastructure accountability to be confirmed |
| Plane fork | `MLAI-AUS-Inc/mlai-plane`, upstream `v1.4.0` at `917b23a6c16d93fc00cef67900eff2755e8b13f7` | No production deployment at capture time | Proposed `admin.mlai.au` | MLAI platform maintainers |

## Existing admin workflow baseline

The preserved Worker must continue to support:

- overview and adoption metrics;
- Vibe Raising update list and detail;
- review queue;
- Vibe Marketing usage metrics;
- session refresh and logout;
- routes `/`, `/updates`, `/updates/:id`, `/review`, and `/logout`.

The clean transition branch is based on `mlai-admin` `origin/main` rather than the
older local checkout. Before cutover, archive the exact Worker settings, secrets
names, custom domains, and route smoke-test output without exporting secret
values.

## Rollback invariants

- Keep the existing admin Worker deployed throughout the observation window.
- Keep `ops.mlai.au` verified before removing the old `admin.mlai.au` binding.
- Route rollback through the gateway's legacy service binding rather than DNS.
- Preserve any post-cutover Plane writes by snapshotting its database and object
  storage before a rollback.
