# ADR 0002: `admin.mlai.au` cookie and identity boundary

- Status: Accepted
- Date: 1 August 2026
- Security gate: automated gateway tests plus origin canary required

## Context

MLAI's Django service currently creates `access_token`, `refresh_token`, and
`sessionid` cookies for the parent `.mlai.au` domain. A browser will send those
credentials to every matching subdomain, including a third-party-derived Plane
service at `admin.mlai.au`. A parent-domain cookie cannot exclude one subdomain.

The existing `app=admin` magic-link handoff is not a valid Plane SSO protocol and
is currently rejected by the public site's login allowlist. Plane Community's
Google login also does not enforce a Google Workspace domain by itself.

## Decision

1. Put an MLAI-owned Cloudflare Worker Route in front of a private Tunnel origin.
2. Remove incoming cookies named exactly `access_token`, `refresh_token`, and
   `sessionid`, plus any future MLAI parent-domain authentication cookie, before
   forwarding to Plane.
3. Keep Plane's `COOKIE_DOMAIN` unset and configure its supported main session
   name as `__Host-plane-session`.
4. Reject Plane response cookies with `Domain=mlai.au` or `Domain=.mlai.au`.
5. Never log raw Cookie, Authorization, OAuth code, API key, or webhook secret
   values.
6. Preserve WebSocket upgrades, streaming, redirects, uploads, downloads, and
   multiple `Set-Cookie` headers through the gateway.
7. Use Cloudflare Access as an outer staff allowlist/MFA gate and Plane-native
   invite-only authentication for the Community pilot.
8. Do not make Plane trust MLAI JWT cookies or directly share application user
   databases.
9. Use supported OIDC/SAML only after selecting an eligible Plane tier or a
   shared identity platform.
10. Treat migration of MLAI authentication to host-only `__Host-*` cookies and a
    same-origin BFF as the preferred long-term simplification.

## Required evidence before production

- Unit and integration tests show all denylisted cookies are absent at origin.
- A canary request with all MLAI and Plane cookie names preserves only the Plane
  session/flow cookies.
- OAuth callback and logout work through the edge.
- A live `101` WebSocket handshake succeeds.
- No response sets a parent-domain cookie.
- An unauthorised and a deactivated staff identity are denied.
- A gateway mode flip restores the legacy admin Worker without DNS changes.
