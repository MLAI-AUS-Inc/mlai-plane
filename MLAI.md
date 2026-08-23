# MLAI Plane fork guide

This repository is MLAI's fork of the upstream
[`makeplane/plane`](https://github.com/makeplane/plane) project. It supplies the
Plane application behind MLAI's private `admin.mlai.au` deployment.

For the complete platform map, start with
[`mlai-engineering`](https://github.com/MLAI-AUS-Inc/mlai-engineering). This
document records only the MLAI-specific boundary around Plane.

## Repository relationship

| Repository | Responsibility |
| --- | --- |
| `mlai-plane` | Forked Plane application and deployment baseline |
| `mlai-plane-edge` | Cloudflare Worker at `admin.mlai.au`; isolates cookies and routes to the private Plane origin |
| `mlai-au` | Public site and MLAI browser applications; not the Plane host |
| `mlai-backend` | MLAI API; does not grant `admin.mlai.au` browser-cookie authority |

`mlai-plane-edge` is not part of this monorepo. Changes to public hostnames,
cookies, OAuth redirects, framing, origin routing, or source-version headers may
require coordinated documentation and review in both repositories.

## Trust boundary

The browser reaches Plane through `mlai-plane-edge`. The edge gateway removes
MLAI parent-domain authentication cookies before proxying requests, keeps Plane
cookies host-local, and authenticates separately to the private origin.

Do not:

- make Plane depend on MLAI website session cookies;
- add `admin.mlai.au` as a credentialed origin of `mlai-backend`;
- weaken the edge gateway's cookie, header, framing, or origin isolation;
- assume a direct local Plane deployment reproduces the production edge trust
  boundary.

The detailed and current gateway invariants live in the
[`mlai-plane-edge` README](https://github.com/MLAI-AUS-Inc/mlai-plane-edge)
and its `RUNBOOK.md`.

## Branch and upstream workflow

This checkout uses `preview` as its default MLAI branch. Do not assume an
upstream document's `main` or `master` branch names apply to the fork. Before
starting work:

1. Confirm whether the change belongs in MLAI's fork, upstream Plane, or both.
2. Branch from the MLAI base branch specified for the task.
3. Keep MLAI-specific deployment changes isolated and easy to identify during
   upstream synchronization.
4. Open the pull request in the intended repository; an upstream issue or link
   does not imply an upstream contribution.

The exact upstream synchronization and release schedule is operational state.
Confirm it with the repository maintainer rather than inferring it from old
merge commits.

## Local development

Follow [`CONTRIBUTING.md`](CONTRIBUTING.md) for Plane's toolchain and monorepo
commands. The repository includes Django, React applications, shared packages,
PostgreSQL, and Redis.

> **Migration approval required:** never create, run, or apply a database
> migration without explicit approval for that specific migration. The current
> `setup.sh` prepares environment files and dependencies, while
> `docker-compose-local.yml` includes a dedicated migrator service. Inspect and
> approve its exact migration plan before starting the Compose stack.

The standard code-quality commands are listed in [`AGENTS.md`](AGENTS.md). For
documentation-only changes, do not start the application stack merely to
validate Markdown.

## Change-routing guide

| Change | Start in |
| --- | --- |
| Plane product behavior | `mlai-plane`, then assess whether it belongs upstream |
| Plane container or application configuration | `mlai-plane` |
| Public `admin.mlai.au` proxy behavior | `mlai-plane-edge` |
| MLAI website behavior | `mlai-au` |
| MLAI API behavior or CORS policy | `mlai-backend` |

When a change crosses repositories, document the dependency in both pull
requests and update the central system map if ownership or a trust boundary has
changed.
