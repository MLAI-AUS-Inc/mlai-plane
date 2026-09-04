# MLAI deployment instructions

- Never create, run, or apply a database migration without explicit user
  approval for the exact migration plan and target database.
- Treat Compose startup as migration-capable unless the selected services and
  profiles prove the `migrator` service cannot run.
- Never run `terraform apply`, deploy to DigitalOcean, publish an image, change
  Cloudflare configuration, or cut over traffic unless the user explicitly
  requests that external action.
- Keep production secrets in protected GitHub environments. Do not commit
  rendered `.env` files, Terraform backend credentials, tunnel tokens, SSH
  private keys, or database credentials.
- Deploy application images by immutable digest. Mutable tags are only for
  locating a candidate digest and are not valid production configuration.

