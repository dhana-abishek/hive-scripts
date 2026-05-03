# Hive Scripts

A real-time warehouse operations dashboard for managing merchant order flow,
benchmarking pick/pack performance, and forecasting headcount needs.

The app pulls live order data from Metabase (via a Supabase Edge Function),
merges it with uploaded picking/packing benchmarks, and surfaces actionable
views: flow management, aging orders, issues, performance tracking, actual
SPH, reports, and forecasts.

## Tech Stack

- **Frontend:** React 18, TypeScript, Vite, React Router
- **UI:** Tailwind CSS, shadcn/ui (Radix primitives), Lucide icons, Recharts
- **State / Data:** TanStack Query, React Hook Form, Zod
- **Backend:** Supabase (Postgres, Edge Functions)
- **Testing:** Vitest, Testing Library, Playwright
- **Tooling:** ESLint 9, TypeScript ESLint

## Prerequisites

- Node.js 18+
- A Supabase project with the migrations in `supabase/migrations/` applied
- Access to a Metabase instance exposing the CSV endpoint consumed by the
  `fetch-metabase-csv` edge function

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Configure environment variables
cp .env.example .env
# then edit .env with your Supabase project values

# 3. Run the dev server
npm run dev
```

The app will be available at http://localhost:5173.

### Environment Variables

| Variable                        | Description                                   |
| ------------------------------- | --------------------------------------------- |
| `VITE_SUPABASE_PROJECT_ID`      | Your Supabase project ref                     |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase anon (publishable) key               |
| `VITE_SUPABASE_URL`             | Supabase project URL                          |

## Scripts

| Command              | What it does                                |
| -------------------- | ------------------------------------------- |
| `npm run dev`        | Start the Vite dev server                   |
| `npm run build`      | Production build                            |
| `npm run build:dev`  | Build with development-mode optimizations   |
| `npm run preview`    | Preview the production build locally        |
| `npm run lint`       | Run ESLint over the project                 |
| `npm run test`       | Run the Vitest suite once                   |
| `npm run test:watch` | Run Vitest in watch mode                    |

## Project Structure

```
src/
  components/      Feature components (FlowManagementTable, ZoneView, ...)
    ui/            shadcn/ui primitives
    issues/        Issue-tracking subcomponents
  contexts/        React contexts (DashboardContext)
  data/            Static seed data (default benchmarks, etc.)
  hooks/           Data + state hooks (useMetabaseData, useManualBenchmarks)
  integrations/    Supabase client and generated types
  lib/             Utilities (inflow estimation, formatting, ...)
  pages/           Route components (Index, NotFound)
  test/            Test setup and fixtures
  types/           Shared TypeScript types
supabase/
  functions/       Edge functions (fetch-metabase-csv)
  migrations/      SQL migrations
```

## Features

- **Flow Management** — live merchant order volumes, pick/pack hour estimates,
  backlog editing, inflow estimation, and zone-level views (Zone A / Zone B).
- **Hacks** — operational shortcuts and quick adjustments.
- **Aging Orders** — surfaces orders that are sitting too long in the pipeline.
- **Issues** — tracker for known operational issues.
- **Performance** — picking and packing benchmark tables (CSV upload supported)
  plus a per-worker performance tracker.
- **Actual SPH** — shipments-per-hour computed from live data.
- **Reports** — exportable summaries across merchants, zones, and shifts.
- **Forecast** — forward-looking volume forecast with an accuracy view.

## Supabase

Edge function source lives in `supabase/functions/fetch-metabase-csv/`. Deploy
with the Supabase CLI:

```bash
supabase functions deploy fetch-metabase-csv
```

Apply database migrations:

```bash
supabase db push
```

## Testing

```bash
npm run test           # unit tests (Vitest + Testing Library)
npx playwright test    # end-to-end tests
```

## Deployment

Run `npm run build` and serve the `dist/` directory with any static host
(Vercel, Netlify, Cloudflare Pages, S3 + CloudFront, etc.). Make sure the
`VITE_SUPABASE_*` environment variables are set in the hosting environment at
build time.
