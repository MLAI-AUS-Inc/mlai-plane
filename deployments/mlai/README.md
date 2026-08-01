# MLAI Plane deployment

This deployment runs the public Plane Community Edition as a separate stateful
application for `admin.mlai.au`. It is based on upstream `v1.4.0` at commit
`917b23a6c16d93fc00cef67900eff2755e8b13f7`. Every container reference is pinned
to an immutable multi-platform manifest digest in `release-manifest.json`.

The Plane proxy binds only to `127.0.0.1`. A Cloudflare Tunnel is the only
intended origin path, and the MLAI edge gateway must filter parent-domain MLAI
cookies before traffic reaches this stack. Do not publish the proxy port on a
public interface.

## Staging

1. Run `scripts/create-env.sh` to create a mode-restricted `.env` with unique
   generated secrets. To manage secrets elsewhere, copy `env.example` and
   replace every `REPLACE_WITH_*` value yourself. Keep
   `COOKIE_DOMAIN` absent, `SESSION_COOKIE_NAME=__Host-plane-session`, and
   `MINIO_ENDPOINT_SSL=1` so direct-upload signatures use the HTTPS gateway.
2. Run `scripts/validate-config.sh`.
3. Start the production-like bundled staging profile:

   ```sh
   docker compose --env-file .env -f compose.yaml --profile bundled up -d
   ```

   For the loopback-only acceptance stack, `scripts/bootstrap-local-smoke.sh`
   creates one disposable administrator and an `MLAI` workspace using an
   in-memory generated password. The script refuses non-loopback targets and an
   already configured instance; it is not production provisioning tooling.

4. Create a dedicated named Cloudflare Tunnel using
   `cloudflared-staging.example.yml`. Its origin-only hostname is
   `plane-origin-staging.mlai.au`, but `originRequest.httpHostHeader` **must** be
   `plane-staging.mlai.au`. Plane v1.4 builds OAuth callbacks and bundled MinIO
   signatures from the request host; forwarding the private origin host would
   bypass or break the public gateway path. The proxy remains
   `http://127.0.0.1:8080` and the origin hostname must never be exposed directly.
5. Run the gateway test suite and then `scripts/smoke.sh` against the gateway
   hostname. The smoke script requires a least-privilege Cloudflare Access
   service token via mode-restricted files, not secret environment values:

   ```sh
   CF_ACCESS_CLIENT_ID_FILE=/secure/plane-smoke-client-id \
   CF_ACCESS_CLIENT_SECRET_FILE=/secure/plane-smoke-client-secret \
     scripts/smoke.sh https://plane-staging.mlai.au
   ```

The `instance-bootstrap` one-shot service runs after migrations and before the
API/workers. It pre-registers the instance with telemetry disabled, preventing
upstream's first-registration task from winning the settings race. Keep
`PLANE_TELEMETRY_ENABLED=0` unless MLAI explicitly approves sending instance
metrics upstream; changing it requires a privacy review and a stack restart.

Staging defaults are invite-only: public signup and magic-link login are off,
email/password login remains available, and ordinary users cannot create extra
workspaces. Configure Google OAuth and SMTP through God Mode only after their
credentials and edge callbacks have been reviewed.

Do not use Plane's first-run God Mode form: upstream `v1.4.0` visually defaults
telemetry on and can overwrite the pre-bootstrap setting. After the public
gateway and Access policy are ready, create a temporary least-privilege Access
Service Auth policy for an initial-setup service token. An approved operator must
then run `scripts/bootstrap-initial-admin.sh` interactively with the token values
in mode-restricted files. The script prompts for the administrator password
twice with terminal echo disabled; neither the password nor Access secret is put
in argv or an environment value. It is restricted to MLAI's two approved Plane
hostnames, forces telemetry off, validates host-only secure admin cookies,
creates the `MLAI` workspace, and asserts the full runtime authentication policy.
Revoke the one-time setup service token and remove its Service Auth policy as
soon as setup passes. The administrator email and password are deployment inputs
and are not stored in this repository.

```sh
CF_ACCESS_CLIENT_ID_FILE=/secure/plane-setup-client-id \
CF_ACCESS_CLIENT_SECRET_FILE=/secure/plane-setup-client-secret \
CONFIRM_PLANE_INITIAL_SETUP=configure \
  scripts/bootstrap-initial-admin.sh https://plane-staging.mlai.au admin@example.org
```

If administrator creation succeeds but workspace creation fails, correct the
cause and rerun the same command with
`CONFIRM_PLANE_INITIAL_SETUP=resume`. Resume mode requires setup to be complete,
authenticates the named administrator, and creates the `mlai` workspace only if
it is absent. It cannot create or replace an administrator.

God Mode can later change telemetry, signup, workspace creation, magic login, and
email/password login. Treat any drift as a release-blocking policy violation:
restrict God Mode access, run `scripts/smoke.sh` after every change and deploy,
and alert on a failed assertion. The safe environment values are reconciled at
stack restart; they are not continuous enforcement while the stack is running.

The bundled profile includes PostgreSQL, Valkey, RabbitMQ, and MinIO. It exists
for staging and isolated restore drills, not as the final production durability
model.

## Production

Production must use dedicated durable services in Australia where available:

- PostgreSQL 15.7+ or 16 with point-in-time recovery;
- monitored Valkey/Redis;
- durable RabbitMQ;
- versioned S3-compatible object storage;
- a dedicated Plane host sized initially at 4 vCPU and 8 GB RAM;
- Cloudflare Tunnel using `cloudflared-production.example.yml`, with the exact
  `plane-origin.mlai.au` to `admin.mlai.au` Host rewrite;
- Cloudflare Access, WAF, rate limiting, and the cookie-filtering gateway.

Set `USE_MINIO=0` and replace `DATABASE_URL`, `REDIS_URL`, `AMQP_URL`, and the
AWS/S3 settings with secret-managed production values. Start without the
`bundled` profile. Do not put production secrets in this repository.

## Required identity boundary

The API settings support `SESSION_COOKIE_NAME=__Host-plane-session`. Because
`WEB_URL` is HTTPS and `COOKIE_DOMAIN` is absent, the session cookie is Secure,
host-only, and scoped to `/`. Plane's fixed `admin-session-id` cookie is also
expected to remain host-only.

The edge gateway must remove at least `access_token`, `refresh_token`, and
`sessionid` from every incoming request. It must reject any response cookie that
tries to set `Domain=mlai.au` or `Domain=.mlai.au`. Raw Cookie, Authorization,
OAuth code, API key, and webhook secret values must never be logged.

## Backups and restores

`scripts/backup-bundled.sh` and `scripts/restore-bundled.sh` support only the
bundled staging profile. Backup uses a private umask and briefly stops the public
proxy as well as API, worker, scheduler, and live services so neither API writes
nor previously issued direct uploads can mutate the database/object snapshot.
Cleanup attempts to restart services even if backup fails, and a failed restart
makes the backup command fail rather than printing success.

Restore is deliberately confirmation-gated. Before changing configured data it
validates the current config, requires an exact release-manifest match, and asks
`pg_restore` to parse the dump. It then stops writers, replaces the database and
uploads, purges later-timeline RabbitMQ tasks and Valkey cache state, and
restarts the application services. A failure after replacement begins leaves a
conspicuous non-zero exit and may leave writers stopped; investigate instead of
blindly restarting. The proxy remains stopped on a partial restore, preventing
direct object writes into a mixed timeline. Run smoke tests immediately afterwards.

## Administrator break-glass recovery

Until SMTP password recovery has been proven, a second operator can reset the
known administrator password from the private Plane host. Keep the public gateway
in maintenance mode while doing this, verify the exact Compose project and email,
and run the upstream interactive command (the password is prompted twice and is
never an argument):

```sh
docker compose --env-file .env -f compose.yaml exec api \
  python manage.py reset_password admin@example.org
```

Record the recovery in the change log, sign in through the public gateway,
rotate any temporary Access token, and rerun `scripts/smoke.sh`. If the API
container is unavailable or the database is not healthy, stop and restore the
service first; do not edit password hashes directly.

The dated local restore-drill evidence is recorded in
`docs/mlai-local-acceptance-2026-08-01.md`.

If the disposable local bootstrap stops after creating its administrator,
inspect the API/worker logs and discard that exact disposable Compose project
before rerunning from empty volumes. The script intentionally refuses to mutate
an already configured instance and is not recovery tooling.

Production backup policy is external to the containers: PostgreSQL PITR plus
encrypted dumps, object versioning, off-site copies, daily verification, and a
quarterly isolated restore drill. A successful drill must prove both work-item
data and attachments.

## Release and source

The corresponding source is the public repository revision used to deploy the
service. Upstream changes are fetched from `https://github.com/makeplane/plane`;
production releases advance only after configuration, migration, backup/restore,
gateway, and browser acceptance tests pass. Never deploy mutable `preview`,
`latest`, or `stable` tags.
