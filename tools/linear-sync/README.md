# MLAI Linear ↔ Plane sync

This is a separate Node 22 process, not a Plane plugin or database migration.
Linear writes are opt-in with a separate credential. The source organization, Plane workspace,
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

## Recovery check (29 September 2026)

- The local five-minute LaunchAgent had stopped syncing on 10 September because
  a stale lock remained after its process exited. The lock owner was confirmed
  absent, the checkpoint was backed up, and the lock was cleared.
- A full live reconciliation applied the backlog. The resulting checkpoint had
  zero pending records and five review warnings for source records missing or no
  longer visible in Linear; their Plane copies were retained.
- Plane's direct detail route returns 404 for archived work items. The sync now
  verifies them through their imported external identity. Its regression test
  covers creation and subsequent updates of an archived issue.
- The local LaunchAgent was restarted and its first automatic run completed
  with zero writes, conflicts, or pending records. The DigitalOcean thirty-minute
  timer was not yet deployed at this check.

## DigitalOcean cutover (29 September 2026)

- Stopped the local LaunchAgent after a successful run and transferred its
  checkpoint to the Plane staging Droplet. Keep the local writer stopped while
  the cloud timer is enabled; separate checkpoint copies must not write together.
- Built the tested sync code on the x86_64 Droplet. The deployed image is pinned
  by its local SHA-256 image ID in `/etc/mlai-plane-sync/image.env`; `run.sh`
  accepts that form as well as a GHCR repository digest. Keep the image present
  on the host, since a local ID cannot be pulled after image pruning.
- The cloud dry run found three new records and no conflicts. Its first apply
  created those three and left zero pending. The thirty-minute systemd timer is
  enabled at minute 00 and 30. Verify subsequent runs with `systemctl status
  mlai-plane-sync.service` and the private `last-report.json`.

## Plane → Linear writeback (opt-in)

`ENABLE_LINEAR_WRITEBACK=true` enables writes from Plane to Linear on the same
thirty-minute run. Set a separate `LINEAR_WRITE_API_KEY` in the private runtime
environment before using `--apply`; the existing `LINEAR_API_KEY` remains
read-only. Leave the flag unset to keep the deployed one-way behavior.

The first enabled apply records the current Plane issue baseline and makes no
Linear changes. Later runs create new Plane work items in **mapped Linear
projects**, and synchronize changes to title, description, status, priority,
due date, labels, assignee, and issue comments. New Plane projects, attachments,
cycles, parent changes, archive changes, and deletes are not written to Linear.
For projects linked to several Linear teams, new issues use the MLAI Tech team
when present; if the status or label cannot be mapped uniquely, the issue is
left as a conflict for review.

Writes use the Plane UUID as the Linear issue/comment UUID so an uncertain
response can be checked before retrying. The sync re-reads both records before
updating and stops if the same field changed in both systems. The first baseline
excludes older Plane edits from writeback. The separate write key acts as its
owner in Linear; the sync does not impersonate volunteer accounts.

Before enabling it on the cloud host, back up the live checkpoint, run a dry
run with the flag enabled, and inspect the private report. Then supply the
write key and run an apply once to establish the baseline. Do not start a
second writer from a copy of the checkpoint. No database migration is needed.

## Scope and safety

- Poll changed projects, issues, comments, attachment records, cycles, documents,
  initiatives and project updates. Read the small identity/state/label/relation
  collections in full. Reconcile all supported source collections daily.
- Reuse the September 2026 import UUID mappings. Do not re-import the workspace.
- Create new projects/issues/comments and update supported issue fields and
  comment content. Source authors are attribution, not impersonated accounts.
- Only the already-authenticated Plane user's matching active Linear identity
  is assigned natively. No account creation or invitations.
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
  cannot be made fully atomic. Conflicting edits to the same supported field require review.
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

## DigitalOcean: every thirty minutes

See `deploy/mlai/sync`. There are no Actions workflows or automatic deploy hooks.
Do not use the application's Compose file to run this process.

1. Stop the local writer and transfer its entire private state directory securely.
2. Build this directory for the Droplet's architecture. Publish to
   `ghcr.io/mlai-aus-inc/mlai-plane-linear-sync` and select an immutable
   repository digest, or build directly on the Droplet and pin the complete
   local `sha256:` image ID. A locally built image must be retained on the host.
3. Place `compose.yml` and executable `run.sh` in `/opt/mlai-plane-sync`.
4. Place credentials in `/etc/mlai-plane-sync/sync.env`, mode 600, and the
   selected immutable image reference in `/etc/mlai-plane-sync/image.env` as
   `PLANE_SYNC_IMAGE=...`. There is no reason to provide DO, database,
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
