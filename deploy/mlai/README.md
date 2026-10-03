# MLAI Plane deployment

This profile builds MLAI's Plane fork into immutable GHCR images and runs it on
a DigitalOcean Droplet behind the existing `mlai-plane-edge` Cloudflare Worker
and a named Cloudflare Tunnel. It does not expose Plane directly on ports 80 or
443.

The [August v1.4 local rehearsal](../../docs/mlai-v1.4-local-rehearsal-2026-08-01.md)
is retained as a dated historical record. Use this profile for current operations.

## Ownership boundary

| Concern | Owner |
| --- | --- |
| Plane application images and DigitalOcean origin | `mlai-plane` |
| `admin.mlai.au` gateway, cookie isolation and legacy rollback | `mlai-plane-edge` |
| Cloudflare DNS, Access policy and public route cutover | Cloudflare operator following the edge runbook |

The intended staging path is:

```text
Browser
  -> plane.mlai.au
  -> mlai-plane-edge-staging Worker
  -> plane-origin-staging.mlai.au
  -> named Cloudflare Tunnel
  -> cloudflared on the Plane Droplet
  -> proxy:80 on the private Compose network
```

Production replaces the two staging hostnames with `admin.mlai.au` and
`plane-origin.mlai.au`. Do not cut over production until the edge repository's
readiness gates pass.

## Safety model

- Terraform 1.12.2 is required locally and pinned in validation, plan and apply.
- Each environment creates its own DigitalOcean project (`mlai-plane-staging`
  or `mlai-plane-production`) and assigns only its Plane Droplet to that project.
  The existing default project is not changed.
- Each firewall attaches by its own Droplet ID, never by the shared application
  tag. Staging and production cannot inherit each other's firewall rules.
- Terraform validation runs automatically, but Terraform plan/apply is manual.
- The `staging-infrastructure` and `production-infrastructure` GitHub
  environments must require reviewers before `apply` is enabled.
- Normal `run.sh deploy` excludes the Compose `migration` profile.
- Deployment waits for the API container's health endpoint and fails closed if
  the backend cannot start, including when migrations are pending.
- No workflow currently applies a database migration.
- `run.sh migration-plan` hashes the immutable backend image, effective Compose
  configuration, database volume and PostgreSQL system identities, database
  name/user, and exact pending plan. `run.sh migrate` refuses to run unless the
  operator argument and protected environment value both match that hash, then
  consumes the approval immediately before its single execution attempt.
- Deployments and migration operations share an exclusive host lock. Migration
  execution additionally uses private captured copies of the approved `.env`
  and Compose definition, preventing a concurrent rollout from swapping the
  image or target between validation and execution.
- These guards are supplemental: an operator still needs explicit approval for
  the exact plan and target database.
- Application images must use full immutable `sha256` digests.
- The DigitalOcean firewall accepts SSH only. Plane traffic enters through the
  outbound-only Tunnel.

## Local validation

These commands do not create infrastructure, start services or run migrations:

```sh
cp deploy/mlai/.env.example /tmp/mlai-plane.env
docker compose --env-file /tmp/mlai-plane.env -f deploy/mlai/compose.yml config --quiet
terraform -chdir=deploy/mlai/terraform init -backend=false
terraform -chdir=deploy/mlai/terraform validate
terraform -chdir=deploy/mlai/terraform test
```

The example image digests are deliberately invalid for deployment. CI validates
the Compose shape directly with the example file; `run.sh` rejects the sentinel
digests before any operational command.

## Migration approval protocol

On the target host, `./run.sh migration-plan` prints the target snapshot and its
`MIGRATION_APPROVAL_SHA256`. Obtain explicit approval for that complete output.
Only after approval, store that exact hash as `PLANE_MIGRATION_APPROVAL` in the
protected host `.env` and invoke `./run.sh migrate <approved-plan-sha256>` with
the same value. The command recomputes the snapshot and fails if the image,
database cluster, target settings, or pending plan changed. It clears the stored
hash before its one permitted execution attempt, including when that attempt
subsequently fails. Generate and explicitly approve a new plan before retrying.

## GitHub configuration

Create a main-only `image-publishing` GitHub environment. Create environments
named `staging-infrastructure-plan` and
`production-infrastructure-plan` for Terraform planning. Create protected
`staging-infrastructure` and `production-infrastructure` environments for
applying the resulting checksummed plan, plus `staging-deployment` and
`production-deployment` for host rollout. Apply and deployment environments
must require reviewers. Every environment named above must use a custom
deployment branch policy that permits only `main`; both workflow entry jobs
also reject every non-`main` ref before they can receive environment secrets.

Both the infrastructure plan and apply environments need:

Secrets:

- `DIGITALOCEAN_TOKEN`: a new, scoped token; never reuse a developer token.
  It is exposed only through the provider's ambient environment variable so it
  is not serialized into saved Terraform plans.
- `TF_STATE_ACCESS_KEY_ID` and `TF_STATE_SECRET_ACCESS_KEY`: credentials limited
  to the private Terraform-state bucket.

Variables:

- `TF_STATE_BUCKET`
- `TF_STATE_ENDPOINT`, for example `https://syd1.digitaloceanspaces.com`
- `TF_STATE_REGION`, normally `syd1`
- `TF_SSH_KEY_FINGERPRINTS`, a JSON list of DigitalOcean key fingerprints
- `TF_SSH_SOURCE_CIDRS`, a JSON list of approved SSH CIDRs
- `TF_ALLOW_PUBLIC_SSH`, a JSON boolean
- `TF_DROPLET_SIZE`, initially `s-4vcpu-8gb`

The deployment environments need these secrets:

- `PLANE_SSH_KEY`
- `PLANE_SECRET_KEY` and `PLANE_LIVE_SERVER_SECRET_KEY`
- `PLANE_POSTGRES_PASSWORD` and `PLANE_RABBITMQ_PASSWORD`
- `PLANE_MINIO_ACCESS_KEY` and `PLANE_MINIO_SECRET_KEY`
- `PLANE_CLOUDFLARE_TUNNEL_TOKEN`

They also need `PLANE_HOST`, `PLANE_SSH_HOST_KEY`, and `PLANE_APP_DOMAIN`
variables. The SSH host key must be a pre-recorded Ed25519 `known_hosts` line;
the workflow deliberately never trusts `ssh-keyscan` during deployment.

### Staging deployment SSH through Cloudflare Access

Staging uses `plane-ssh-staging.mlai.au` as a Cloudflare Access-protected
transport, while `PLANE_HOST` and `PLANE_SSH_HOST_KEY` retain the verified
Droplet IP and its Ed25519 key. SSH, scp, and rsync all use the same proxy.
The staging job fails if Access credentials or the expected hostname are missing;
it does not fall back to public SSH. Production's existing transport is unchanged.

One-time bootstrap (separate from the application tunnel):

1. Create a dedicated remotely managed tunnel named `mlai-plane-staging-ssh`.
   Its only ingress is `plane-ssh-staging.mlai.au` -> `ssh://127.0.0.1:22`,
   followed by `http_status:404`.
2. Create a self-hosted Access application for that exact hostname, with a
   **Service Auth** policy including only a dedicated GitHub staging service
   token. Do not use an Allow, Bypass, Everyone, or all-service-tokens policy.
3. Only after the Access policy exists, create the proxied CNAME to the SSH
   tunnel's `<UUID>.cfargotunnel.com`. No Plane web DNS or Worker cutover is
   part of this operation.
4. Install a checksum-verified cloudflared binary as a separate systemd service
   on the staging Droplet. Keep its tunnel token in a root-only file and use
   `tunnel --no-autoupdate run --token-file <path>`. It must be independent of
   Compose so first deployment and recovery do not depend on Plane being up.
5. In `staging-deployment` only, set `PLANE_SSH_ACCESS_HOST` to
   `plane-ssh-staging.mlai.au` and secrets `PLANE_SSH_ACCESS_CLIENT_ID` and
   `PLANE_SSH_ACCESS_CLIENT_SECRET`. These are Access service credentials,
   not an account API token or the application tunnel token.
6. Verify an unauthenticated connection is denied and authenticated SSH works
   with the existing pinned host key before dispatching a deployment.

The runner uses cloudflared 2026.8.1 with an embedded SHA-256 checksum. Review
and update both when upgrading. Rotate the Access token before its expiry and
update both GitHub secrets together. No account-wide Cloudflare API credential
is needed in GitHub. The DigitalOcean firewall remains workstation-restricted.

Bootstrap the private state bucket and its restricted credentials once outside
this state. Afterward, use the **Plan or apply MLAI Plane infrastructure**
workflow. Always run `plan` first and inspect it; `apply` is an external,
billable change and requires explicit approval.

## Images

The **Build MLAI Plane images** workflow validates six `linux/amd64` images on
pull requests without package-write permission. Only a push to `main`, through
the main-only `image-publishing` environment, publishes commit tags under
`ghcr.io/mlai-aus-inc`; manual dispatch is not enabled. Deployment automation
hashes the registry's raw top-level manifest to resolve each tag to its content
digest and renders those digests into the protected host `.env`; mutable tags
are not accepted by `run.sh`.

## Tunnel configuration

Use a named, dashboard-configured Tunnel. Store only its scoped token in the
host `.env`. For staging, configure the private origin hostname to target
`http://proxy:80` and set `originRequest.httpHostHeader` to
`plane.mlai.au`. Production must set it to `admin.mlai.au`. Include a
final `http_status:404` rule and keep direct Droplet web ingress closed.

The Cloudflare Worker configuration, Access policy, DNS route and traffic
cutover remain separate operations in `mlai-plane-edge`; this repository must
not attempt to manage the same Worker with Terraform and Wrangler.

### Canonical hostname (8 September 2026)

The existing staging infrastructure now serves `https://plane.mlai.au`.
This is a hostname change, not a promotion to the separate production stack.
`plane-staging.mlai.au` redirects to the canonical hostname with paths and query
strings preserved. Both hostnames retain the same Cloudflare Access policy.
The private origin and SSH hostnames remain unchanged.

Set `PLANE_APP_DOMAIN=plane.mlai.au` in GitHub's `staging-deployment` environment.
Keep `APP_DOMAIN`, `WEB_URL`, `CORS_ALLOWED_ORIGINS` and the tunnel's origin Host
header aligned. The deploy validator also permits the former hostname for an
explicit rollback. Do not remove the old redirect: imported historical links may
still reference it. No migration or data rewrite is needed for this change.

## Cloudflare outbound email

Plane creates workspace invitations before the background worker sends email.
A working invitation URL therefore does not prove that a message was sent. The
MLAI deployment can use Cloudflare Email Sending over HTTPS so it does not
depend on DigitalOcean's default-blocked SMTP ports. This is an opt-in Django
email backend shared by the existing invitation, password-reset, notification,
and test-email paths; no SMTP relay or database migration is needed.

Prerequisites:

1. Enable Email Sending on the MLAI Workers Paid account and onboard the sender
   domain. For the existing staging stack, use `plane.mlai.au` and
   `no-reply@plane.mlai.au`. Verify its Cloudflare-managed SPF, DKIM, bounce MX,
   and DMARC records. Do not replace MLAI's root-domain mailbox MX records.
2. Create a dedicated token scoped to the MLAI account with **Email Sending:
   Edit**. Do not install a broad operator or DNS-management token in Plane.
3. In the protected `staging-deployment` GitHub environment, add secret
   `PLANE_CLOUDFLARE_EMAIL_API_TOKEN` and set these variables:

   | Variable | Value |
   | --- | --- |
   | `PLANE_EMAIL_BACKEND` | `plane.utils.cloudflare_email.EmailBackend` |
   | `PLANE_CLOUDFLARE_EMAIL_ACCOUNT_ID` | The MLAI account's 32-character ID |
   | `PLANE_CLOUDFLARE_EMAIL_FROM` | `no-reply@plane.mlai.au` |

The deployment workflow renders these into the root-only host `.env` and
passes them to the API and background workers. It refuses missing or malformed
Cloudflare settings and releases that predate this backend. Existing deployments
default to SMTP until the backend variable is explicitly set. Credentials are
never written to Plane's database or returned by the public instance endpoint.
With this backend selected, the instance's legacy `is_smtp_configured` flag
reports whether the Cloudflare configuration is complete. Saved instance-admin
SMTP settings are ignored; manage this provider through the protected deployment
environment, including the From address.

After merging and publishing images for the merged commit, dispatch **Deploy
MLAI Plane without migrations** from `main` with `environment=staging` and the
full published commit SHA. Supply the optional `test_email` input only when an
operator has approved sending one test message to that address. The job uses
the existing GitHub-only SSH tunnel, retains the pinned host key, and executes
`run.sh test-email <recipient>` inside the running worker after deployment. It
does not open public SSH or start a migrator. Test-email failures return a nonzero
exit code and fail the workflow; they do not automatically roll back deployment.

Verify `/api/instances/` reports `config.is_smtp_configured=true`, inspect the
test message in the recipient's inbox and Cloudflare's delivery log, then resend
the previously failed invitations. A successful command means Cloudflare
accepted or queued the message, not that the recipient's inbox received it.
No invitations are automatically resent during deployment.

The backend sends Plane's MIME message through the fixed Cloudflare HTTPS
endpoint, including attachments and all envelope recipients while omitting Bcc
from visible headers. It uses the configured verified sender for both the
envelope and From header. It rejects provider errors, suppressed recipients,
permanent bounces, incomplete delivery results, redirects, and timeouts. It does
not automatically retry ambiguous failures, which could duplicate invitations;
inspect Cloudflare's logs before resending. Error messages exclude credentials,
recipients, message bodies, and raw provider responses.

For rollback, restore `PLANE_EMAIL_BACKEND` to
`django.core.mail.backends.smtp.EmailBackend` and redeploy the reviewed release.
The renderer then omits the Cloudflare credentials. SMTP must be configured and
reachable separately; reverting to the previous unconfigured state will stop
email delivery again.

Local checks (mocked HTTP, no service startup or migrations):

```sh
# Use an isolated Python environment with the project's pinned Django and requests.
python deploy/mlai/test-cloudflare-email.py
python deploy/mlai/test-email-deployment.py
python deploy/mlai/validate-secret-templates.py
docker compose --env-file deploy/mlai/.env.example -f deploy/mlai/compose.yml config --quiet
```

References: [Cloudflare raw email API](https://developers.cloudflare.com/api/resources/email_sending/methods/send_raw/),
[sender-domain setup](https://developers.cloudflare.com/email-service/get-started/send-emails/),
[DigitalOcean SMTP restrictions](https://docs.digitalocean.com/support/why-is-smtp-blocked/).

## Remaining rollout work

Before staging can be deployed:

1. Rotate the plaintext DigitalOcean token previously found in the workspace.
2. Bootstrap the remote Terraform-state bucket and protected GitHub environments.
3. Review the exact initial database migration plan and obtain explicit approval
   before initializing the staging database.
4. Configure the named staging Tunnel and update `mlai-plane-edge` staging only.
5. Test authentication, uploads, cookies, redirects and WebSockets end to end.
