# One-way MLAI Linear → Plane sync

This is a separate Node 22 process, not a Plane plugin or database migration.
Linear is permanently read-only. The source organization, Plane workspace,
private API origin and import namespace are fixed in `config.mjs`.

## Local verification (8 September 2026)

- 18 automated safety/integration tests pass.
- The live-source dry run completed without conflicts before applying changes.
- Initial local apply created 70 records and updated one, with zero conflicts
  and zero pending records. These totals include supporting records, not just issues.
- An OrbStack container dry run using the resulting checkpoint proposed zero writes.
- The installed macOS LaunchAgent's first apply run also completed with zero
  writes or conflicts. Its interval is 300 seconds.
- DigitalOcean scheduling is prepared below but has not been deployed. No
  Linear mutations, database migrations or application restarts were performed.

## Scope and safety

- Poll changed projects, issues, comments, attachment records, cycles, documents,
  initiatives and project updates. Read the small identity/state/label/relation
  collections in full. Reconcile all supported source collections daily.
- Reuse the September 2026 import UUID mappings. Do not re-import the workspace.
- Create new projects/issues/comments and update supported issue fields and
  comment content. Source authors are attribution, not impersonated accounts.
- Only the already-authenticated Plane user's matching active Linear identity
  is assigned natively. No account creation, invitations or Linear changes.
- Same-project parents use native relationships; cross-project parents use links.
  New supported relationships are added, never automatically removed.
- Copy new Linear-hosted non-video files up to 5 MiB and verify their downloaded
  SHA256. Larger files and videos remain links. Never send credentials to an
  arbitrary external attachment host.
- Non-issue comments, project updates, documents and initiatives are preserved
  as clearly labelled work items. This is not native feature parity or continuous
  replication of every historical event, view, milestone or integration setting.
- Source deletions/disappearances retain the destination and generate a review
  warning. Source moves between projects, project archive changes, shared
  state/label metadata changes and completed-cycle changes require review.
  Issue archive dates are supported when their project remains accessible.
- Source changes update only fields changed since the last synchronized baseline.
  Plane-only edits to unrelated fields survive. Conflicts stay pending and are
  retried; they do not disappear when the polling watermark advances.
- Re-read before PATCH and verify afterwards. Plane's API has no conditional
  PATCH/ETag in this deployment: simultaneous edits in the tiny read/write window
  cannot be made fully atomic. Treat Linear as the source of truth for imported
  records; use Plane-only records for independent work.
- An explicit file lock prevents overlap on one shared state directory. Never
  run local and DigitalOcean writers concurrently with separate copies of state.
- Dry runs have no Plane write capability and do not advance checkpoints.
  Diagnostics are local private files. Logs contain counts, not record bodies,
  headers, cookies or tokens.

## First local run

Install dependencies and run the fixture-based integration tests:

```sh
npm ci --prefix tools/linear-sync --ignore-scripts --no-audit --no-fund
npm test --prefix tools/linear-sync
```

Create a private mode-600 env file from `.env.example`. Use the existing private
origin service credentials, **not** the Cloudflare account API token. Keep all
exports, state, credentials and logs outside Git. Prefer a read-scoped Linear key;
successful reads alone do not prove the key's permission scope.

Bootstrap once from the completed import's private export, ledger and independently
verified destination snapshot. This reads files only and refuses existing state:

```sh
node tools/linear-sync/cli.mjs bootstrap --env /private/sync.env \
  --export /private/full-export-2026-09-07 \
  --ledger /private/bulk-ledger.json \
  --destination /private/verified-destination.json
node tools/linear-sync/cli.mjs run --env /private/sync.env
node tools/linear-sync/cli.mjs run --apply --env /private/sync.env
```

Inspect `last-report.json` before enabling writes. A dry run is a preview, not a
frozen approval artifact: apply fetches fresh changes and checks conflicts again.
Exit 0 means successful without conflicts, 2 means pending review items, and 1
means a failed run. `state.json` records mappings, pending work and write intents.
The watermark uses the run start with a five-minute overlap to avoid boundary
loss; source reads must all succeed before any destination writes begin.

## Every five minutes locally (macOS)

After a successful reviewed live run:

```sh
node tools/linear-sync/schedule.mjs install-local /private/sync.env
launchctl print gui/$(id -u)/au.mlai.plane.linear-sync
```

The per-user LaunchAgent runs immediately and every 300 seconds while the Mac
is awake and the user is logged in. launchd does not launch an overlapping
instance; the shared-state lock also protects manual runs. No cloud scheduler or
GitHub Actions minutes are used. Inspect `scheduler.log`, `scheduler-error.log`
and `last-report.json` in the private state directory.

Stop before deploying a cloud writer:

```sh
launchctl bootout gui/$(id -u)/au.mlai.plane.linear-sync
```

Wait for any running sync to finish; inspect `run.lock` and its PID. Do not remove
a lock merely because it is old. After a confirmed process crash, an operator
may remove that exact stale lock and rerun; source IDs and intents reconcile
ambiguous creates. Preserve the state, including pending records and tickets.
An upload whose ticket was lost or expired fails closed for operator recovery;
the sync will not delete or duplicate the remote asset to work around it.

## DigitalOcean: every thirty minutes, not deployed by these files

See `deploy/mlai/sync`. There are no Actions workflows or automatic deploy hooks.
Do not use the application's Compose file to run this process.

1. Stop the local writer and transfer its entire private state directory securely.
2. Build this directory for the Droplet's architecture, publish to
   `ghcr.io/mlai-aus-inc/mlai-plane-linear-sync`, and select an immutable digest.
3. Place `compose.yml` and executable `run.sh` in `/opt/mlai-plane-sync`.
4. Place credentials in `/etc/mlai-plane-sync/sync.env`, mode 600, and
   `PLANE_SYNC_IMAGE=ghcr.io/mlai-aus-inc/mlai-plane-linear-sync@sha256:...` in
   `/etc/mlai-plane-sync/image.env`. There is no reason to provide DO, database,
   SSH or Cloudflare account-admin credentials to the sync container.
5. Place state in `/var/lib/mlai-plane-sync`, directory mode 700, files mode 600,
   owned by container UID 1000. Back it up: losing mappings is not a reason to
   recreate imported records. Pre-pull the immutable image.
6. Run a container dry run first: override the service command with `run`, without
   `--apply`. Verify the report, then perform one apply run.
7. Install the supplied service/timer under `/etc/systemd/system`, reload units,
   and enable `mlai-plane-sync.timer`. This is a separate deployment step requiring
   user authorization; it is not done by local tests.

The timer triggers at minute 00 and 30, catches a missed run after boot, and does
not overlap an active oneshot service. The container is capped at 0.5 CPU/512 MiB,
has a read-only root filesystem and only the sync state volume. Its network is
outbound-only with no published ports or connection to the application's private
Docker network. No migrations or schema changes are needed.

Use `systemctl status mlai-plane-sync.service`, `journalctl -u mlai-plane-sync`,
and the state report for monitoring. External email/Slack alerts are not configured.
Keep scheduler logs rotated by the host; the program retains the latest 96 private
run reports. Avoid copying logs or state into public CI artifacts.
