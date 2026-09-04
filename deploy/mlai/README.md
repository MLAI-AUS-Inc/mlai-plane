# MLAI Plane deployment

This profile builds MLAI's Plane fork into immutable GHCR images and runs it on
a DigitalOcean Droplet behind the existing `mlai-plane-edge` Cloudflare Worker
and a named Cloudflare Tunnel. It does not expose Plane directly on ports 80 or
443.

## Ownership boundary

| Concern | Owner |
| --- | --- |
| Plane application images and DigitalOcean origin | `mlai-plane` |
| `admin.mlai.au` gateway, cookie isolation and legacy rollback | `mlai-plane-edge` |
| Cloudflare DNS, Access policy and public route cutover | Cloudflare operator following the edge runbook |

The intended staging path is:

```text
Browser
  -> plane-staging.mlai.au
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

- Terraform validation runs automatically, but Terraform plan/apply is manual.
- The `staging-infrastructure` and `production-infrastructure` GitHub
  environments must require reviewers before `apply` is enabled.
- Normal `run.sh deploy` excludes the Compose `migration` profile.
- Deployment waits for the API container's health endpoint and fails closed if
  the backend cannot start, including when migrations are pending.
- No workflow currently applies a database migration.
- `run.sh migration-plan` hashes the immutable backend image, database volume
  and PostgreSQL system identities, database name/user, and exact pending plan.
  `run.sh migrate` refuses to run unless the operator argument and protected
  environment value both match that hash, then consumes the approval
  immediately before its single execution attempt. This guard is supplemental:
  an operator still needs explicit approval for the exact plan and target
  database.
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

Create GitHub environments named `staging-infrastructure-plan` and
`production-infrastructure-plan` for Terraform planning. Create protected
`staging-infrastructure` and `production-infrastructure` environments for
applying the resulting checksummed plan, plus `staging-deployment` and
`production-deployment` for host rollout. Apply and deployment environments
must require reviewers.

Both the infrastructure plan and apply environments need:

Secrets:

- `DIGITALOCEAN_TOKEN`: a new, scoped token; never reuse a developer token.
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

Bootstrap the private state bucket and its restricted credentials once outside
this state. Afterward, use the **Plan or apply MLAI Plane infrastructure**
workflow. Always run `plan` first and inspect it; `apply` is an external,
billable change and requires explicit approval.

## Images

The **Build MLAI Plane images** workflow builds six `linux/amd64` images and
publishes commit tags under `ghcr.io/mlai-aus-inc`. Deployment automation must
resolve each commit tag to its registry digest and render those digests into the
protected host `.env`; mutable tags are not accepted by `run.sh`.

## Tunnel configuration

Use a named, dashboard-configured Tunnel. Store only its scoped token in the
host `.env`. For staging, configure the private origin hostname to target
`http://proxy:80` and set `originRequest.httpHostHeader` to
`plane-staging.mlai.au`. Production must set it to `admin.mlai.au`. Include a
final `http_status:404` rule and keep direct Droplet web ingress closed.

The Cloudflare Worker configuration, Access policy, DNS route and traffic
cutover remain separate operations in `mlai-plane-edge`; this repository must
not attempt to manage the same Worker with Terraform and Wrangler.

## Remaining rollout work

Before staging can be deployed:

1. Rotate the plaintext DigitalOcean token previously found in the workspace.
2. Bootstrap the remote Terraform-state bucket and protected GitHub environments.
3. Review the exact initial database migration plan and obtain explicit approval
   before initializing the staging database.
4. Configure the named staging Tunnel and update `mlai-plane-edge` staging only.
5. Test authentication, uploads, cookies, redirects and WebSockets end to end.
