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

`publicCollection` is true only when the server key is configured. Publishing, monitoring, and contact actions stay disabled.

## Social adapters (PHASE 2)

`getSocialAdapter(platform)` is the only place that maps a platform to an implementation. Services must not branch on `platform === "telegram"` (or any other platform).

Encrypted access and refresh tokens are omitted from authenticated `SELECT` on `social_accounts`. Operators, owners, and admins read them through `read_social_account_secrets`.

