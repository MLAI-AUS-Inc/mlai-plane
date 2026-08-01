# Network source availability

Plane Community Edition is licensed under AGPL-3.0. MLAI's deployed Community
service must make the corresponding source for its running program available to
network users at no charge when MLAI deploys a modified version.

For the initial `v1.4.0` pilot, application containers are unmodified upstream
images pinned in `deployments/mlai/release-manifest.json`. MLAI-specific
deployment and operational files live in this public fork.

The production gateway requires `PLANE_SOURCE_URL` to be a public exact-commit
URL of this form:

`https://github.com/MLAI-AUS-Inc/mlai-plane/tree/<deployed-commit>`

Plane mode fails closed unless that value is an HTTPS GitHub URL for this fork
with a 40-character commit. The gateway publishes it as `Link: ...;
rel="source"` on every Plane response and as a JSON disclosure at
`/.well-known/mlai-source`. Both must be verified from a non-administrator
browser after every release.

For every release, maintainers must:

1. record the upstream tag and commit;
2. record all OCI image digests;
3. tag the exact corresponding-source revision in this fork;
4. include build instructions, dependency lockfiles, migrations, and MLAI
   modifications needed to create the running version;
5. exclude secrets, database contents, uploads, and private infrastructure state;
6. verify the Source link from a non-administrator browser session; and
7. obtain legal review before incorporating Plane Commercial code or distributing
   a build under terms other than the Community source license.

This document records an implementation process, not legal advice.
