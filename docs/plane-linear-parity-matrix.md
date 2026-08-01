# Plane–Linear functional parity matrix

- Baseline date: 1 August 2026
- Linear reference: documented product behaviour on the baseline date
- Plane reference: Community `v1.4.0` unless a paid tier is named
- Matrix status: classified baseline; acceptance execution in progress

This matrix defines the programme scope. It does not claim that classified or
planned work is complete. `P0` is required for the private pilot, `P1` for the
first production workflow, `P2` for broad parity, and `P3` for long-tail parity.

Implementation classes:

- **A** — Plane Community configuration or verified native behaviour
- **B** — Plane Commercial tier
- **C** — custom AGPL-compatible Plane development
- **D** — external MLAI service, Plane App, API, or webhook integration
- **E** — explicitly approved difference or deferral

Owners are role owners until named people accept the work. Evidence is recorded
as a test/report/issue link; `Pending` is deliberately not evidence of parity.

## Core work management

| ID | Linear capability and source | Pri | Plane starting point | Class/tier | Migration | Acceptance | Owner | Status/evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CORE-01 | [Create and edit issues](https://linear.app/docs/create-or-edit-issues) | P0 | Work items | A/Community | Map issue IDs, title, rich description | CRUD, validation, concurrent edit and activity tests | Product | Local create/read/update/delete passed; validation, concurrency and staging pending |
| CORE-02 | Custom statuses and workflow groups | P0 | Project states | A/Community | Map each team status/category | State ordering, transition and archived-state tests | Product | Pending |
| CORE-03 | Priorities including no priority and urgent | P0 | Work-item priorities | A/Community | Direct semantic map with exceptions report | Create/filter/sort/display tests | Product | Pending |
| CORE-04 | Assignees, creators and subscribers | P0 | Assignee, creator, subscribers | A/Community | Resolve users before items | Permission and notification tests | Product | Pending |
| CORE-05 | Labels and label groups | P0 | Labels | A/C | Preserve colors; group semantics may need extension | CRUD, grouping, filter and import tests | Product | Pending |
| CORE-06 | Estimates and team estimate scales | P0 | Estimates | A/Community | Translate unsupported scales | Estimate configuration and reporting tests | Product | Pending |
| CORE-07 | Due dates and overdue indicators | P0 | Due dates | A/Community | Direct date/timezone map | Timezone, overdue and reminder tests | Product | Pending |
| CORE-08 | Sub-issues and nested hierarchy | P0 | Parent/sub-work items | A/Community | Preserve hierarchy; report depth loss | Create, move, cycle prevention and display tests | Product | Pending |
| CORE-09 | Relations: blocks, blocked by, duplicate, related | P0 | Work-item relations | A/Community | Two-pass relation import | Bidirectional relation and deletion tests | Product | Pending |
| CORE-10 | Comments, threads, reactions and mentions | P0 | Comments, reactions, mentions | A/C | Import authors/timestamps where API allows | Thread, mention, reaction and notification tests | Product | Pending |
| CORE-11 | Attachments and linked resources | P0 | File assets and links | A/Community | Copy binaries, hashes and metadata | Upload/download/size/auth/missing-file tests | Platform | Pending |
| CORE-12 | Rich editor: markdown, tables, code, embeds | P1 | Rich work-item/page editor | A/C | Convert unsupported blocks with report | Paste, render, export and sanitisation tests | Product | Pending |
| CORE-13 | Issue templates | P1 | Templates are tier-dependent | B/Pro | Convert templates and defaults | Template create/apply/update tests | Product | Pending commercial decision |
| CORE-14 | Recurring issues | P1 | Recurring work items are tier-dependent | B/Business or C | Preserve cadence/timezone | Recurrence, skip, edit-series and DST tests | Product | Pending commercial decision |
| CORE-15 | Custom issue properties | P1 | Custom work-item properties are tier-dependent | B/Pro or C | Map type/validation/defaults | Each property type, filter and API tests | Product | Pending commercial decision |
| CORE-16 | SLAs | P1 | No proven Community equivalent | B/C | Import policy and breach timestamps | Clock, pause, breach and notification tests | Product | Gap |
| CORE-17 | Bulk edit and multi-select | P1 | Bulk actions | A/Community | None | Mixed-permission and undo/error tests | Product | Pending |
| CORE-18 | Delete, archive, restore and retention | P0 | Archive/delete support | A/C | Preserve archive status | Restore, cascade, audit and retention tests | Security | Pending |
| CORE-19 | Duplicate detection and merge | P2 | Partial/no proven equivalent | C/D | Preserve redirect/relationship | Detection, merge and reference integrity tests | Product | Gap |
| CORE-20 | Time tracking | P2 | Tier-dependent | B/Pro or D | Import entries and billable semantics | Timer/manual entry/report/export tests | Product | Pending commercial decision |

## Navigation, views and personal workflow

| ID | Linear capability and source | Pri | Plane starting point | Class/tier | Migration | Acceptance | Owner | Status/evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| VIEW-01 | List, board and grouped issue views | P0 | List and board layouts | A/Community | Saved layout settings may not transfer | Group/order/display/performance tests | Product | Pending |
| VIEW-02 | Calendar, Gantt/timeline and spreadsheet layouts | P1 | Calendar, Gantt and spreadsheet layouts | A/Community | Recreate saved layouts | Date drag, dependencies, zoom and density tests | Product | Pending |
| VIEW-03 | [Display options](https://linear.app/docs/display-options) | P1 | Layout display controls | A/C | Manual recreation | Property visibility, grouping, ordering tests | Product | Pending |
| VIEW-04 | Filter language and nested filters | P0 | Filters | A/C | Translate supported saved filters | Boolean/date/relationship/filter URL tests | Product | Pending |
| VIEW-05 | Custom/saved/shared views | P1 | Workspace/project views | A/B | Recreate and permission-map | Save/share/favorite/permission tests | Product | Pending |
| VIEW-06 | My issues and assigned/delegated work | P0 | Assigned work views | A/C | None | Human/agent assignment and stale-item tests | Product | Pending |
| VIEW-07 | Favorites and recent history | P1 | Favorites/recents | A/Community | None | Cross-session ordering/removal tests | Product | Pending |
| VIEW-08 | Inbox, notifications and snooze | P0 | Inbox/notifications | A/C | Notification history not migrated initially | Preference, mention, assignment, read/snooze tests | Product | Pending |
| VIEW-09 | Global search | P0 | Search; enhanced search may need OpenSearch | A/C | Reindex all migrated content | Permission, typo, phrase, latency and reindex tests | Platform | Pending |
| VIEW-10 | Command menu and keyboard shortcuts | P1 | Command menu and shortcuts | A/C | None | Keyboard-only task suite and conflict tests | Accessibility | Pending |
| VIEW-11 | Desktop applications | P2 | Plane desktop availability differs | C/D/E | None | Install/update/deep-link/notification tests | Product | Gap review |
| VIEW-12 | Mobile applications/responsive workflow | P2 | Responsive/mobile clients differ | A/C/E | None | iOS/Android task and push tests | Product | Gap review |
| VIEW-13 | Offline/cache and optimistic updates | P2 | Behaviour differs | C/E | None | Offline edit, reconnect, conflict and stale-cache tests | Platform | Gap review |
| VIEW-14 | Accessibility | P0 | Must be independently verified | A/C | None | WCAG 2.2 AA keyboard, screen-reader and contrast audit | Accessibility | Pending |

## Teams, cycles and planning

| ID | Linear capability and source | Pri | Plane starting point | Class/tier | Migration | Acceptance | Owner | Status/evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PLAN-01 | Teams, sub-teams and private teams | P0 | Workspaces/projects; semantics differ | A/C | Map teams to projects and access groups | Membership, inheritance and privacy tests | Product | Pending design |
| PLAN-02 | [Cycles](https://linear.app/docs/use-cycles) | P0 | Cycles | A/Community | Import current/future/history | Cadence, dates, timezone and membership tests | Product | Pending |
| PLAN-03 | Cycle rollover, cooldown and auto-add | P1 | Cycle automation differs | A/C | Recreate rules | Boundary, cooldown, rollover and snapshot tests | Product | Pending |
| PLAN-04 | Cycle capacity and velocity | P1 | Progress/analytics differ | A/C/D | Recompute or preserve snapshot | Three-cycle capacity and completed snapshot tests | Data | Pending |
| PLAN-05 | Projects with lead, members, status, dates and priority | P0 | Projects | A/Community | Direct map plus semantic report | CRUD, roles, state and date tests | Product | Local project CRUD passed; role/date and staging tests pending |
| PLAN-06 | Project milestones | P0 | Modules/milestones differ | A/C | Choose canonical mapping | Assignment, progress and timeline tests | Product | Pending design |
| PLAN-07 | Project dependencies | P1 | Work-item/project relations | A/C | Two-pass relationship import | Cycle detection and timeline tests | Product | Pending |
| PLAN-08 | Project templates | P1 | Tier-dependent templates | B/Pro or C | Translate templates | Create-from-template and update tests | Product | Pending commercial decision |
| PLAN-09 | Project documents and resources | P1 | Project Pages/resources | A/Community | Convert rich documents and links | Permission, embed, history and export tests | Product | Pending |
| PLAN-10 | [Project updates](https://linear.app/docs/initiative-and-project-updates) and health | P1 | Project updates/progress differ | A/C/D | Import update history if supported | Reminder, health, Slack and overdue tests | Product | Pending |
| PLAN-11 | [Initiatives](https://linear.app/docs/initiatives) | P1 | Initiatives are tier-dependent | B/Pro or C | Map hierarchy/projects | Roll-up, privacy, status and timeline tests | Product | Pending commercial decision |
| PLAN-12 | Sub-initiatives and initiative views | P2 | Advanced tier/gap | B/Enterprise or C | Preserve hierarchy | Roll-up, filter and view-permission tests | Product | Gap |
| PLAN-13 | Roadmaps and project/initiative timelines | P1 | Roadmap/Gantt layouts | A/B/C | Recreate views | Zoom, drag, milestones, dependencies tests | Product | Pending |

## Intake, customers, documents and reporting

| ID | Linear capability and source | Pri | Plane starting point | Class/tier | Migration | Acceptance | Owner | Status/evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PROD-01 | Triage queue and rules | P0 | Intake | A/B/C | Import triage items/status | Accept/decline/merge/routing/SLA tests | Product | Pending |
| PROD-02 | Triage Intelligence | P2 | Plane AI is not equivalent | C/D/E | None | Classification accuracy, override and audit tests | AI | Gap |
| PROD-03 | Asks from Slack/Teams/email | P1 | Intake and integrations differ | B/D | Preserve source links | Identity, routing, thread sync and duplicate tests | Integrations | Gap |
| PROD-04 | Customer requests linked to issues/projects | P1 | Customers/intake are tier-dependent | B/Business or D | Import requester/item links | Link, visibility, status update and export tests | Product | Pending commercial decision |
| PROD-05 | Customer records, tiers and revenue | P2 | Customers are tier-dependent | B/Business or D | Map CRM identifiers and revenue | Permission, aggregation and sync tests | Product | Pending commercial decision |
| DOC-01 | Pages and issue/project documents | P0 | Project Pages | A/Community | Convert supported rich text | CRUD, link, permission, history and export tests | Product | Pending |
| DOC-02 | Workspace wiki | P1 | Wiki is tier-dependent | B/Pro or C | Import hierarchy and links | Navigation, search, permissions and export tests | Product | Pending commercial decision |
| DOC-03 | Nested documents, templates and comments | P2 | Tier-dependent/partial | B/Business or C | Preserve tree and threads | Move, template, comment and history tests | Product | Gap |
| RPT-01 | Cycle/project progress graphs | P0 | Progress views | A/C | Recompute after reconciliation | Baseline math and snapshot tests | Data | Pending |
| RPT-02 | Insights and dashboards | P1 | Dashboards are tier-dependent | B/Pro or C/D | Recreate measures/filters | Metric parity and permission tests | Data | Pending commercial decision |
| RPT-03 | Custom reports and scheduled delivery | P2 | No proven full equivalent | C/D | Recreate queries | Schedule, delivery, timezone and access tests | Data | Gap |
| RPT-04 | CSV/data export and warehouse sync | P1 | Export/API available; semantics differ | A/C/D | Build canonical export mapping | Completeness, pagination, deletion and schema tests | Data | Pending |

## Developer workflow, releases and AI

| ID | Linear capability and source | Pri | Plane starting point | Class/tier | Migration | Acceptance | Owner | Status/evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DEV-01 | GitHub issue/branch/commit/PR linking | P0 | GitHub integration | A/Community | Reconnect repositories; preserve external links | Branch, commit, PR and unlink tests | Integrations | Pending |
| DEV-02 | GitLab linking and automation | P1 | GitLab integration support varies | A/B/D | Reconnect repositories | Commit/MR/state/revocation tests | Integrations | Pending |
| DEV-03 | PR/merge status automation | P0 | Integration state automation | A/C | Recreate rules | Draft/open/merge/close/retry/idempotency tests | Integrations | Pending |
| DEV-04 | [In-app code reviews and diffs](https://linear.app/docs/diffs) | P2 | No documented equivalent | C/D/E | No migration | Files, inline threads, review, merge and sync tests | Engineering | Gap |
| DEV-05 | Guided reviews and code intelligence | P3 | No documented equivalent | C/D/E | None | Large-PR guide correctness and permission tests | Engineering | Gap |
| DEV-06 | [Release pipelines](https://linear.app/docs/releases) | P1 | Plane Releases are not equivalent | C/D | Import release history if feasible | Continuous/scheduled pipeline and attribution tests | Engineering | Gap |
| DEV-07 | Deployment-to-issue attribution and release notes | P1 | Partial release/module support | C/D | Map commits/issues/releases | CI event, environment, note and changelog tests | Engineering | Gap |
| AI-01 | [Agent users and delegation](https://linear.app/docs/agents-in-linear) | P2 | Plane Apps/MCP/AI partially overlap | B/C/D | Map integrations, not user history | Install, scope, delegate, mention and revoke tests | AI | Gap |
| AI-02 | Workspace/team agent guidance with history | P2 | No proven equivalent | C/D | Import current guidance | Precedence, history, privacy and delivery tests | AI | Gap |
| AI-03 | [Coding sessions](https://linear.app/docs/coding-sessions) | P2 | No native equivalent | D/E | Preserve PR links only | Delegate, sandbox, PR, review, retry and billing tests | AI | Gap |
| AI-04 | AI issue creation, summaries and search | P2 | Plane AI tier/features differ | B/C/D | None | Quality, citations, permissions and opt-out tests | AI | Gap |
| AI-05 | MCP server/tooling | P2 | Plane MCP support | A/B/D | Reconfigure clients | Auth, read/write scope and prompt-injection tests | AI | Pending |
| AI-06 | Loops/automated agent workflows | P3 | No proven equivalent | C/D/E | None | Trigger, approval, retry, audit and kill-switch tests | AI | Gap |

## Integrations and platform APIs

| ID | Linear capability and source | Pri | Plane starting point | Class/tier | Migration | Acceptance | Owner | Status/evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| INT-01 | Slack notifications and issue actions | P0 | Native Slack integration | A/B | Reinstall and remap channels | Create, notify, unfurl, action and revoke tests | Integrations | Pending |
| INT-02 | Microsoft Teams | P2 | No proven equivalent | D/E | Reconfigure | Identity, create, notify and revoke tests | Integrations | Gap |
| INT-03 | Sentry issue linking | P1 | Native Sentry integration | A/B | Reconnect projects | Create/link/resolve/retry tests | Integrations | Pending |
| INT-04 | Figma embeds/integration | P2 | Generic embeds or adapter | A/D | Preserve links | Embed permissions and unfurl tests | Integrations | Gap |
| INT-05 | Intercom and Zendesk feedback | P2 | Adapter/paid intake | B/D | Preserve customer/source IDs | Two-way link/status/identity tests | Integrations | Gap |
| INT-06 | Salesforce customer sync | P3 | Adapter | D/E | Map CRM IDs | Sync, conflict, permissions and deletion tests | Integrations | Gap |
| INT-07 | Zapier and automation ecosystem | P2 | APIs/webhooks/third-party | D | Rebuild each automation | Trigger/action/retry/dedup tests | Integrations | Gap |
| INT-08 | Email intake | P1 | Tier-dependent intake email | B/Business or D | Preserve sender/source | Auth, threading, attachments and abuse tests | Integrations | Pending commercial decision |
| API-01 | Public API coverage | P0 | Plane REST; Linear is GraphQL | A/C/D | Rewrite every consumer | CRUD, pagination, filter, permission and rate tests | Platform | Pending |
| API-02 | Webhooks with signing and retries | P0 | Plane webhooks | A/C/D | Rewrite schemas | HMAC, dedup, ordering, retry and rotation tests | Platform | Pending |
| API-03 | OAuth applications and granular scopes | P1 | Plane OAuth/Apps differ | A/B/C | Re-register clients | Consent, scope, revoke and callback tests | Security | Pending |
| API-04 | Importers for Linear and other tools | P0 | Linear importer is tier/deployment dependent | B/C/D | Custom Community migration path | Dry run, reconciliation and restart tests | Data | Gap |
| API-05 | Full export and deletion portability | P0 | Export/API plus storage backup | A/C/D | Canonical export schema | Export, attachment, restore and deletion tests | Data | Pending |

## Identity, security and operations

| ID | Linear capability and source | Pri | Plane starting point | Class/tier | Migration | Acceptance | Owner | Status/evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SEC-01 | Invite-only member authentication | P0 | Native auth plus outer Access | A/D | Invite staff by verified email | Invite, login, logout, lockout and offboard tests | Security | Pending |
| SEC-02 | Google/GitHub OAuth | P0 | Community OAuth | A/Community | None | Callback, account-link and revoked-token tests | Security | Pending |
| SEC-03 | SAML/OIDC SSO | P1 | Tier-dependent | B/Pro+ | Map verified emails | Login, linking, enforced SSO and break-glass tests | Security | Pending commercial decision |
| SEC-04 | [SCIM provisioning](https://linear.app/docs/scim) | P2 | No complete documented equivalent | B/C/D/E | Directory mapping | Create/update/suspend/group and failure tests | Security | Gap |
| SEC-05 | Domain claiming and login restrictions | P2 | Partial/tier-dependent | B/C/D | None | Claim, conflict, bypass and recovery tests | Security | Gap |
| SEC-06 | Workspace, project, guest and private access | P0 | Roles and project permissions | A/B | Map memberships before content | Matrix, guest, private link and API tests | Security | Pending |
| SEC-07 | Granular admin roles and approval workflows | P2 | Enterprise tier/partial | B/Enterprise or C | Map admins manually | Privilege, approval, escalation and audit tests | Security | Gap |
| SEC-08 | [Audit log](https://linear.app/docs/audit-log) and SIEM stream | P1 | Tier/coverage differs | B/C/D | Keep migration audit externally | Event coverage, retention, export and tamper tests | Security | Gap |
| SEC-09 | IP restrictions and session controls | P2 | Cloudflare Access plus tier controls | B/D | None | Network, session expiry and break-glass tests | Security | Gap |
| SEC-10 | Parent-domain credential isolation | P0 | MLAI gateway requirement | D | None | Denylist, canary, OAuth and WebSocket tests | Security | 31-test Workerd suite, live cookie canary, and public-host presign passed; named-Tunnel OAuth/live 101 pending |
| SEC-11 | Data encryption, secret rotation and residency | P0 | Deployment responsibility | D | Encrypt migrated data | TLS, at-rest, rotation and region evidence | Security | Pending infrastructure |
| OPS-01 | Backups, PITR and attachment restore | P0 | Deployment responsibility | D | Initial import plus snapshot | Automated backup and isolated restore drill | Platform | Proxy-quiesced bundled PostgreSQL/object restore drill passed; PITR and production pending |
| OPS-02 | Monitoring, logs and alerting | P0 | Deployment responsibility | D | None | Synthetic, queue, DB, disk, 5xx and WS alerts | Platform | Pending infrastructure |
| OPS-03 | High availability and disaster recovery | P2 | Deployment responsibility | D/E | None | Host/service failure and RTO/RPO drill | Platform | Gap |
| OPS-04 | Upgrade/release reproducibility | P0 | Pinned fork and manifests | A/D | Migration rehearsal | Digest, migration, rollback and source-link checks | Platform | Fresh v1.4.0 digest-pinned migration passed; staging rollback/source-link checks pending |

## Release gates

The private pilot may begin only when all `P0` rows have an assigned named owner,
test evidence, and either a passing result or an explicitly documented pilot
exception. Production must not be marketed as Linear parity until every required
row has passing evidence and every accepted difference is approved.

Matrix changes require a dated review because both Linear and Plane evolve. New
Linear behaviour is added as a row instead of silently expanding an existing
acceptance statement.
