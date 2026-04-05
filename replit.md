# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM (shared backend), Firebase Firestore (ledger app)
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Artifacts

### Budget Ledger App (`artifacts/ledger-app`)
- **Preview path**: `/`
- **Type**: React + Vite web app
- **Backend**: Firebase Firestore + Firebase Storage + Firebase Auth (no Express backend needed)
- **Features**:
  - Dark fintech UI (mobile-first)
  - Monthly ledger system (transactions, bills, months)
  - Rules engine (auto-categorization: Bills, Fuel, Necessary, Medical, Shopping, Transfers, Personal, Waste)
  - CSV import with preview, duplicate detection, rules engine
  - PDF/image upload to Firebase Storage
  - Analytics with Recharts (category totals, monthly trends)
  - Rules management UI with test tool
  - Export CSV for current month
- **Firebase project**: full-ledger-app
- **Auth**: Email/password via Firebase Auth
- **Firestore structure**: `users/{userId}/{transactions|bills|months|rules}`
- **Key files**:
  - `src/lib/firebase.ts` — Firebase init
  - `src/lib/types.ts` — All TypeScript types
  - `src/lib/rulesEngine.ts` — Business rules engine
  - `src/lib/firestoreService.ts` — All CRUD operations
  - `src/lib/csvParser.ts` — CSV parse/export
  - `src/contexts/AuthContext.tsx` — Firebase Auth context
  - `src/hooks/use-finance.ts` — TanStack Query hooks wrapping Firestore

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/ledger-app run dev` — run ledger app locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
