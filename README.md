# loan-bank-office

Node.js backend for loan backoffice (LINE webhook + simple admin dashboard).

## Setup
```bash
npm install
```

Create `.env` (LINE keys):
```
LINE_CHANNEL_ACCESS_TOKEN=...
LINE_CHANNEL_SECRET=...
```

## Run
- Dev: `npm run dev` (tsx runs `api/index.ts`)
- Prod-like: `npm run start`

## Notes
- SQLite file: `loan.db` (better-sqlite3)
- Serverless entry: `api/index.ts` (also used locally)
