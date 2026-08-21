# Social Hub architecture

Modular monolith + workers. One Postgres database. Platform logic lives in social adapters, not in business services.

## Domain model

```
User → Workspace → Social Accounts
                 → Leads → Social Profiles
                 → Lead Account Relationships
                 → Lead Interactions
                 → Campaigns → Campaign Leads / Campaign Accounts
                 → Posts → Post Targets
                 → Monitoring Rules → Monitoring Events
                 → Jobs
```

One workspace has many social accounts. Never assume 1 platform = 1 account.

## Independent state machines

| Machine | Owns |
| --- | --- |
| `LeadStatus` | CRM stage of a person |
| `ContactStatus` | State of one (lead, profile, our account) relationship |
| `CampaignStatus` | Campaign lifecycle |
| `PostStatus` | Post lifecycle |
| `PostTargetStatus` | Per-account publish outcome |
| `MonitoringRuleStatus` | Monitoring rule lifecycle |
| `JobStatus` | Queue item |
| `SocialAccountStatus` | Connected account health |

`do_not_contact` exists only on `leads`. It is not a contact status.

## Request path

UI → Route / Server Action → Domain Service → Social Adapter → Platform API or TinyFish (server-side only)

Tokens, API keys, and session cookies never go to the client.

## CRM (PHASE 3)

- `leads` own `LeadStatus` and the only `do_not_contact` flag.
- `social_profiles` are platform identities unique per workspace (`workspace_id, platform, external_profile_id`).
- `contact_relationships` own `ContactStatus` for one (lead, their profile, our account) pair.
- `lead_interactions` are an append-only timeline.
- Merge moves profiles/relationships/interactions onto the surviving lead, ORs `do_not_contact`, and archives the source.

Outbound contact status changes (`QUEUED`, invite/message pending/sent) are blocked when `do_not_contact` is true. Recording replies, failures, or blocks is still allowed.

## Campaigns and jobs (PHASE 4)

- Campaigns select many leads and many social accounts. Start enqueues one CONTACT job per matching (lead profile, our account) pair on the same platform.
- Workers claim jobs with `FOR UPDATE SKIP LOCKED`. They skip paused campaigns, `do_not_contact` leads, and inoperable accounts.
- `AccountRateLimiter` consumes per-account windows via `increment_account_rate_bucket`. Limits come from `adapter.getRateLimit()`, not from `if (platform === …)` in the worker.
- INVITE/MESSAGE call `adapter.executeContactAction`. Until adapters enable contact actions, those jobs fail with `UnsupportedActionError` instead of fake success.

## Public collection (PHASE 5)

TinyFish is server-only. The API key is `TINYFISH_API_KEY` (never `NEXT_PUBLIC_*`) and is sent as `X-API-Key` to official endpoints:

- Fetch: `POST https://api.fetch.tinyfish.ai`
- Search: `GET https://api.search.tinyfish.ai`
- Agent: `POST https://agent.tinyfish.ai/v1/automation/run`

PHASE 5 uses Fetch to collect a public profile page. Each adapter resolves an official public URL (Telegram `t.me`, VK `vk.com`, X `x.com`, Instagram `instagram.com`, Facebook `facebook.com`). Arbitrary URLs are rejected.

Safety policy:

- Goals/purpose text that mentions captcha solving, stealth, or rate-limit bypass is rejected.
- `bot_blocked` fails honestly. There is no stealth retry.
- HTTP 429 is surfaced as `RateLimitError`. The client does not tight-loop.

`publicCollection` is true only when the server key is configured. Contact actions stay disabled.

## Publishing (PHASE 6)

- A post has many `post_targets` (one per social account). Never assume 1 platform = 1 account.
- Publish enqueues `PUBLISH` jobs onto the shared queue. Scheduling uses `jobs.run_after`, not adapter-native scheduling.
- Workers skip cancelled posts, inoperable accounts, and already-published targets. They honor `AccountRateLimiter`.
- `adapter.getCapabilities().publishing` decides whether `adapter.publish` runs. X text posts use official `POST https://api.x.com/2/tweets` with `tweet.write`. Other platforms throw `UnsupportedActionError` instead of fake success.
- Media URLs on X fail honestly until media upload is implemented.
- Post status (`DRAFT` / `SCHEDULED` / `PUBLISHING` / `PUBLISHED` / `PARTIAL` / `FAILED` / `CANCELLED`) is independent of JobStatus and CampaignStatus. `do_not_contact` is not on posts.

## Monitoring (PHASE 7)

- `monitoring_rules` own `MonitoringRuleStatus` (`ACTIVE` / `PAUSED` / `DISABLED`). `monitoring_events` are append-only and unique per `(workspace_id, rule_id, external_id)`.
- `do_not_contact` is not on monitoring tables.
- Workers claim `MONITOR` jobs with `FOR UPDATE SKIP LOCKED` and skip paused/disabled rules. They branch on `job.type`, never `platform ===`.
- Adapters collect mentions. X uses official `GET https://api.x.com/2/tweets/search/recent` when a token is present. Telegram uses official `getUpdates`. Other platforms and tokenless runs use TinyFish Search (`GET https://api.search.tinyfish.ai`) on official domains only.
- TinyFish Search honors HTTP 429 with no tight-loop retry, never sends stealth browser profiles, and never bypasses captcha. Missing `TINYFISH_API_KEY` fails honestly.
- Keyword matching happens after collection. Non-official source hosts are rejected.

## Social adapters (PHASE 2)

`getSocialAdapter(platform)` is the only place that maps a platform to an implementation. Services must not branch on `platform === "telegram"` (or any other platform).

Encrypted access and refresh tokens are omitted from authenticated `SELECT` on `social_accounts`. Operators, owners, and admins read them through `read_social_account_secrets`.

