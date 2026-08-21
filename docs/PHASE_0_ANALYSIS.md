# PHASE 0 — Project Analysis

## Current stack

`main` is an empty Git tree. The last commit deleted the remaining file (`mql5-macro-compare.bundle`). There is no `package.json`, no Next.js app, no database, and no UI on HEAD.

Historical stack (deleted, not reusable):

- A single `page.tsx` landing page branded “Alpha Capital Platform” (inline styles, no App Router app).
- Branch `claude/mql5-macro-compare-app-qbqtfu`: a Python/Streamlit MQL5 indicator comparison tool.

Neither is a Social Hub codebase.

## Existing architecture

None on `main`. The repository is a greenfield Next.js application as of PHASE 1.

## Existing database

None. No Supabase project config, no migrations, no schema.

## Existing components

None that can be reused for Social Hub.

## Reusable code

Nothing from HEAD. The MQL5 Streamlit app and TinyFish collector on the other branch are a different product (trading indicator history). They must not be copied into Social Hub.

## Missing components

The entire Social Hub surface area:

- Auth, workspaces, RLS
- Multi-account social adapters
- CRM (Lead / Social Profile / Contact Relationship / Interaction)
- Campaigns, queue, workers, rate limits
- TinyFish server-side automation layer
- Publishing, monitoring, analytics

## Potential conflicts

- Repo name and Vercel hostname still refer to `trading-site`. That is naming only; it does not block implementation.
- `.gitignore` from create-next-app ignores `.env*`; `.env.example` is explicitly un-ignored.
- Social Hub is a new product in this repository, not an incremental rewrite of the deleted landing page.

## Implementation plan

Work strictly by phase. PHASE 1 ships the modular-monolith foundation only:

1. Next.js App Router + TypeScript strict + Tailwind + shadcn/ui
2. Supabase auth (SSR cookies, `getClaims` in proxy)
3. Workspace + membership + roles with RLS
4. Domain types and independent status machines
5. Dark-theme shell, sidebar, settings
6. Unit tests for permissions, validation, crypto, error model, and schema invariants

Later phases add social accounts, CRM, campaigns, TinyFish, publishing, monitoring, and analytics on top of this foundation. Do not rewrite PHASE 1 when those land.
