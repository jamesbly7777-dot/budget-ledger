# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: Firebase Firestore (ledger app)
- **Build**: esbuild (CJS bundle) for api-server, Vite for ledger-app

## Artifacts

### Budget Ledger App (`artifacts/ledger-app`)
- **Preview path**: `/`
- **Type**: React + Vite PWA (installable on mobile)
- **Backend**: Firebase Firestore + Firebase Auth, + Express API server for AI features
- **Features**:
  - Dark fintech UI (mobile-first, Bloomberg terminal aesthetic)
  - PWA (installable on phone via "Add to Home Screen")
  - Monthly ledger system (transactions, bills, months)
  - Rules engine (auto-categorization: Bills, Fuel, Necessary, Medical, Shopping, Transfers, Personal, Waste)
  - CSV import with preview, duplicate detection, rules engine
  - AI vision import — upload a bank statement screenshot → GPT-4o extracts transactions
  - Analytics with Recharts (category totals, monthly trends)
  - Rules management UI with test tool
  - Export CSV for current month
- **Firebase project**: full-ledger-app
- **Auth**: Email/password via Firebase Auth
- **Firestore structure**: `users/{userId}/{transactions|bills|months|rules}`
- **Vite proxy**: `/api/` → `http://localhost:8080/api/` (Express API server)
- **Key files**:
  - `src/lib/firebase.ts` — Firebase init
  - `src/lib/types.ts` — All TypeScript types
  - `src/lib/rulesEngine.ts` — Business rules engine
  - `src/lib/firestoreService.ts` — All CRUD operations
  - `src/lib/csvParser.ts` — CSV parse/export
  - `src/contexts/AuthContext.tsx` — Firebase Auth context
  - `src/hooks/use-finance.ts` — TanStack Query hooks wrapping Firestore
  - `src/pages/import.tsx` — Import page (CSV + AI vision tabs)
  - `public/manifest.json` — PWA manifest
  - `public/icon-192.png`, `public/icon-512.png` — PWA icons

### API Server (`artifacts/api-server`)
- **Port**: 8080 (fixed)
- **Paths**: `/` (handles ALL requests in dev and production)
- **Type**: Express 5 API server
- **Purpose**: AI-powered features + serves ledger-app static files (SPA host)
- **Static serving**: In both dev and production, serves `artifacts/ledger-app/dist/public` via `express.static`. Path resolved using `import.meta.url` so it works correctly regardless of where the server is launched from. SPA fallback sends `index.html` for all unmatched routes.
- **Key endpoints**:
  - `GET /api/healthz` — Health check
  - `POST /api/parse-statement` — Upload bank statement image → GPT-4o extracts transactions as JSON
- **AI**: Replit AI Integrations (OpenAI) — no user API key required
- **Key files**:
  - `src/app.ts` — Express setup, static file serving, SPA fallback
  - `src/routes/parseStatement.ts` — AI statement parser
- **IMPORTANT**: The `paths = ["/"]` in artifact.toml means this server handles all routes. The ledger-app Vite dev server (port 25002) is NOT used for serving in dev — the API server serves the built files from `dist/public`. To see frontend changes in dev, rebuild the ledger-app (`pnpm --filter @workspace/ledger-app run build`) then the API server will serve the new files.

## GitHub Integration

- **GitHub connection**: wired via Replit integrations (`@replit/connectors-sdk`)
- **Budget Ledger repository**: [jamesbly7777-dot/budget-ledger](https://github.com/jamesbly7777-dot/budget-ledger) (private)
  - All `artifacts/ledger-app` source files pushed (92 files, excludes `node_modules/` and `dist/`)
  - Branch: `main`

## Environment Variables (shared)

- `VITE_FIREBASE_*` — Firebase config for ledger-app
- `AI_INTEGRATIONS_OPENAI_BASE_URL` — Replit OpenAI proxy URL (auto-provisioned)
- `AI_INTEGRATIONS_OPENAI_API_KEY` — Replit OpenAI proxy key (auto-provisioned)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/ledger-app run dev` — run ledger app locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
