# Social Hub

Workspace-scoped control plane for multiple social accounts, CRM leads, campaigns, publishing, and monitoring.

## Stack

Next.js App Router, TypeScript strict, Tailwind CSS, shadcn/ui, Supabase/PostgreSQL, Zod, React Hook Form, TanStack Query.

## Setup

1. Copy `.env.example` to `.env.local`.
2. Create a Supabase project and set `NEXT_PUBLIC_SUPABASE_URL` plus `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
3. Apply migrations in order:
   - `supabase/migrations/20260821100000_phase1_foundation.sql`
   - `supabase/migrations/20260821120000_phase2_social_accounts.sql`
   - `supabase/migrations/20260821140000_phase3_crm.sql`
   - `supabase/migrations/20260821160000_phase4_campaigns.sql`
   - `supabase/migrations/20260821180000_phase5_tinyfish.sql`
   - `supabase/migrations/20260821200000_phase6_posts.sql`
   - `supabase/migrations/20260821220000_phase7_monitoring.sql`
   - `supabase/migrations/20260821240000_phase10_worker.sql`
   - `supabase/migrations/20260821260000_phase13_inbox.sql`
   - `supabase/migrations/20260821280000_phase14_inbox_ui.sql`
   - `supabase/migrations/20260821300000_phase20_inbox_reply.sql`
   - `supabase/migrations/20260822100000_phase73_stale_job_recovery.sql`
4. Generate `TOKEN_ENCRYPTION_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

5. Set `APP_URL` to the public origin (used for OAuth redirect URIs).
6. Set platform OAuth credentials before connecting VK, X, Instagram, or Facebook. Telegram uses a BotFather token and does not need an app secret in env.
7. Set `TINYFISH_API_KEY` (server-only) to enable public profile collection and public monitoring search. Do not prefix it with `NEXT_PUBLIC_`. VK keyword monitoring uses official `newsfeed.search` with a connected account or `VK_SERVICE_TOKEN` and does not require TinyFish.
8. For the background worker, set `SUPABASE_SERVICE_ROLE_KEY` (never `NEXT_PUBLIC_*`) and `CRON_SECRET` or `WORKER_SECRET`. Vercel Cron calls `GET /api/jobs/process` with `Authorization: Bearer $CRON_SECRET`.
9. Register these OAuth redirect URIs with each provider:

- `{APP_URL}/api/social/vk/callback`
- `{APP_URL}/api/social/x/callback`
- `{APP_URL}/api/social/facebook/callback`
- `{APP_URL}/api/social/instagram/callback`

10. Install and run:

```bash
npm install
npm run dev
```

## Checks

```bash
npm run typecheck
npm run lint
npm test
```

Do not put access tokens, refresh tokens, API keys, or session cookies in client code or logs.

## Current phase

PHASE 99: preferredContactStatus symmetry test. The lead-merge conflict resolver was only tested with `BLOCKED` on the right side and never with equal ranks. Tests only, no production code changed.
