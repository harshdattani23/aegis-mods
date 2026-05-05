# Aegis — context-aware moderation for Reddit

> Submission for the Reddit Mod Tools and Migrated Apps Hackathon
> ([devpost](https://mod-tools-migration.devpost.com)) — **Best New Mod Tool** category.

AutoMod is regex. Toolbox is a browser extension stuck in 2016. Aegis is the
moderation app that grounds every decision in your subreddit's own history —
verdicts cite precedent, brigade detection matches prior raid signatures, the
user-facing Coach shows similar posts that *did* get approved.

The moat is **Subreddit Memory**: a vector index of every post, comment, mod
action, and rule revision in the sub, queryable by similarity. Every layer
above (Arbiter, Sentinel, Crisis Mode, Vision, Coach) is built on it.

## Status

Day 1 of 22 — see [PRD.md](./PRD.md) for the full plan.

Working today:
- Gemini 3.1 Flash Lite triage with structured JSON output
- Per-subreddit settings (rules, autonomy, thresholds, feature toggles)
- Mod menu actions: triage post / triage comment / open dashboard
- Rich form UI for menu triage (verdict + reasoning + DM editor + execute)
- React webview dashboard: queue, watchlist, audit, precedent panel, action buttons
- Redis-backed verdict store + queue sorted-set
- 8 Devvit triggers wired (handlers stubbed for Day 2-11 work)

Coming next:
- Day 2-3: real Memory substrate (text-embedding-004 + Redis vector index +
  90-day backfill on AppInstall)
- Day 4: auto-triage on PostReport / AutomoderatorFilter triggers
- Day 9-11: Sentinel risk scoring, Crisis Mode brigade detector
- Day 12-15: Vision (Gemini 2.5 Pro), Coach pre-post widget
- Day 18-22: live test, demo video, submission

## Stack

- [Devvit web](https://developers.reddit.com/) (React 19 + Hono server)
- [Gemini 3.1 Flash Lite](https://ai.google.dev/) for triage / risk / coach
- [Gemini 2.5 Pro](https://ai.google.dev/) for vision + low-confidence
  escalations
- [text-embedding-004](https://ai.google.dev/gemini-api/docs/embeddings)
  for the Memory substrate
- Devvit Redis for state, audit, calibration, embeddings cache

## Layout

```
src/
├── client/              # React webview (Vite-built)
│   ├── splash.tsx       # Inline preview shown in feed
│   ├── game.tsx         # Expanded dashboard
│   └── hooks/           # useDashboard, fetchPrecedent
├── server/              # Hono backend (Devvit serverless)
│   ├── index.ts         # Route registration
│   ├── routes/
│   │   ├── api.ts       # Webview <-> server endpoints
│   │   ├── menu.ts      # Mod menu handlers
│   │   ├── forms.ts     # Form submit (menu triage execute)
│   │   └── triggers.ts  # Devvit trigger event handlers
│   ├── services/
│   │   ├── gemini.ts    # Gemini API client
│   │   ├── triage.ts    # Verdict orchestrator
│   │   ├── memory.ts    # Vector index (skeleton, real Day 2)
│   │   ├── verdictStore.ts # Redis-backed verdict cache
│   │   ├── queue.ts     # Queue/watchlist/audit + demo data
│   │   └── types.ts
│   └── core/post.ts     # createCustomPost helper
└── shared/
    └── api.ts           # Types shared between client and server
```

## Development

```bash
npm install
devvit login
devvit settings set gemini_api_key  # paste your Google AI Studio key
npm run dev                          # = devvit playtest
```

The playtest auto-creates `r/<app-name>_dev` and reinstalls on every save.

## Commands

- `npm run dev` — playtest with hot reload
- `npm run build` — bundle client + server
- `npm run type-check` — tsc strict
- `npm run lint` — eslint
- `npm run deploy` — upload + publish

## License

BSD-3-Clause
