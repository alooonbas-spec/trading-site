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
                 → Inbox Events
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

- Campaigns select many leads and many social accounts. Start enqueues one CONTACT job per matching (lead profile, our account) pair on the same platform when that account's adapter can perform the campaign action.
- MESSAGE requires `messaging`. INVITE requires `invites` (no adapter enables invites yet). OPEN_PROFILE and MANUAL_ACTION_REQUIRED still enqueue without an adapter send.
- Workers claim jobs with `FOR UPDATE SKIP LOCKED`. They skip paused campaigns, `do_not_contact` leads, and inoperable accounts.
- `AccountRateLimiter` consumes per-account windows via `increment_account_rate_bucket`. Limits come from `adapter.getRateLimit()`, not from `if (platform === …)` in the worker.
- INVITE/MESSAGE call `adapter.executeContactAction`. Capability gating at start avoids queuing jobs that would only throw `UnsupportedActionError`.

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
- Adapters collect mentions. X uses official `GET https://api.x.com/2/tweets/search/recent` when a token is present. Telegram uses official `getUpdates`. VK uses official `newsfeed.search` when a user or service token is present (PHASE 19). Other platforms and tokenless runs use TinyFish Search (`GET https://api.search.tinyfish.ai`) on official domains only.
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
- VK uses official `wall.post`. Photos go through `photos.getWallUploadServer` → upload → `photos.saveWallPhoto`. Optional `metadata.publishOwnerId` targets a community wall. Video upload is PHASE 16.
- Existing Facebook, Instagram, and VK accounts must reconnect to grant the new scopes. App Review still applies; tester/admin tokens work before review. Contact send for Facebook and Instagram is PHASE 18. VK contact stays `UnsupportedActionError`.

## Inbox replies (PHASE 13)

- `INBOX` jobs poll connected accounts. `adapter.collectInbox()` talks to official APIs: Telegram `getUpdates` DMs, X mentions and Direct Messages, Facebook Page comments and Messenger conversations, Instagram media comments and Direct Messages, and VK `wall.getComments`.
- Events are stored in `inbox_events` (unique per account + external id). Unknown senders are kept unmatched and are not turned into leads. X inbox also reads Direct Messages (PHASE 17).
- Matched CRM profiles record a `REPLY` interaction. Existing contact relationships move to `REPLIED` unless they are `BLOCKED`. `do_not_contact` does not block recording replies.
- Instagram comment inbox needs `instagram_business_manage_comments` (reconnect). Telegram `getUpdates` is a single Bot API consumer; PHASE 15 shares that stream between inbox and monitoring.
- The worker still branches on `job.type`, never `platform ===`.

## Inbox UI (PHASE 14)

- The Inbox page lists stored events with unmatched/matched filters. Unmatched senders are attached to an **existing** lead. Inbox never inserts a `leads` row.
- Attach creates or reuses a `social_profiles` identity from the event (platform comes from the receiving social account). If that identity is already linked to another lead, attach fails honestly.
- Sibling unmatched events for the same identity are rematched together. Each records a `REPLY` interaction. Existing contact relationships move to `REPLIED` unless they are `BLOCKED`. `do_not_contact` does not block recording replies.
- Lead merge moves matched inbox events onto the surviving lead and reassigns events before a duplicate profile is deleted.
- The worker still branches on `job.type`, never `platform ===`.

## Telegram shared updates (PHASE 15)

- Telegram Bot API `getUpdates` is one consumer per bot. Adapters expose `sharedUpdateStream` when inbox and monitoring must share that stream.
- INBOX and MONITOR jobs for those accounts call `adapter.collectSharedUpdates()` once, then ingest private DMs and keyword-match monitor candidates. Dedup stays on unique inbox and monitoring event constraints.
- The shared cursor lives on `social_accounts.metadata.updateStreamCursor` (kept in sync with `inboxCursor`). The worker never writes a cursor backwards and never branches on `platform ===`.
- Concurrent INBOX/MONITOR jobs on the same account are released and retried shortly instead of issuing a second `getUpdates`.
- Telegram INVITE remains `UnsupportedActionError`. Other platforms keep separate inbox and monitor APIs.

## VK video publishing (PHASE 16)

- VK videos use official `video.save` to get an upload URL, then `POST` the public mp4/mov file as `video_file`, then `wall.post` with a `video{owner_id}_{video_id}` attachment.
- Photos and videos cannot be mixed in one post. webm, documents, private hosts, and mixed media fail honestly. Existing VK accounts must reconnect to grant the `video` scope.
- Community walls still use `metadata.publishOwnerId`. Contact actions on VK stay `UnsupportedActionError`.

## X Direct Messages and campaign gating (PHASE 17)

- X OAuth requests `dm.read` and `dm.write` in addition to tweet, user, media, and offline scopes. Existing X accounts must reconnect.
- Inbox collects mentions (`GET /2/users/:id/mentions`) and inbound DMs (`GET /2/dm_events` with `event_types=MessageCreate`). Unique `inbox_events` still dedup. Outbound DMs from the connected account are skipped. Attachments-only DMs without text are skipped rather than invented.
- Outbound MESSAGE uses official `POST /2/dm_conversations/with/{participant_id}/messages`. Numeric profile ids are used as `participant_id`. Username-only profiles are resolved through `GET /2/users/by/username/:username`. INVITE stays `UnsupportedActionError`.
- Campaign start filters CONTACT pairs through adapter capabilities, not `if (platform === …)`. MESSAGE enqueues for Telegram and X (PHASE 17) and Facebook/Instagram (PHASE 18). INVITE enqueues for nobody (`invites` is false on every adapter). Zero remaining pairs fail with `ValidationError`.
- Facebook and Instagram messaging is PHASE 18. VK contact send stays disabled. Telegram INVITE stays disabled.

## Facebook Messenger and Instagram DMs (PHASE 18)

- Facebook OAuth adds `pages_manage_metadata` and `pages_messaging`. Inbox reads Page comments and Messenger conversations (`GET /{page-id}/conversations?platform=MESSENGER`). Outbound MESSAGE uses official `POST /{page-id}/messages` with `messaging_type=RESPONSE` and a Page-scoped recipient id.
- Instagram OAuth adds `instagram_business_manage_messages`. Inbox reads media comments and Direct Messages (`GET /{ig-user-id}/conversations?platform=instagram`). Outbound MESSAGE uses official `POST /{ig-user-id}/messages` with an Instagram-scoped recipient id.
- Public usernames cannot be messaged. Recipients must already have opened a conversation (24-hour window). Graph errors fail honestly. INVITE stays `UnsupportedActionError`.
- Campaign start now enqueues MESSAGE for Facebook and Instagram through the same capability filter. Existing Facebook and Instagram accounts must reconnect.
- VK user `messages.send` is not implemented: new apps are not granted the user `messages` scope. Community tokens would be a later phase.

## VK newsfeed monitoring (PHASE 19)

- VK monitoring uses official `newsfeed.search` with a connected user token, or `VK_SERVICE_TOKEN` when no user token is present. Keyword matching still happens after collection. The unix `date` watermark is sent back as `start_time`. PHASE 47 walks older `start_from` windows.
- Tokenless runs without a service token fall back to TinyFish Search, or fail honestly if TinyFish is not configured. Facebook and Instagram still have no public keyword-search API, so they stay on TinyFish.
- No new VK OAuth scope is required. The worker still branches on `job.type`, never `platform ===`.

## Official inbox replies (PHASE 20)

- Operators reply to a stored `inbox_events` row from Inbox or a lead page. The server action calls `adapter.replyToInbox()` after `prepareAccountAdapter` and the same `increment_account_rate_bucket` limiter the worker uses. Services do not branch on `platform ===`.
- Collectors persist `reply_kind` (`direct_message`, `comment`, `mention`). Pre-PHASE-20 rows infer kind from platform and public URL (Telegram private DMs, X status URLs as mentions, Facebook/Instagram public URLs as comments, VK wall comments). Inference never invents a send that the adapter cannot perform.
- Direct messages reuse official MESSAGE send: Telegram `sendMessage`, X `POST /2/dm_conversations/with/{id}/messages`, Facebook `POST /{page-id}/messages`, Instagram `POST /{ig-user-id}/messages`.
- Comment replies use official write APIs: Facebook `POST /{comment-id}/comments` (`pages_manage_engagement`; reconnect existing Pages), Instagram `POST /{ig-comment-id}/replies`, VK `wall.createComment` with `reply_to_comment`.
- X mention replies use `POST /2/tweets` with `reply.in_reply_to_tweet_id`. VK user Direct Messages stay disabled.
- Matched outbound replies check `leads.do_not_contact` and record interaction type `MESSAGE`. Unmatched inbound replies are allowed (the person already wrote in) and do not create leads. `REPLIED` and `BLOCKED` relationship statuses are not overwritten; other statuses may move to `MESSAGE_SENT`.
- `inboxReply` is true on Telegram, X, Facebook, Instagram, and VK. Capability-off adapters still throw `UnsupportedActionError`.

## Inbox cursors (PHASE 21)

- Facebook, Instagram, and VK inbox jobs used to return the previous cursor unchanged, so every poll re-fetched the same window and relied only on the unique `(workspace, account, external_id)` constraint.
- Each adapter owns an opaque `inboxCursor`. The worker stores the later of the previous metadata cursor and `collectInbox().cursor` via `laterUpdateStreamCursor`. It still does not branch on `platform ===`.
- X mentions keep official `since_id`. Direct Messages have no `since_id`, so the adapter skips event ids at or before a `dms` watermark. Legacy numeric cursors stay the mentions watermark.
- Facebook and Instagram keep independent `comments` and `messages` timestamps so a newer DM cannot hide a later comment (or the reverse). Graph `since` is not applied to Page feed: that would drop comments on older posts.
- VK wall comments use a unix `date` watermark on the latest `wall.get` page. PHASE 40 walks older `wall.get` offset windows; comments on newly discovered older posts are not dropped by that watermark on first sight. Unique constraints remain the safety net if two events share a timestamp.

## Inbox operations (PHASE 22)

Inbox filters by receiving account, account platform, match state, and stored `reply_kind`. Owners and admins can poll inbox-capable accounts from Inbox. Process queue still claims the shared workspace jobs with SKIP LOCKED.

## VK community Direct Messages (PHASE 23)

VK community tokens connect through the existing `VkAdapter`. Tokens stay encrypted at rest. Inbox uses `messages.getConversations` to discover 1:1 peers, then `messages.getHistory` for the latest 50 inbound Direct Messages per conversation, plus wall comments. Outbound MESSAGE uses `messages.send`. User OAuth still cannot DM.

## Jobs queue (PHASE 24)

The Jobs page lists CONTACT, PUBLISH, MONITOR, and INBOX jobs. Operators retry FAILED jobs and cancel PENDING/RETRY jobs. Retry does not rewrite `LeadStatus` or `do_not_contact`. Process queue remains shared SKIP LOCKED.

## Activity log (PHASE 25)

The Activity page lists `activity_log` rows with action, entity, account, and platform filters. Platform is account identity. Metadata is passed through `logger.redact` before display so tokens and secrets never reach the client. The log is append-only; viewing it does not rewrite any status machine.

## VK community DM history (PHASE 26)

Community inbox no longer stops at `last_message`. After listing conversations, the adapter calls official `messages.getHistory` for each 1:1 user peer (count 50). A `history:1` cursor marker means later polls may skip Direct Message ids at or before the messages watermark. PHASE 23 cursors without that marker backfill the recent history window once. Unique `(workspace, account, external_id)` still dedups. Chat peers stay skipped. User OAuth inbox is still wall comments only.

## Operator list pagination (PHASE 27)

Inbox, Jobs, and Activity pages fetch 201 rows and keep 200. If more exist, an opaque `after` keyset (`created_at`, `id`) loads older rows. Invalid cursors are ignored. There is no SQL `OFFSET`. Filter forms omit `after` so a new filter starts from the newest page.

## Lead detail pagination (PHASE 28)

The lead page paginates matched inbox events (`inbox`) and the interaction timeline (`timeline`) independently with the same keyset. Paginating one list keeps the other cursor. Official replies are still blocked when the lead is `do_not_contact`.

## Operator index pagination (PHASE 29)

Leads, Campaigns, Posts, and Monitoring index pages use the same `created_at` keyset as Inbox. Filter forms omit `after`. Campaign/post compose pickers and inbox/lead-merge `listLeads` stay unbounded. Monitoring rule events replace the previous 100-row cap with a 200-row keyset. There is no SQL `OFFSET`.

## Detail jobs and campaign leads (PHASE 30)

Campaign, post, and monitoring rule pages paginate their job lists with the same keyset. Campaign leads paginate independently (`leads`) from campaign jobs (`after`). Monitoring events (`after`) and jobs (`jobs`) stay independent. Detail pages load leads and social accounts by id instead of the whole workspace CRM. Retry still lives on the Jobs queue and does not rewrite `LeadStatus` or `do_not_contact`.

## Lead pickers (PHASE 31)

Campaign compose, inbox attach, and lead merge no longer call unbounded `listLeads`. They search the newest 200 matching leads (`searchPickerLeads` / `listLeadsPage`). Selected campaign leads stay checked across searches. Inbox `leadQ` and merge `mergeQ` are GET searches that keep the other page cursors. The picker never creates people and does not rewrite `do_not_contact`.

## Index status filters (PHASE 32)

Campaigns, Posts, and Monitoring index pages filter by their own status machines. Monitoring can also filter by stored rule platform (identity, not a business-logic switch). Filter GET forms omit `after` so a new filter starts from the newest keyset page. Filters do not rewrite `LeadStatus` or `do_not_contact`.

## Social account index (PHASE 33)

The Social Accounts page paginates connected-account cards with the same `created_at` keyset and filters by stored platform identity and `SocialAccountStatus`. Group create still uses unbounded `listSocialAccounts` so operators can assign any account. Tokens stay server-side. Filtering does not rewrite `LeadStatus` or `do_not_contact`.

## Detail job status filters (PHASE 34)

Campaign, post, and monitoring rule pages filter their paginated job lists by `JobStatus`. Filter GET forms omit the jobs cursor (`after` on campaign/post, `jobs` on monitoring) so a new filter starts from the newest keyset page. Independent cursors (campaign leads, monitoring events) stay in hidden fields. Filtering does not rewrite `LeadStatus` or `do_not_contact`. Retry still lives on the Jobs queue.

## Social account pickers (PHASE 35)

Campaign, post, group, monitoring, inbox, jobs, activity, and lead-relationship account pickers search the newest 200 matching accounts (`searchPickerAccounts` / `listSocialAccountsPage`). Selected compose accounts stay checked across searches. Jobs/activity/inbox `accountQ` is a GET search; a selected account id still loads by id if it is outside the current page. Unbounded `listSocialAccounts` remains for workspace-wide inbox poll and account health. The picker never sends tokens to the client and does not rewrite `LeadStatus` or `do_not_contact`.

## VK community history offset (PHASE 36)

After the first 50-message window (`history:1`), each later inbox poll calls official `messages.getHistory` with `offset = page * 50` for the same 1:1 user peers. A full 50-item page advances `history:2`, `history:3`, and so on. A short page stores `history:done` and later polls only keep Direct Message ids after the messages watermark. Chat peers stay skipped. User OAuth inbox is still wall comments only. Unique `(workspace, account, external_id)` still dedups.

## Workspace members pagination (PHASE 37)

The Settings members table uses the same `created_at` keyset as other operator lists (newest first, 200 per page). Unbounded `listWorkspaceMembers` remains for programmatic use. Membership changes do not rewrite `LeadStatus` or `do_not_contact`.

## Detail membership pagination (PHASE 38)

Campaign accounts (`accounts`) and post targets (`targets`) paginate independently from jobs (`after`) and campaign leads (`leads`) with the same `created_at` keyset. JobStatus filter forms keep the other cursors in hidden fields and omit the jobs cursor. Unbounded `listCampaignAccountIds` and `listPostTargets` remain for enqueue. Paginating membership lists does not rewrite `LeadStatus`, `PostTargetStatus`, or `do_not_contact`.

## VK community conversation offset (PHASE 39)

After the first 20-conversation window (`conversations:1`), each later inbox poll calls official `messages.getConversations` with `offset = page * 20`. A full 20-item raw page (including chats) advances `conversations:2`, `conversations:3`, and so on. A short page stores `conversations:done` and later polls only list the latest 20 conversations. Newly discovered older 1:1 peers still get `messages.getHistory` (latest 50 plus the current history offset window). Their inbound Direct Messages are not dropped by the messages watermark on first sight. Chat peers stay skipped. User OAuth inbox is still wall comments only. This is still not a full archive in one poll: each poll walks one extra 20-conversation page, and history remains 50-message windows.

## VK wall offset (PHASE 40)

After the first 10-post window (`wall:1`), each later inbox poll calls official `wall.get` with `offset = page * 10` (`filter=owner`, count 10). A full 10-item page advances `wall:2`, `wall:3`, and so on. A short page stores `wall:done` and later polls only read the latest 10 posts. Newly discovered older posts still get `wall.getComments`. Their comments are not dropped by the unix comments watermark on first sight. User OAuth and community accounts share this wall walker.

## VK wall comment offset (PHASE 41)

After the first 50-comment window (`wallcomments:1`), each later inbox poll calls official `wall.getComments` with `offset = page * 50` (`sort=desc`, count 50) for the current wall posts (latest 10 plus the current wall offset page). A full 50-item raw page on any of those posts advances `wallcomments:2`, `wallcomments:3`, and so on. A short page stores `wallcomments:done` and later polls only read the latest 50 comments per post. Older comment pages are not dropped by the unix comments watermark. Offset is omitted when it is `0`. This is still not a full wall archive in one poll.

## Graph conversation paging (PHASE 42)

Facebook Messenger and Instagram Direct Message collectors follow official Graph `paging.cursors.after` (or `after` on `paging.next`) for `/conversations`. The first page stays `limit=15` with `messages.limit(20)`. If a next `after` exists, the next poll requests that page once. The opaque `after` value is stored base64url-encoded in `threads` so named cursors cannot split on `:` or `|`. A short page stores `threads:done` and later polls only read the latest conversations page. Older-page Direct Messages are not dropped by the `messages` timestamp watermark on first sight. Nested first message pages seed the `threadmsgs` walker in PHASE 45. Collectors do not fetch `paging.next` URLs, so Graph tokens never ride an untrusted next link.

## Graph feed and media paging (PHASE 43)

Facebook Page `/{page-id}/feed` and Instagram `/{ig-user-id}/media` follow the same official Graph `after` walker as conversations. Each poll still reads the latest 10 posts/media items. If a next `after` exists, the next poll requests that page once and stores it base64url-encoded in `posts`. A short page stores `posts:done`. Comments on newly discovered older posts are not dropped by the `comments` timestamp watermark on first sight. Nested first comment pages still seed the `replies` walker in PHASE 44. Collectors still do not fetch `paging.next` URLs.

## Graph nested comment paging (PHASE 44)

Facebook `/{post-id}/comments` and Instagram `/{media-id}/comments` follow official Graph `after` for extra nested comment pages. Graph `after` is per object id, so the named `replies` cursor stores a small `{ objectId: after }` map (base64url JSON, at most 20 ids). The first collect reads nested `comments.paging.cursors.after` from the current feed/media pages. Later polls request `GET /{object-id}/comments?after=` with official fields and `limit=50` for stored ids. The next map is fetched pages that still have `after`, plus newly discovered post/media ids that were not already stored. Stored ids are not reset from the nested first-page `after` (Graph would keep returning that cursor). An empty map stores `replies:done` and later polls stay done. Extra comment-page messages are not dropped by the `comments` timestamp watermark. Collectors still do not fetch `paging.next` URLs.

## Graph nested conversation messages (PHASE 45)

Facebook `/{conversation-id}/messages` and Instagram `/{conversation-id}/messages` follow the same per-object Graph `after` walker as nested comments. The named `threadmsgs` cursor stores `{ conversationId: after }` (base64url JSON, at most 20 ids). The first collect reads nested `messages.paging.cursors.after` from the current conversations pages. Later polls request `GET /{conversation-id}/messages?after=` with official fields and `limit=20`. Extra thread messages are not dropped by the `messages` timestamp watermark. An empty map stores `threadmsgs:done`. Collectors still do not fetch `paging.next` URLs.

## X mention and DM pagination (PHASE 46)

X mentions (`GET /2/users/:id/mentions`) and Direct Messages (`GET /2/dm_events`) follow official `meta.next_token` as `pagination_token`. Each poll still reads the latest page (`max_results=10` mentions, `max_results=50` DMs). Mentions still send `since_id` on the latest page. If a next token exists, the next poll requests that page once on the same constructed endpoint. Opaque tokens are stored base64url-encoded in `mentionpages` and `dmpages` so named cursors cannot split on `:` or `|`. A short page stores `mentionpages:done` / `dmpages:done`. Extra DM pages are not dropped by the `dms` event-id watermark on first sight. Collectors set `pagination_token=` on the official path and do not treat `next_token` as a fetch URL.

## VK newsfeed.search paging (PHASE 47)

VK `newsfeed.search` follows official `next_from` as `start_from`. Each poll still reads the latest 30 posts with `extended=1`. `start_time` still comes from the unix `time` watermark (legacy 10-digit cursors stay the time watermark). If `next_from` exists, the next poll requests that page once. Opaque `start_from` values are stored base64url-encoded in `pages`. A short page stores `pages:done`. Extra-page posts are not dropped by the `time` watermark on first sight. `start_from` is omitted when it is not set.

## X recent search paging (PHASE 48)

X monitoring (`GET /2/tweets/search/recent`) follows official `meta.next_token` as `pagination_token`. Each poll still reads the latest page (`max_results=10`). `since_id` still comes from the `tweets` watermark (legacy numeric cursors stay the tweets watermark). If a next token exists, the next poll requests that page once on the same constructed endpoint. Opaque tokens are stored base64url-encoded in `pages`. A short page stores `pages:done`. Extra-page tweets are not dropped by the `tweets` watermark on first sight. Collectors set `pagination_token=` and do not treat `next_token` as a fetch URL.

## Graph comment-to-comment replies (PHASE 49)

Facebook `/{comment-id}/comments` and Instagram `/{comment-id}/replies` follow official Graph `after` for extra nested replies to comments (not paging of comments on a post — that remains `replies` in PHASE 44). The named `creplies` cursor stores `{ commentId: after }` (base64url JSON, at most 20 ids). Feed/media first pages request nested Facebook `comments.limit(25)` and Instagram `replies`. Extra PHASE 44 post/media comment pages also request those nested edges so newly discovered comments can seed `creplies`. Later polls request `GET /{comment-id}/comments?after=` (Facebook, `limit=25`) or `GET /{comment-id}/replies?after=` (Instagram, `limit=25`) with official fields. Extra nested-reply pages are not dropped by the `comments` timestamp watermark. Stored ids are not reset from the nested first-page `after`. An empty map stores `creplies:done` and later polls stay done. Collectors still do not fetch `paging.next` URLs.

## Social adapters (PHASE 2)

`getSocialAdapter(platform)` is the only place that maps a platform to an implementation. Services must not branch on `platform === "telegram"` (or any other platform).

Encrypted access and refresh tokens are omitted from authenticated `SELECT` on `social_accounts`. Operators, owners, and admins read them through `read_social_account_secrets`.

