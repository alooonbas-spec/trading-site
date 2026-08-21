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
- `adapter.getCapabilities().publishing` decides whether `adapter.publish` runs. Post status (`DRAFT` / `SCHEDULED` / `PUBLISHING` / `PUBLISHED` / `PARTIAL` / `FAILED` / `CANCELLED`) is independent of JobStatus and CampaignStatus. `do_not_contact` is not on posts.

## Monitoring (PHASE 7)

- `monitoring_rules` own `MonitoringRuleStatus` (`ACTIVE` / `PAUSED` / `DISABLED`). `monitoring_events` are append-only and unique per `(workspace_id, rule_id, external_id)`.
- `do_not_contact` is not on monitoring tables.
- Workers claim `MONITOR` jobs with `FOR UPDATE SKIP LOCKED` and skip paused/disabled rules. They branch on `job.type`, never `platform ===`.
- Adapters collect mentions. X uses official `GET https://api.x.com/2/tweets/search/recent` when a token is present. Telegram uses official `getUpdates`. Other platforms and tokenless runs use TinyFish Search (`GET https://api.search.tinyfish.ai`) on official domains only.
- TinyFish Search honors HTTP 429 with no tight-loop retry, never sends stealth browser profiles, and never bypasses captcha. Missing `TINYFISH_API_KEY` fails honestly.
- Keyword matching happens after collection. Non-official source hosts are rejected.

## Analytics (PHASE 8)

- Lead, contact, campaign, account, post, monitoring, and job-family metrics stay on their own machines.
- Analytics reads live workspace tables. It does not invent a universal success total or copy `do_not_contact` onto other entities.
- CONTACT, PUBLISH, and MONITOR job counts are tallied separately.

## Token refresh and Telegram send (PHASE 9)

- `adapter.refreshTokens()` is the only place that talks to a platform token endpoint. Workers call `prepareAccountAdapter`, which refreshes expired tokens before CONTACT, PUBLISH, or MONITOR jobs.
- X uses official `POST https://api.x.com/2/oauth2/token` with `grant_type=refresh_token`. Instagram uses `GET https://graph.instagram.com/refresh_access_token`. Facebook uses `fb_exchange_token`. VK uses `https://id.vk.ru/oauth2/auth`. Telegram bot tokens are not refreshable; missing refresh fails honestly.
- Successful refreshes persist encrypted tokens and log `SOCIAL_ACCOUNT_TOKEN_REFRESHED`. If a provider omits a new refresh token, the previous encrypted refresh token is kept.
- Telegram text publish and MESSAGE use official `sendMessage`. Publishing needs `metadata.publishChatId`. INVITE still throws `UnsupportedActionError`. Facebook, Instagram, and VK contact actions stay disabled.

## Background worker (PHASE 10)

- `GET`/`POST /api/jobs/process` is a public path authenticated with `Authorization: Bearer $CRON_SECRET` or `WORKER_SECRET`. Missing or wrong secrets fail honestly.
- The handler runs inside `runAsWorker()`, so `createClient()` uses `SUPABASE_SERVICE_ROLE_KEY` (never `NEXT_PUBLIC_*`) and never cookies.
- `claim_due_jobs` is granted only to `service_role`. It claims due `PENDING`/`RETRY` jobs across workspaces with `FOR UPDATE SKIP LOCKED`, still skipping paused campaigns and non-ACTIVE monitoring rules.
- UI "Process queue" still uses workspace-scoped `claim_jobs`. The worker does not introduce `if (platform === …)`.
- Vercel Cron is configured daily (`0 0 * * *`) so Hobby deploys stay valid. More frequent processing uses the same endpoint from an external scheduler.

## Media publishing (PHASE 11)

- Telegram publishes image, GIF, video, PDF, and ZIP URLs through official `sendPhoto` / `sendAnimation` / `sendVideo` / `sendDocument` / `sendMediaGroup`. Telegram fetches the public URL. Local and private hosts are rejected.
- X downloads public media, then uses official `POST https://api.x.com/2/media/upload/initialize`, `/append`, and `/finalize` with `media.write`, and attaches `media.media_ids` on `POST https://api.x.com/2/tweets`. Existing X accounts must reconnect to grant `media.write`.
- Mixed types, private IPs, and unsupported document URLs fail honestly. The worker still does not branch on `platform ===`.

## Facebook, Instagram, and VK publishing (PHASE 12)

- Facebook publishes through a Page access token from official `GET /me/accounts`, then `POST /{page-id}/feed`, `/{page-id}/photos`, or `/{page-id}/videos`. OAuth now requests `pages_manage_posts`. Multiple Pages require `metadata.pageId`.
- Instagram uses Instagram API with Instagram Login: `POST /{ig-user-id}/media` and `/{ig-user-id}/media_publish` with `instagram_business_content_publish`. Text-only posts are rejected. Images must be jpeg/png; Reels must be mp4.
- VK uses official `wall.post`. Photos go through `photos.getWallUploadServer` → upload → `photos.saveWallPhoto`. OAuth now requests `wall photos offline`. Optional `metadata.publishOwnerId` targets a community wall.
- Existing Facebook, Instagram, and VK accounts must reconnect to grant the new scopes. Contact actions on these platforms stay `UnsupportedActionError`. App Review still applies; tester/admin tokens work before review.

## Social adapters (PHASE 2)

`getSocialAdapter(platform)` is the only place that maps a platform to an implementation. Services must not branch on `platform === "telegram"` (or any other platform).

Encrypted access and refresh tokens are omitted from authenticated `SELECT` on `social_accounts`. Operators, owners, and admins read them through `read_social_account_secrets`.

