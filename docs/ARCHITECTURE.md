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

## Graph tagged mentions (PHASE 50)

Facebook `GET /{page-id}/tagged` and Instagram `GET /{ig-user-id}/tags` collect posts/media where the connected Page or professional account was tagged. Each poll still reads the latest 10 tagged items. If a next `after` exists, the next poll requests that page once and stores it base64url-encoded in `tagged`. A short page stores `tagged:done`. Extra tagged pages are not dropped by the independent `mentions` timestamp watermark. Photo-only tagged posts without text are skipped as mentions; comments on those posts are still collected in PHASE 56. This is photo/Page tagging, not Instagram @mention webhooks. Outbound mention replies use official `POST /{post-id}/comments` (Facebook) and `POST /{ig-media-id}/comments` (Instagram). Existing Facebook accounts must reconnect to grant `pages_read_user_content`. Collectors still do not fetch `paging.next` URLs.

## VK wall mentions (PHASE 51)

User OAuth inbox calls official `newsfeed.getMentions` (count 20). `start_time` and `end_time` are omitted so VK returns the mention archive rather than the 24-hour default window. After `mentionpages:1`, each later poll requests `offset = page * 20`. A full 20-item page advances `mentionpages:2`. A short page stores `mentionpages:done`. Extra mention pages are not dropped by the independent unix `mentions` watermark. Mention events store `owner:post` ids and `replyKind=mention`. Replies use `wall.createComment` on that post without `reply_to_comment`. Community tokens skip this method (user newsfeed). No new VK OAuth scope.

## VK photo comments (PHASE 52)

User OAuth inbox calls official `photos.getAllComments` (count 50) for comments across albums in one request. `album_id` and `owner_id` are omitted so VK uses all albums of the current user. Offset is omitted when `0`. After `photocomments:1`, each later poll requests `offset = page * 50`. A full 50-item page advances `photocomments:2`. A short page stores `photocomments:done`. Extra photo-comment pages are not dropped by the independent unix `photos` watermark. Events store `photo:{pid}:{commentId}` ids, `replyKind=comment`, and `url=null` (owner id is not in this payload). Replies use official `photos.createComment` with `photo_id` and `reply_to_comment`; `owner_id` is omitted so the comment lands on the current user's photo. Community tokens collect this method in PHASE 67. No new VK OAuth scope.

## VK video comments (PHASE 53)

User OAuth inbox calls official `video.get` (count 10, Added album) then `video.getComments` (count 50, `sort=desc`) for those videos. `owner_id` and `album_id` are omitted on `video.get` so VK uses the current user. Offset is omitted when `0`. After `videos:1`, each later poll requests `video.get` `offset = page * 10`. After `videocomments:1`, each later poll requests `video.getComments` `offset = page * 50` for the current videos. A full page advances `videos:2` / `videocomments:2`. A short page stores `done`. Extra video and comment pages are not dropped by the independent unix `video` watermark. Events store `video:{ownerId}:{videoId}:{commentId}` and `replyKind=comment`. Replies use official `video.createComment` with `owner_id`, `video_id`, and `reply_to_comment`. Community tokens collect these methods in PHASE 68. No new VK OAuth scope (`video` is already granted for publishing).

## VK wall comment threads (PHASE 54)

`wall.getComments` requests official `thread_items_count=10` so each top-level comment includes its first nested replies. Nested replies use the same `{owner}:{post}:{comment}` ids and `wall.createComment` reply path as top-level comments. If `thread.count` is greater than the nested items returned, the next poll requests `wall.getComments` with `comment_id` of that parent (`count=10`, `sort=desc`, `offset = page * 10`). Opaque parent keys are stored base64url-encoded in `wallthreads` (at most 20). A short extra thread page drops that parent. An empty map stores `wallthreads:done` and later polls stay done. Extra thread pages are not dropped by the unix comments watermark. User OAuth and community wall collectors share this walker. Collectors still do not invent a separate thread API.

## VK video comment threads (PHASE 55)

`video.getComments` requests official `thread_items_count=10` so each top-level video comment includes its first nested replies. Nested replies use the same `video:{owner}:{videoId}:{comment}` ids and `video.createComment` reply path. If `thread.count` is greater than the nested items returned, the next poll requests `video.getComments` with `comment_id` of that parent (`count=10`, `sort=desc`, `offset = page * 10`). Parent keys are stored base64url-encoded in `videothreads` (at most 20). An empty map stores `videothreads:done` and later polls stay done. Extra video thread pages are not dropped by the unix `video` watermark. Community tokens walk the same helper in PHASE 68. No new VK OAuth scope.

## Graph comments on tagged posts (PHASE 56)

Facebook `/tagged` and Instagram `/tags` request nested `comments.limit(50)` on the current tagged page. Comments use `replyKind=comment` and the existing Facebook `POST /{comment-id}/comments` / Instagram `POST /{comment-id}/replies` paths. The named `taggedreplies` cursor stores `{ taggedObjectId: after }` (base64url JSON, at most 20 ids) independently of feed/media `replies`. Later polls request `GET /{tagged-id}/comments?after=` (`limit=50`) with official fields. Extra tagged-comment pages are not dropped by the `comments` timestamp watermark. Photo-only tagged posts without caption text still contribute their comments. An empty map stores `taggedreplies:done` and later polls stay done. Nested replies on those tagged comments seed `creplies` in PHASE 57. Collectors still do not fetch `paging.next` URLs.

## Graph nested replies on tagged comments (PHASE 57)

Tagged Facebook comments request nested `comments.limit(25)` and tagged Instagram comments request nested `replies`, the same edges as feed/media in PHASE 49. Extra PHASE 56 tagged-comment pages also request those nested edges so newly discovered tagged comments can seed `creplies`. Later polls still request `GET /{comment-id}/comments?after=` (Facebook, `limit=25`) or `GET /{comment-id}/replies?after=` (Instagram, `limit=25`). Extra nested-reply pages are not dropped by the `comments` timestamp watermark. This reuses the existing `creplies` map rather than a second cursor. Collectors still do not fetch `paging.next` URLs.

## Graph Page ratings (PHASE 58)

Facebook `GET /{page-id}/ratings` collects Page recommendations. Each poll still reads the latest 10 ratings. Reviews without `open_graph_story.id`, a reviewer id, or `review_text` are skipped (no invented ids). Extra rating pages follow official Graph `after`, stored base64url-encoded in `ratings`, independently of the `reviews` timestamp watermark. A short page stores `ratings:done`. Replies use official `POST /{open_graph_story.id}/comments`, the same path as other Facebook comment replies. `pages_read_user_content` is already granted. Instagram has no ratings edge. Comments on those rating stories are collected in PHASE 59. Collectors still do not fetch `paging.next` URLs.

## Graph comments on rating stories (PHASE 59)

Facebook ratings request nested `open_graph_story{id,comments.limit(50){…}}` on the current ratings page. Comments on rating stories use `replyKind=comment` and the existing `POST /{comment-id}/comments` path. The named `ratingreplies` cursor stores `{ storyId: after }` independently of feed `replies` and tagged `taggedreplies`. Later polls request `GET /{story-id}/comments?after=` (`limit=50`). Extra rating-comment pages are not dropped by the `comments` timestamp watermark. Ratings without review text still contribute comments when a story id is present. An empty map stores `ratingreplies:done`. Nested replies on those rating comments seed `creplies` in PHASE 60. Collectors still do not fetch `paging.next` URLs.

## Graph nested replies on rating-story comments (PHASE 60)

Facebook rating-story comments request nested `comments.limit(25)`, the same edge as feed and tagged comments in PHASE 49 and PHASE 57. Extra PHASE 59 rating-comment pages already request that nested edge so newly discovered rating comments can seed `creplies` while that cursor is still open. Later polls still request `GET /{comment-id}/comments?after=` (`limit=25`). Extra nested-reply pages are not dropped by the `comments` timestamp watermark. This reuses the existing `creplies` map rather than a second cursor. A stored `creplies:done` stays done. Instagram has no ratings edge. Collectors still do not fetch `paging.next` URLs.

## VK tagged photo mentions (PHASE 61)

User OAuth inbox calls official `photos.getUserPhotos` (count 20, the documented default). `user_id` is omitted so VK uses the current user. Offset is omitted when `0`. After `userphotos:1`, each later poll requests `offset = page * 20`. A full 20-item page advances `userphotos:2`. A short page stores `userphotos:done`. Extra tagged-photo pages are not dropped by the independent unix `phototags` watermark. Events store `phototag:{ownerId}:{photoId}` ids, `replyKind=mention`, and `https://vk.com/photo{owner}_{id}` URLs. Photo-only tags without text are skipped as mentions (no invented mention body); comments on those photos are collected in PHASE 62. Replies use official `photos.createComment` with `owner_id` and `photo_id` and without `reply_to_comment`. Community tokens skip this method. No new VK OAuth scope (`photos` is already granted).

## VK tagged photo comments (PHASE 62)

User OAuth inbox calls official `photos.getComments` (count 50, `sort=desc`) for the current `photos.getUserPhotos` page. Offset is omitted when `0`. After `userphotocomments:1`, each later poll requests `offset = page * 50` for those tagged photos. Extra comment pages are not dropped by the independent unix `userphoto` watermark. Events store `phototag:{ownerId}:{photoId}:{commentId}` and `replyKind=comment`. Photo-only tags without caption text still contribute their comments. Replies use official `photos.createComment` with `owner_id`, `photo_id`, and `reply_to_comment`. `photos.getComments` has no documented `comment_id` / `thread_items_count` nested-thread fields, so nested photo-comment threads are not walked. Community tokens skip this method. No new VK OAuth scope.

## Graph Facebook Other-folder conversations (PHASE 63)

Facebook Page inbox calls official `GET /{page-id}/conversations?platform=MESSENGER&folder=other` in addition to the default inbox folder (which still omits `folder=`). Each poll still reads the latest Other-folder page (`limit=15`, `messages.limit(20)`). If a next `after` exists, the next poll requests that page once and stores it base64url-encoded in `otherthreads`, independently of inbox `threads`. Extra Other-folder pages are not dropped by the `messages` timestamp watermark. A short page stores `otherthreads:done`. Nested first message pages still seed the existing `threadmsgs` walker. Instagram has no Other folder. Collectors still do not fetch `paging.next` URLs. No new OAuth scope (`pages_messaging` is already granted).

## Graph Facebook Done-folder conversations (PHASE 64)

Facebook Page inbox calls official `GET /{page-id}/conversations?platform=MESSENGER&folder=page_done` for threads marked Done in Page Inbox. Each poll still reads the latest Done-folder page (`limit=15`, `messages.limit(20)`). If a next `after` exists, the next poll requests that page once and stores it base64url-encoded in `donethreads`, independently of inbox `threads` and Other-folder `otherthreads`. Extra Done-folder pages are not dropped by the `messages` timestamp watermark. A short page stores `donethreads:done`. Nested first message pages still seed the existing `threadmsgs` walker. Instagram has no Done folder. Collectors still do not fetch `paging.next` URLs. No new OAuth scope.

## Graph Facebook Pending-folder conversations (PHASE 65)

Facebook Page inbox calls official `GET /{page-id}/conversations?platform=MESSENGER&folder=pending` for threads in the Page Inbox pending folder. Each poll still reads the latest Pending-folder page (`limit=15`, `messages.limit(20)`). If a next `after` exists, the next poll requests that page once and stores it base64url-encoded in `pendingthreads`, independently of inbox `threads`, Other-folder `otherthreads`, and Done-folder `donethreads`. Extra Pending-folder pages are not dropped by the `messages` timestamp watermark. A short page stores `pendingthreads:done`. Nested first message pages still seed the existing `threadmsgs` walker. Instagram has no Pending folder. The default inbox request still omits `folder=`. Collectors still do not fetch `paging.next` URLs. No new OAuth scope (`pages_messaging` is already granted).

## Graph Facebook Spam-folder conversations (PHASE 66)

Facebook Page inbox calls official `GET /{page-id}/conversations?platform=MESSENGER&folder=spam` for threads in the Page Inbox spam folder. Each poll still reads the latest Spam-folder page (`limit=15`, `messages.limit(20)`). If a next `after` exists, the next poll requests that page once and stores it base64url-encoded in `spamthreads`, independently of inbox `threads`, Other-folder `otherthreads`, Done-folder `donethreads`, and Pending-folder `pendingthreads`. Extra Spam-folder pages are not dropped by the `messages` timestamp watermark. A short page stores `spamthreads:done`. Nested first message pages still seed the existing `threadmsgs` walker. Instagram has no Spam folder. The default inbox request still omits `folder=`. Collectors still do not fetch `paging.next` URLs. No new OAuth scope (`pages_messaging` is already granted).

## Isolated VK community photo comments (PHASE 67)

Community inbox calls official `photos.getAllComments` (count 50) with `owner_id=-groupId`. Offset is omitted when `0`. After `photocomments:1`, later polls request `offset = page * 50`. Extra photo-comment pages are not dropped by the independent unix `photos` watermark. Events store `photo:{pid}:{commentId}` and `replyKind=comment`. Community replies use `photos.createComment` with `owner_id`, `photo_id`, and `reply_to_comment`. User OAuth still omits `owner_id`. If VK returns error **7** (permission) or **27** (method unavailable with group auth), that photo collector is skipped and wall comments plus community Direct Messages still collect; `photocomments` / `photos` keys are omitted so a later token with photos permission can retry. Errors **5**, **15**, and **17** still fail the collect as authentication. No new SQL.

## Isolated VK community video comments (PHASE 68)

Community inbox calls official `video.get` (count 10) then `video.getComments` (count 50, `sort=desc`, `thread_items_count=10`) with `owner_id=-groupId`. `album_id` is omitted. Offset is omitted when `0`. After `videos:1`, later polls request `video.get` `offset = page * 10`. After `videocomments:1`, later polls request `video.getComments` `offset = page * 50` for the current community videos. Extra video-comment pages are not dropped by the independent unix `video` watermark. Events store `video:{ownerId}:{videoId}:{commentId}` (negative community owner) and `replyKind=comment`. Nested first-page replies reuse the PHASE 55 `videothreads` walker. User OAuth still omits `owner_id` / `album_id` on `video.get`. If VK returns error **7** or **27** on `video.get`, that video collector is skipped and wall comments, community Direct Messages, and isolated photo comments still collect; `video` / `videocomments` / `videos` / `videothreads` keys are omitted so a later token with video permission can retry. If `video.get` succeeds but `video.getComments` returns 7/27 for a video, that video's comments are skipped without failing the collect. Errors **5**, **15**, and **17** still fail the collect as authentication. Replies reuse `video.createComment` with `owner_id` from the stored id. No new SQL.

## Isolated VK community board comments (PHASE 69)

Community inbox calls official `board.getTopics` (count 10) then `board.getComments` (count 50, `sort=desc`) with positive `group_id`. Offset is omitted when `0`. After `boardtopics:1`, later polls request `board.getTopics` `offset = page * 10`. After `boardcomments:1`, later polls request `board.getComments` `offset = page * 50` for the current topics. Extra board-comment pages are not dropped by the independent unix `board` watermark. Events store `board:{groupId}:{topicId}:{commentId}` and `replyKind=comment`, with `https://vk.com/topic-{groupId}_{topicId}?post={commentId}` URLs. Community comments from the group (`from_id=-groupId`) are skipped. User OAuth inbox does not call board methods. If VK returns error **7** or **27** on `board.getTopics`, that board collector is skipped and wall comments, community Direct Messages, photos, and video still collect; `board` / `boardcomments` / `boardtopics` keys are omitted so a later token with board permission can retry. If `board.getTopics` succeeds but `board.getComments` returns 7/27 for a topic, that topic's comments are skipped without failing the collect. Errors **5**, **15**, and **17** still fail the collect as authentication. Replies use official `board.createComment` with `group_id`, `topic_id`, `message`, and `from_group=1`. `board.getComments` has no documented nested-thread walker, so board comment threads are not walked. No new SQL.

## Isolated VK community market comments (PHASE 70)

Community inbox calls official `market.get` (count 10) then `market.getComments` (count 50, `sort=desc`) with `owner_id=-groupId`. `album_id` is omitted so the community catalog is listed as a whole. Offset is omitted when `0`. After `marketitems:1`, later polls request `market.get` `offset = page * 10`. After `marketcomments:1`, later polls request `market.getComments` `offset = page * 50` for the current items. Extra market-comment pages are not dropped by the independent unix `market` watermark. Events store `market:{ownerId}:{itemId}:{commentId}` (negative community owner) and `replyKind=comment`, with `https://vk.com/market{owner}_{item}?reply={commentId}` URLs. Community comments from the group (`from_id=-groupId`) are skipped. User OAuth inbox does not call market methods, and `market` is not added to `VK_SCOPES` (that user scope is exceptional). If VK returns error **7** or **27** on `market.get`, that market collector is skipped and wall comments, community Direct Messages, photos, video, and board still collect; `market` / `marketcomments` / `marketitems` keys are omitted so a later token with market permission can retry. If `market.get` succeeds but `market.getComments` returns 7/27 for an item, that item's comments are skipped without failing the collect. Errors **5**, **15**, and **17** still fail the collect as authentication. Replies use official `market.createComment` with `owner_id`, `item_id`, `reply_to_comment`, `message`, and `from_group=1` for community tokens. No new SQL.

## Graph Facebook Page videos comments (PHASE 71)

Facebook Page inbox calls official `GET /{page-id}/videos` (`limit=10`) with nested `comments.limit(50)` and nested reply `comments.limit(25)`. The Page's own video captions are not stored as inbox mentions. Extra video pages follow official Graph `after`, stored base64url-encoded in `videos`, independently of feed `posts`. Extra comments on those videos follow `GET /{video-id}/comments?after=` (`limit=50`) using the named `videoreplies` map, independently of feed `replies` and tagged `taggedreplies`. Extra video pages and extra video-comment pages are not dropped by the comments watermark. Nested first-page replies seed the existing `creplies` walker. A short videos page stores `videos:done`. An empty map stores `videoreplies:done`. A stored `videoreplies:done` stays done. Collectors still do not fetch `paging.next` URLs. Replies reuse official `POST /{comment-id}/comments`. Instagram is unchanged (`/{ig-user-id}/media` already includes video and Reel comments). No new OAuth scope (`pages_read_engagement` is already granted). No new SQL.

## Graph Facebook Page photos comments (PHASE 72)

Facebook Page inbox calls official `GET /{page-id}/photos?type=uploaded` (`limit=10`) with nested `comments.limit(50)` and nested reply `comments.limit(25)`, the same shape as PHASE 71 videos. `type=uploaded` keeps this to the Page's own uploaded photos, not photos it was tagged in (that stays PHASE 50 `tagged`). Extra photo pages follow official Graph `after`, stored base64url-encoded in `photos`, independently of feed `posts` and video `videos`. Extra comments on those photos follow `GET /{photo-id}/comments?after=` (`limit=50`) using the named `photoreplies` map, independently of feed `replies`, tagged `taggedreplies`, rating `ratingreplies`, and video `videoreplies`. Extra photo pages and extra photo-comment pages are not dropped by the comments watermark. Nested first-page replies seed the existing `creplies` walker. A short photos page stores `photos:done`. An empty map stores `photoreplies:done`. A stored `photoreplies:done` stays done. Collectors still do not fetch `paging.next` URLs. Replies reuse official `POST /{comment-id}/comments`. Instagram is unchanged (`/{ig-user-id}/media` already includes photo comments). No new OAuth scope (`pages_read_engagement` is already granted). No new SQL.

## Stale job recovery (PHASE 73)

`claim_jobs` and `claim_due_jobs` used to claim only `PENDING`/`RETRY` jobs. A worker that crashed or timed out mid-job (a serverless function hitting its execution limit, an OOM kill) left that job `RUNNING` forever: `locked_at` stayed in the past, `attempts` was never re-evaluated by `jobStatusAfterError` (that only runs from a caught JS exception, PHASE 10's `failOrRetry`), and no later poll could ever claim it again.

Both claim functions now also reclaim a `RUNNING` job once its lock is older than 15 minutes, as long as `attempts < max_attempts` — the same budget `jobStatusAfterError` already enforces for a normal retry. Reclaiming a stale job increments `attempts` and re-locks it exactly like a fresh claim; the platform action then runs again from `processClaimedJob`, so this reuses the existing retry path rather than adding a second one. A job that crashes on its very last allowed attempt is not reclaimed and stays `RUNNING` and stale; `locked_at` makes that state visible to an operator. `claim_jobs` keeps its workspace scope and `FOR UPDATE SKIP LOCKED`; `claim_due_jobs` stays `service_role`-only. No API or UI change; no do_not_contact touch.

## Stale job visibility (PHASE 74)

The Jobs page now shows a "Stale" badge next to a job's status when it is `RUNNING` and its lock (`locked_at`) is at least 15 minutes old, the same threshold PHASE 73 uses to reclaim it. `Job` now carries `lockedAt`; `isStaleRunningJob(status, lockedAt, now)` in `lib/jobs/status.ts` is the shared, unit-tested predicate (`STALE_RUNNING_JOB_MS` in `lib/jobs/queue-rules.ts` is the single source for the threshold both PHASE 73's SQL comment and this check reference). This is read-only: it does not add a cancel path for `RUNNING` jobs, so there is no new race with a worker that is still legitimately finishing. `locked_at` was added to `JOB_PUBLIC_COLUMNS`; every existing `toJob()` caller already selects that column set, so this needed no other query changes.

## Stale job cancel (PHASE 75)

`cancelQueuedJob` now also accepts a stale `RUNNING` job (PHASE 74's same `isStaleRunningJob` predicate), not only `PENDING`/`RETRY`. The `UPDATE` re-checks `status = 'RUNNING' and locked_at < <threshold computed at call time>` instead of trusting the value already read into `job`, so a worker that finishes between the read and the cancel simply leaves the row no longer matching — the cancel becomes a no-op rather than clobbering a real result, the same silent-no-op behavior the existing PENDING/RETRY path already has for a job someone else already touched. `JobListItem.canCancel` is `canCancelJob(status) || isStale`, so the Jobs page "Cancel" button now also appears next to the PHASE 74 "Stale" badge. Cancel activity records `stale: true|false` in its metadata; no new SQL, no new activity action.

## Validation schema test coverage (PHASE 76)

An audit of every `lib/validation/*.ts` schema against `tests/*.ts` found several boundary schemas with no direct unit test: `createCampaignSchema`, and from `lib/validation/lead.ts` — `createSocialProfileSchema`, `createRelationshipSchema`, `createNoteSchema`, `mergeLeadsSchema`, `collectPublicProfileSchema`, `updateLeadSchema` — plus `parseScheduledAt` (post) and `parseSourceList` (monitoring) and `emptyToNull` (lead mapper). They were exercised only indirectly through whatever service called them, never asserted on directly. Tests only, no production code changed: each schema now has its own accept/reject cases in the existing `tests/campaigns.test.ts`, `tests/crm.test.ts`, `tests/phase6-posts.test.ts`, and `tests/phase7-monitoring.test.ts`.

## OAuth state expiry as a tested function (PHASE 77)

`completeOAuthConnect` rejected an expired `oauth_states` row inline (`new Date(oauthState.expires_at).getTime() <= Date.now()`), a security check (this is the anti-replay window for the 10-minute-lived state `startOAuthConnect` writes) with no direct unit test. `isOAuthStateExpired(expiresAt, now = new Date())` in `lib/social/pkce.ts` is the same comparison as a pure, injectable-time function; `oauth-service.ts` now calls it instead of inlining `Date.now()`. Same boundary as before (`<=`, not `<`) — tested exactly at, one millisecond before, and one millisecond after expiry.

## More validation and token-encryption test coverage (PHASE 78)

Continuing the PHASE 76/77 audit: `updateWorkspaceSchema`, `updateMemberRoleSchema`, and `removeMemberSchema` in `lib/validation/workspace.ts` had no direct test (only `createWorkspaceSchema` and `inviteMemberSchema` did). `encryptConnectResult` in `services/social-accounts/mapper.ts` — the wrapper that encrypts an OAuth connect result's access/refresh tokens before they reach `social_accounts`, and turns a missing `TOKEN_ENCRYPTION_KEY` into a `ValidationError` instead of an opaque crash — had no test at all despite being on the token-handling path. Tests only, no production code changed.

## Full role-permission test coverage (PHASE 79)

`lib/auth/permissions.ts` is the one place that maps a `WorkspaceRole` to what it can do, and every service's `assertCanMutateWorkspaceData` / `assertCanManageWorkspace` call traces back to it — but `roleRank`, `canManageWorkspace`, `assertCanManageWorkspace`, and `assertCanMutateWorkspaceData` had no direct test, and the functions that did have one were checked on 1–2 roles, not all four. Tests only, no production code changed: every predicate and assert function is now checked against all four roles (`OWNER`, `ADMIN`, `OPERATOR`, `VIEWER`), plus a check that `roleRank` gives each role a distinct rank in the documented order.

## Telegram discussion-group comments (PHASE 80)

A comment on a channel post lands in the linked discussion supergroup as an ordinary `message` update whose `reply_to_message.is_automatic_forward` is `true` — that field marks the parent as the automatically-forwarded copy of the channel post, so a reply to it is unambiguously a genuine comment, not a random group message. `isTelegramDiscussionComment(chatType, replyToMessage)` in `social/telegram/updates.ts` is that check; `parseTelegramUpdates` now collects those messages into the same inbox stream as private DMs, tagged `replyKind: "comment"`, using the same shared `update_id` cursor PHASE 15 already established (no new named cursor). This needs no new metadata field and no settings UI: like private DMs, it works for any supergroup the bot happens to be a member of.

This is intentionally narrow: only a reply that points directly at the automatic forward is collected. A reply to another comment further down the same discussion thread does not carry that link (Telegram gives no other documented way to tell a discussion reply from an unrelated forum-topic reply, which shares the same `message_thread_id` mechanism) and is not walked in this phase — the same kind of stated limitation as VK's un-walked photo/board comment threads. Outbound replies stay `UnsupportedActionError`: `InboxReplyInput.target` carries a sender's profile id, not the discussion group's chat id, so Telegram cannot resolve where a comment reply belongs without a new reply-target field; only `direct_message` sends still work. Ordinary (non-reply, non-supergroup) group chatter and the automatic-forward message itself are still not collected. No new SQL.

## errorMessage and AppError test coverage (PHASE 81)

`errorMessage(error, fallback)` decides what text every server action shows an operator on failure and is called from nearly every service in the codebase, but had no direct test for any of its four branches (AppError, plain Error, message-bearing plain object, fallback). Half the `AppError` subclasses (`AuthenticationError`, `SocialError`, `UnsupportedActionError`, `NetworkError`, `ValidationError`) and the `AppError` base constructor itself (default status, `details`, `cause`) were untested too. Tests only, no production code changed.

## Logger redaction test coverage (PHASE 82)

`logger.redact` is what keeps tokens and secrets out of `activity_log` metadata and server logs (PHASE 25), but only its flat top-level case had a test. Nested objects, arrays of objects (an account list with a token per entry), case-insensitive matching (`PASSWORD`, `Authorization`, `Cookie`), and the `info`/`warn`/`error` level routing itself were all untested. Tests only, no production code changed.

## Keyset cursor injection test (PHASE 83)

`keysetOrFilter` interpolates `cursor.id` and `cursor.at` straight into a PostgREST `or=` filter string (`id.lt.<id>,created_at.eq."<at>"`) with no further escaping — every list page passes it whatever `parseKeysetCursor` returns from the fully attacker-controlled `after=` query parameter. `parseKeysetCursor`'s `z.uuid()` / strict ISO-instant schema is the only thing stopping a comma or quote in `id`/`at` from injecting extra PostgREST filter clauses (e.g. `id: "1,or(role.eq.OWNER)"`). This was previously tested only against obviously-malformed cursors, not against a cursor deliberately shaped to break out of the filter string. Tests only, no production code changed — the schema already rejected these; there was just no test pinning that down.

## Inbox cursor helper test coverage (PHASE 84)

`lib/inbox/cursor.ts` is the shared watermark/dedup logic every platform's inbox collector builds on (Facebook, Instagram, VK, X, Telegram), but it was only exercised indirectly through those adapters' end-to-end tests — half its functions (`isNamedInboxCursor`, `isDigitIdAfter`, `parseInboxTimestampMs`, `laterTimestampString`, `laterNamedValue`, `isReceivedAfterCursor`, `newestReceivedAt`, `uniqueInboxMessages`) had no test that called them directly. New `tests/inbox-cursor.test.ts` covers each one's actual boundary cases (BigInt-precision id comparison, the 10-digit-unix-seconds vs. ISO timestamp split, a Graph-style `+0000` offset with no colon, permissive fallbacks when a side is missing or unparseable). Tests only, no production code changed.

## Publish-destination key allowlist test (PHASE 85)

`isPublishDestinationKey` is the allowlist `updateSocialAccountPublishDestination` checks every metadata key against before writing it (`pageId`, `publishOwnerId`, `publishChatId` — the Facebook Page, VK community wall, and Telegram chat targets), rejecting anything else, but had no direct test. Tests only, no production code changed.

## Media classification test coverage (PHASE 86)

`classifyMediaUrl` decides what a post/publish media URL is (photo/gif/video/document) and its outbound mime type before any adapter uploads it, but its content-type branch (`MIME_TO_KIND`), its rejection of an unclassifiable URL, and several extension-to-mime-type mappings (`.png` vs `.webp` vs `.jpeg`, `.webm` vs `.mov`, `.zip` vs `.pdf`) had no test — only one extension per kind was ever checked. `fileExtension` itself (query strings, missing extensions, an unparseable source, case-folding) also had no direct test. Tests only, no production code changed.

## normalizeKeywords test coverage (PHASE 87)

`normalizeKeywords` underlies both `parseKeywordList` and `matchKeywords` — it dedupes case-insensitively while keeping the first-seen casing, a detail easy to break silently in a refactor — but had no direct test of its own. Tests only, no production code changed.

## oauthCallbackPath test (PHASE 88)

`oauthCallbackPath` builds the redirect path that must exactly match what's registered with each OAuth provider (README's "Register these OAuth redirect URIs" list); had no direct test. Tests only, no production code changed.

## withUpdateStreamCursor test (PHASE 89)

`withUpdateStreamCursor` is what keeps `updateStreamCursor` and `inboxCursor` written in sync on a Telegram account's metadata (PHASE 15's "kept in sync" invariant, consumed by `worker-service.ts`), but had no direct test — only the two read-side helpers (`laterUpdateStreamCursor`, `updateStreamCursorFromMetadata`) did. Tests only, no production code changed.

## downloadPublicMedia SSRF and size-limit test coverage (PHASE 90)

`downloadPublicMedia` is the media pipeline every VK/X publish call feeds a public URL through before uploading it to the platform — it had no direct test at all, only indirect coverage through publish end-to-end tests that never exercised its redirect or size-limit branches. New `tests/media-download.test.ts` pins down the parts that matter most: `assertPublicMediaHost` runs again on every redirect hop, not just the first URL, so a public URL that redirects to `169.254.169.254` (the cloud-provider instance-metadata endpoint) is refused mid-chain; `MAX_REDIRECTS` bounds the chain; and the size limit is enforced twice — once from a declared `content-length` before the body is read, and again from the actual downloaded size, so a response that under-declares its `content-length` still gets rejected. Tests only, no production code changed.

## SSRF guard boundary test coverage (PHASE 91)

`isPrivateOrLocalIp` and `parsePublicMediaUrl` (PHASE 90's underlying host guard) were checked on only a couple of obvious cases. New tests cover the ones most likely to matter in practice: the cloud instance-metadata IP `169.254.169.254`, the exact CIDR edges of the `172.16.0.0/12` private range (`172.15.255.255` public, `172.16.0.0` private, `172.31.255.255` private, `172.32.0.0` public), IPv6 loopback/link-local/unique-local addresses including an IPv4-mapped `::ffff:127.0.0.1`, the `metadata.google.internal` / `.internal` / `.local` hostname blocks, and rejection of non-http(s) schemes. Tests only, no production code changed.

## TinyFish policy word-order fix (PHASE 92)

Writing boundary tests for `isTinyFishGoalAllowed` (PHASE 5's safety policy) surfaced a real bypass: the rate-limit/evasion patterns only matched one word order (`rate limit ... bypass|circumvent|ignore|disable`, `evade ... rate limit|captcha|bot`), so a goal phrased the other way around — "circumvent the rate limit", "disable the rate limit" — slipped through untouched, even though the semantically identical "rate limit circumvent" was already blocked. Only the `bypass` pattern was already symmetric (matched both word orders).

`CIRCUMVENTION_VERBS` and `PROTECTION_TARGETS` in `lib/tinyfish/policy.ts` now generate two symmetric patterns (verb-then-target, target-then-verb) covering `bypass|circumvent|evade|evasion|ignore|disable` against `bot|anti-bot|cloudflare|captcha|rate-limit|429`, replacing five ad-hoc, partly one-directional patterns. `circumvent` also gained its `-ing/-ed/-ion` inflections, matching the `evad(e|ing|es)` handling the code already had for evade. This is a real fix, not test-only — `assertTinyFishGoalAllowed("circumvent the rate limit")` now throws where it previously did not.

## Graph API access_token URL redaction fix (PHASE 93)

`redactSensitiveUrl` only stripped Telegram's bot token from the URL path; it did nothing for Facebook and Instagram Graph calls, which carry `access_token` as a query parameter on nearly every request (`social/facebook/inbox.ts`, `pages.ts`, `contact.ts`; `social/instagram/inbox.ts`, `publish.ts`, `contact.ts`, `adapter.ts`). A failed Graph request throws `SocialError` with `details: { url: redactSensitiveUrl(url), status }` — so a non-2xx response from either platform previously carried a live, unredacted access token straight into that error's details, and from there into anything that logs or serializes it, directly against README's "Do not put access tokens... in logs." VK and X were never affected: VK sends its token in the POST body, X in an `Authorization` header, neither in the URL.

`redactSensitiveUrl` now also redacts `access_token=<value>` wherever it appears in the query string, first, middle, or only parameter, leaving everything else in the URL untouched. Real fix, not test-only.

## Official monitor source allowlist test coverage (PHASE 94)

`assertMonitorSourcesAllowed` / `isOfficialMonitorHost` gate what hosts TinyFish is ever pointed at for a monitoring rule, but only checked the single primary domain per platform. New tests cover every documented mobile/regional alias (`fb.com`, `m.facebook.com`, `telegram.dog`, `vk.ru`, `mobile.twitter.com`, `m.instagram.com`, ...), that `www.` and case are normalized before matching, that a bare domain with no scheme still resolves, that a lookalike host (`t.me.evil.example`, `evil-t.me`) does not pass exact-match, and that a blank or unparseable source is rejected rather than silently skipped. Tests only, no production code changed — the allowlist already enforced all of this correctly.

## TinyFish config and default-purpose test coverage (PHASE 95)

`isTinyFishConfigured` / `readTinyFishApiKey` had no direct test. Also added a regression guard: `SAFE_FETCH_PURPOSE` and `SAFE_SEARCH_PURPOSE` (the default purposes every TinyFish call sends) must never trip `isTinyFishGoalAllowed` themselves — nothing enforced that invariant before, so a future policy-pattern edit widened without care could have silently broken every TinyFish call by blocking the system's own default purpose text. Tests only, no production code changed.

## Campaign status machine and retry backoff test coverage (PHASE 96)

`canPauseCampaign`, `canCancelCampaign`, and `retryDelayMs` had no direct test — only `canStartCampaign` did, even though all four sit right next to each other in `lib/jobs/queue-rules.ts` and the pause/cancel machine gates the same Campaigns UI actions. `getTokenEncryptionKey` (the env-backed counterpart to PHASE 78's `encryptConnectResult`) also had none. Tests only, no production code changed.

## AccountRateLimiter boundary test coverage (PHASE 97)

`AccountRateLimiter.take` had two untested branches: the exact boundary (`count === maxActions` should pass, only strictly-over throws) and the "rate limit disabled" guard (`maxActions < 1` throws `RateLimitError` without even calling the consume callback — meaning a misconfigured adapter with a zero/negative limit fails closed instead of skipping the check). Tests only, no production code changed.

## DNS-rebinding guard test coverage (PHASE 98)

`assertPublicMediaHost` is what PHASE 90's `downloadPublicMedia` calls on every hop of a redirect chain to stop SSRF — but its actual DNS-rebinding branch (a hostname that passes the `parsePublicMediaUrl` name checks yet resolves to a private/link-local address) had no direct test; PHASE 90/91 only exercised the raw-IP and hostname-blocklist paths, which never call DNS at all. New `tests/media-public-url.test.ts` mocks `node:dns/promises` to test the real lookup branch in isolation: a hostname resolving only to public IPs is allowed, one resolving to a private IP (including the cloud metadata address) or to no records at all is rejected, and a mixed record set is rejected if even one address is private. The mock is scoped to this file only — confirmed the existing real-DNS tests in `media-download.test.ts` still pass unaffected. Tests only, no production code changed.

## preferredContactStatus symmetry test (PHASE 99)

`preferredContactStatus` (the lead-merge conflict resolver in `mergeLeads`'s `reassignRelationships`) was only tested with `BLOCKED` on the right side and never with equal ranks; `BLOCKED` as the left argument and the `left === right` boundary had no test. Tests only, no production code changed.

## VK thread-paging test coverage (PHASE 100)

`social/vk/thread-paging.ts` is the merge/watermark logic behind PHASE 54/55's VK wall and video nested-comment-thread walkers, structurally the VK counterpart to Facebook's `graph-paging.ts` (already covered directly since early phases) — but it had never been tested directly, only indirectly through the two adapter end-to-end tests. New `tests/vk-thread-paging.test.ts` covers `encodeVkThreadMap`/`decodeVkThreadMap` round-tripping and its filtering (malformed thread id, non-numeric or zero page, the `VK_THREAD_FETCH_LIMIT` cap), `parseVkThreadId`, and every branch of `nextVkThreadCursor`'s merge (a stored-but-unfetched thread survives untouched, a fetched thread's page updates to its new next-after, an exhausted fetched thread is dropped, a newly discovered thread is added, and stale `nestedAfters` cannot resurrect an already-stored thread). All 15 cases passed on the first run — this is coverage confirming already-correct logic, not a bug fix. Tests only, no production code changed.

## Telegram sendMediaGroup GIF fix (PHASE 101)

`buildTelegramMediaPayload` in `social/telegram/media.ts` already blocked mixing documents with photos/videos in a `sendMediaGroup` call, but let GIFs through into a group untouched. Per the Telegram Bot API, `sendMediaGroup`'s `media` array only accepts `InputMediaAudio`, `InputMediaDocument`, `InputMediaPhoto`, and `InputMediaVideo` — `InputMediaAnimation` has no group form at all, unlike documents, which are merely barred from mixing with other kinds. A post with a GIF plus any other media (even a second GIF) would previously have built a `sendMediaGroup` payload containing an `animation`-typed entry that Telegram's API rejects outright.

`buildTelegramMediaPayload` now throws `ValidationError` whenever a GIF is present and `items.length > 1`, before the existing document-mixing check runs. Real fix, not test-only — `tests/phase11-media.test.ts` gained cases for a valid photo+video group, a GIF grouped with any other media (including a second GIF), and a document grouped with a photo/video.

## Facebook pages/people permalink fix (PHASE 102)

`resolveFacebookPublicProfile` (`social/facebook/public-profile.ts`) rejects a fixed set of known non-profile path segments (`watch`, `groups`, `photo.php`, ...) but was missing Facebook's own `pages/<name>/<id>` and `people/<name>/<id>` permalink formats. For those URLs, `firstPathSegment` returns the reserved word itself (`pages` or `people`), which was not in `REJECTED_FACEBOOK_PATHS` and happens to also satisfy `FACEBOOK_USERNAME`'s regex — so instead of throwing, the function silently returned a bogus `PublicProfileRef` with `externalProfileId: "pages"` / `"people"`, pointing at `https://www.facebook.com/pages`, a URL that identifies no real profile.

Added `"pages"` and `"people"` to `REJECTED_FACEBOOK_PATHS`. Real fix, not test-only — new cases in `tests/phase5-tinyfish.test.ts` assert both permalink shapes now throw `ValidationError` instead of resolving.

## VK content-permalink fix (PHASE 103)

Same root cause as PHASE 102, different platform: `resolveVkPublicProfile` (`social/vk/public-profile.ts`) rejects a fixed set of bare reserved words (`feed`, `im`, `video`, ...), but VK's own content permalinks combine a reserved word directly with an id, e.g. `wall<ownerId>_<postId>`, `photo<ownerId>_<itemId>`, `video<ownerId>_<itemId>` (owner id negative for a community, e.g. `wall-1_2`) — for `board`, `market`, `album`, `docs`, `audio`, and `clip` too. `REJECTED_VK_PATHS` only ever matched the bare word, so the combined segment (`"wall123_456"`) sailed past it, then satisfied `VK_SCREEN_NAME`'s regex (alnum + underscore, 3-32 chars) and was treated as a real screen name — resolving a wall-post/photo/video permalink to a nonexistent profile.

Added `VK_PERMALINK_PATTERN` (`/^(?:wall|photo|video|board|market|album|docs|audio|clip)-?\d+_\d+$/i`) and reject a segment matching it, alongside the existing bare-word check. A screen name that merely starts with one of those words but isn't the full `<word><id>_<id>` shape (e.g. `wallpaper_studio`) is unaffected. Real fix, not test-only — new cases in `tests/phase5-tinyfish.test.ts`.

## decodeXPageToken test coverage (PHASE 104)

`social/x/paging.ts`'s `decodeXPageToken` had no direct test, only indirect coverage through `nextXPageCursor` and the adapter pagination tests. Writing a boundary test first ("garbage input decodes to null") surfaced that `Buffer.from(value, "base64url")` never throws on invalid characters — it silently drops them and decodes whatever bytes remain, so the function's `try/catch` is effectively dead code and a string like `"not-valid-base64url!!!"` decodes to garbage bytes rather than `null`. This is not a bug to fix: `decodeXPageToken`'s output is X's own opaque `pagination_token`, which has no structure of ours to validate (unlike VK's `ownerId_postId_commentId` shape or the JSON thread map), so passing a corrupted stored cursor through to X's API and letting X's API reject it is the correct, existing behavior. New `tests/phase46-x-pagination.test.ts` cases cover the round-trip, the `undefined`/`"done"`/blank-string no-cursor cases, and the one input that genuinely decodes to nothing (a string made entirely of non-base64url characters). Tests only, no production code changed.

## classifyMediaUrl bmp/tiff mimeType fix (PHASE 105)

`classifyMediaUrl`'s (`lib/media/classify.ts`) extension-based mimeType fallback (used whenever a `Content-Type` header isn't available) only special-cased `png` and `webp`; every other extension in `PHOTO_EXTENSIONS` — including `bmp`, `tif`, and `tiff` — silently fell through to `image/jpeg`. That mimeType then feeds platform-side validation: Instagram's `planInstagramPublish` (`social/instagram/publish.ts`) rejects any image whose `mimeType` isn't exactly `image/jpeg` or `image/png`, so a `.bmp` or `.tiff` URL — which Instagram does not actually support — previously slipped past that check mislabeled as `image/jpeg`, only to fail later during Instagram's own upload/processing with no clear signal why. The `Content-Type`-based path (`MIME_TO_KIND`) already had correct, separate entries for `image/bmp` and `image/tiff`; only the extension-inference fallback had the bug.

Replaced the `PHOTO_EXTENSIONS` set and its inline ternary with a `PHOTO_EXTENSION_MIME` lookup table giving every photo extension its own correct mimeType. Real fix, not test-only — new cases in `tests/phase11-media.test.ts` assert `.bmp`/`.tif`/`.tiff` now classify as `image/bmp`/`image/tiff` rather than `image/jpeg`.

## deriveTokenStatus boundary test coverage (PHASE 106)

`deriveTokenStatus` (`lib/social/account-health.ts`) gates whether `prepareAccountAdapter` treats a social account's stored access token as usable or forces a refresh first — but only 3 of its 6 branches had a direct test (`CONNECTED` with no expiry, an already-past `tokenExpiresAt`, and `DISCONNECTED`). `REAUTH_REQUIRED`, `ERROR`, and the `EXPIRED` status itself had no test confirming they pass straight through regardless of `tokenExpiresAt`, nor did the exact `tokenExpiresAt === now` boundary (must already read as `EXPIRED`, not `CONNECTED`) or `isAccountOperable("ERROR")`. All new cases passed on the first run — this is coverage confirming already-correct logic, not a bug fix. Tests only, no production code changed.

## uploadXMediaFromUrls test coverage (PHASE 107)

`social/x/media-upload.ts`'s `uploadXMediaFromUrls` (its item-count/mixed-kind/document validation) and `uploadXMedia`'s chunked-append loop had zero direct test coverage — only a single-image, single-chunk path was exercised end-to-end through `XAdapter.publish` in the existing "X media publishing" test. New cases cover: a video larger than `X_APPEND_CHUNK_BYTES` (4 MiB) splits into the correct number of `append` calls with the correct `segment_index` and byte length per chunk (verified against a 5 MiB buffer: a 4 MiB chunk followed by a 1 MiB remainder); more than 4 media items, mixed image+video, two videos, two GIFs, and any PDF/ZIP document are all rejected with `ValidationError`. All cases passed on the first run — coverage confirming already-correct logic, not a bug fix. Tests only, no production code changed.

## Social adapters (PHASE 2)

`getSocialAdapter(platform)` is the only place that maps a platform to an implementation. Services must not branch on `platform === "telegram"` (or any other platform).

Encrypted access and refresh tokens are omitted from authenticated `SELECT` on `social_accounts`. Operators, owners, and admins read them through `read_social_account_secrets`.

