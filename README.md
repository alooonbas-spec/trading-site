# Social Hub

Workspace-scoped control plane for multiple social accounts, CRM leads, campaigns, publishing, and monitoring.

## Stack

Next.js App Router, TypeScript strict, Tailwind CSS, shadcn/ui, Supabase/PostgreSQL, Zod, React Hook Form, TanStack Query.

## Setup

1. Copy `.env.example` to `.env.local`.
2. Create a Supabase project and set `NEXT_PUBLIC_SUPABASE_URL` plus `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
3. Apply `supabase/migrations/20260821100000_phase1_foundation.sql` in the Supabase SQL editor, or with the Supabase CLI.
4. Generate `TOKEN_ENCRYPTION_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

5. Install and run:

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

PHASE 1: auth, workspaces, RLS, types, dark-theme navigation.

PHASE 2 will add multi-account social connections.
