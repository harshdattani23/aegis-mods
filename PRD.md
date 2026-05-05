# Aegis — Product Requirements Document

**One-line:** Context-aware moderation for Reddit, built on a per-subreddit memory substrate.

| Field | Value |
|---|---|
| Category | Best New Mod Tool ($10,000) |
| Owner | haina |
| Status | Spec frozen 2026-05-05 |
| Submission deadline | 2026-05-27, 18:00 PT |
| Hackathon | mod-tools-migration.devpost.com |

---

## 1. Problem & insight

Mods make decisions in a vacuum. Every subreddit has years of posts, comments, mod actions, removed items, appeals, and rule revisions — and **none of it is queryable**. AutoMod is regex. Toolbox is a browser extension stuck in 2016. Existing AI-mod hackathon attempts will treat each item in isolation.

**Insight:** the winning product isn't "AI moderation." It's **context-aware moderation grounded in the subreddit's own history.** Memory is the moat. Features built on top of Memory feel magical; the same features without it are commodity.

---

## 2. Goals / non-goals

### Goals
- Cut moderator queue-clearing time by ≥50% on test sub
- Cut "why was I removed" modmail by ≥30% via precedent-cited DMs
- Detect simulated brigade in <60s and auto-throttle
- Ship 5 user-facing layers + Memory substrate by May 26
- Demo cleanly in ≤60s with real numbers from live test sub

### Non-goals
- Replacing AutoMod (we coexist; AutoMod stays for keyword-level)
- Modmail handling (separate product, scope creep)
- Cross-subreddit federation (Devvit tenancy unclear; punt)
- Custom model training (Gemini Flash Lite + retrieval is sufficient)
- Multi-language (English only)

---

## 3. Success metrics

| Metric | Target | Measurement |
|---|---|---|
| Triage latency p50 | <2s | end-to-end timer |
| Triage latency p95 | <5s | end-to-end timer |
| Verdict agreement w/ mod | >75% | override rate inverted |
| Items handled in test sub | >500 | audit log count |
| Brigade detection time | <60s | simulated raid test |
| Coach false-positive rate | <15% | mod-reviewed sample |
| Daily cost per sub at 1000 items | <$1.50 | Gemini billing |
| Backfill 10K items | <10 min | install timer |

---

## 4. Personas

- **Solo mod** of a 5K-member sub: drowning in queue, no team. Wants autonomous-mode after building trust.
- **Mod team lead** of a 500K-member sub: 12 mods of varying activity. Wants assisted mode + audit trail + calibration.
- **End user** posting in a sub: doesn't know the rules, hates being removed without explanation.

---

## 5. Product surfaces

| Surface | Who | What |
|---|---|---|
| Settings form | Mod (installer) | Paste rules, paste Gemini key, choose autonomy, toggle 5 layers, set crisis thresholds |
| Onboarding wizard | Mod (installer) | First-install: paste rules → paste key → kick off backfill → done |
| Aegis dashboard (custom post) | Mods | Stickied mod-only post: Queue tab + Watchlist tab + Crisis status banner |
| Item detail panel | Mods | Expand any queue item → AI verdict + precedent panel + one-tap actions + DM preview |
| Coach widget (custom post) | All users | Embedded in submission flow: real-time score + similar approved posts |
| Crisis banner | Mods | Auto-appears on dashboard when brigade detected; manual trigger button |
| Mod menu actions | Mods | Right-click any post/comment → "Triage with Aegis" / "Open in Aegis" |

---

## 6. Architecture

```
                              ┌─────────────────────────┐
                              │    Devvit App (TS)      │
                              │  @devvit/public-api     │
                              └────────────┬────────────┘
                                           │
            ┌──────────────────────────────┼──────────────────────────────┐
            │                              │                              │
   ┌────────▼─────────┐         ┌──────────▼──────────┐         ┌─────────▼─────────┐
   │   Triggers       │         │   Custom Posts      │         │   Menu Actions    │
   │ PostSubmit       │         │   Dashboard         │         │   Triage manual   │
   │ CommentSubmit    │         │   Coach widget      │         │   Open dashboard  │
   │ PostReport       │         │                     │         │                   │
   │ CommentReport    │         └─────────────────────┘         └───────────────────┘
   │ ModAction        │
   │ AppInstall       │
   └────────┬─────────┘
            │
            ▼
   ┌──────────────────┐         ┌─────────────────────┐         ┌───────────────────┐
   │   Triage Engine  │────────▶│   Memory Service    │────────▶│   Devvit Redis    │
   │  (Gemini 3.1 FL) │         │  embed/search/store │         │                   │
   └────────┬─────────┘         └──────────┬──────────┘         └───────────────────┘
            │                              │
            │                              │
            ▼                              ▼
   ┌──────────────────┐         ┌─────────────────────┐
   │  Action Layer    │         │   Gemini API        │
   │ approve/remove/  │         │ generativelanguage. │
   │ ban/DM/throttle  │         │ googleapis.com      │
   └──────────────────┘         └─────────────────────┘
```

### Devvit allowlist (`devvit.yaml`)

```yaml
permissions:
  http:
    domains:
      - generativelanguage.googleapis.com
```

---

## 7. Data model — Redis schemas

```
# Memory substrate
mem:item:{sub}:{kind}:{id}        Hash {body, author, created_utc, embedding(b64), kind, ...}
mem:index:{sub}:recent            Sorted set, score=created_utc, member=item_key
mem:index:{sub}:removed           Sorted set of removed items (for "similar removed" queries)
mem:index:{sub}:approved          Sorted set of mod-approved items

# Triage state
triage:verdict:{post_id}          Hash {verdict, confidence, severity, rule, reasoning, precedent_id, dm_draft, ts} TTL=14d
triage:queue:{sub}                Sorted set, score=severity*confidence, member=post_id

# Audit
audit:action:{sub}:{action_id}    Hash {actor, target, action, verdict_before, verdict_after, ts}
audit:by_target:{target_id}       List of action_ids — for "why was this removed"

# Calibration
calib:override:{sub}:{rule}       List of {ai_verdict, mod_verdict, content_summary, ts}

# Crisis Mode
crisis:state:{sub}                Hash {state: NORMAL|SUSPECT|ACTIVE, since, trigger_reason}
crisis:window:{sub}:authors       Sorted set, score=ts, member=author — rolling 5-min
crisis:window:{sub}:lang_hashes   Sorted set, score=ts, member=embedding_minhash
crisis:throttle:{sub}             Hash {slow_mode_until, low_karma_blocked_until}

# Coach
coach:cache:{content_hash}        Hash {risk, suggestions, similar_approved} TTL=1h

# Cost / rate
budget:daily:{sub}:{date}         Counter, INCRBY tokens used; HARD CAP enforced
rate:gemini:{sub}                 Counter with TTL=60s for QPS limit
```

**Embedding storage**: 768-dim float32 from `text-embedding-004`. Pack as 3KB base64 per item. 10K items ≈ 30MB per sub — fits Devvit Redis quota.

**Search**: brute-force cosine over the last 5K items per query (~15ms in JS). For older items, sample by stratified recency (recent + key historical decisions).

---

## 8. AI usage

| Use case | Model | Why | Approx cost |
|---|---|---|---|
| Triage verdict | **Gemini 3.1 Flash Lite** | High volume, structured output, fast | ~$0.0003/item |
| Risk score (Sentinel) | Gemini 3.1 Flash Lite | Same call shape at submit time | included |
| Coach scoring | Gemini 3.1 Flash Lite | Real-time, every keystroke pause | ~$0.0001/draft |
| Vision | Gemini 2.5 Pro (vision) | Image posts only | ~$0.003/image |
| Escalation reasoning | Gemini 2.5 Pro | When Flash Lite confidence < 0.6 | ~$0.005/escalation |
| Embeddings | text-embedding-004 | Memory substrate | ~$0.00001/item |

**Estimated daily cost** for a 5K-member sub at ~1000 events/day: **~$0.45/day**.

### Triage prompt (production)

```
SYSTEM: You are a Reddit moderation assistant for r/{sub}. Decide an action grounded
in the subreddit rules AND the historical precedent provided. Return strict JSON.

RULES:
{rules_text}

PRECEDENT (most similar past mod decisions):
[1] outcome={REMOVED|APPROVED}; content="{excerpt}"; mod_reason="{reason}"; rule="{rule}"; ts={iso}
[2] ...
[3] ...

AUTHOR:
- account_age_days: {n}
- sub_karma: {n}
- prior_actions_in_sub: [{action, rule, ts}]

CONTENT ({type}):
{body}

REPORTS:
{reports_or_empty}

CALIBRATION (recent mod overrides on this rule):
[1] AI said {x}, mod said {y}, content="{summary}"
[2] ...

Return JSON exactly:
{
  "verdict": "approve" | "remove" | "ban" | "escalate",
  "confidence": 0.0-1.0,
  "rule_violated": "rule_id" | null,
  "severity": 1-5,
  "reasoning": "<60 words>",
  "precedent_cited": "item_key" | null,
  "removal_message_draft": "string or null — written to the user, citing precedent"
}
```

### Crisis detector (heuristic, not LLM)

```
on CommentSubmit:
  push author to crisis:window:{sub}:authors (TTL 5min)
  push embedding-minhash to crisis:window:{sub}:lang_hashes

  if window_size >= 20:
    new_commenter_pct = % of authors with age<7d
    median_karma     = median(authors.karma)
    cluster_size     = max cluster of lang_hashes within cosine 0.85

    state = NORMAL
    if new_commenter_pct > 0.6 AND median_karma < 100: state = SUSPECT
    if state == SUSPECT AND cluster_size > 5:          state = ACTIVE

    if state == ACTIVE:
      enable slow_mode (10s)
      block posting from accounts with age<7d for 30min
      DM all mods
      sticky banner on dashboard
```

---

## 9. Functional requirements per layer

### Layer 1 — Arbiter (Memory-grounded triage)
- **FR1.1** Every reported post/comment triaged within 5s of report
- **FR1.2** Verdict includes ≥1 precedent citation when similar items exist (cosine ≥ 0.75)
- **FR1.3** Mod taps action → executes via reddit API + writes audit + (if remove) drafts user DM
- **FR1.4** Mod override stored in `calib:override:*`, used as few-shot in next 100 calls for same rule
- **FR1.5** Autonomy levels: ADVISORY (never auto-acts) / ASSISTED (auto-acts above threshold) / AUTONOMOUS (acts on all high-confidence items, queue exceptions)

### Layer 2 — Sentinel (predictive)
- **FR2.1** Every PostSubmit/CommentSubmit triggers a risk score (0-1) before report
- **FR2.2** Items with risk > 0.6 surface in Watchlist tab
- **FR2.3** Risk uses author signals + content embedding similarity to Memory removed-items
- **FR2.4** Watchlist shows projected violation rule + top precedent

### Layer 3 — Crisis Mode
- **FR3.1** Heuristic detector runs on every CommentSubmit (<10ms)
- **FR3.2** ACTIVE state auto-engages: slow mode, low-karma block, mod DMs, banner
- **FR3.3** Manual trigger button available regardless of detector state
- **FR3.4** Auto-disengages after 30 min of NORMAL state OR mod override

### Layer 4 — Vision
- **FR4.1** Image posts (i.redd.it, imgur, gallery) routed to Gemini 2.5 Pro vision
- **FR4.2** Image perceptual hash stored in Memory; matches against past-removed images
- **FR4.3** OCR text concatenated to post body for triage
- **FR4.4** Latency budget: <8s p95 (vision is slower; OK)

### Layer 5 — Coach
- **FR5.1** Custom-post component embedded in target sub (stickied or installed in side widget if Devvit allows)
- **FR5.2** As user types (debounced 800ms), score draft + retrieve 3 similar approved + 1 similar removed
- **FR5.3** If risk > 0.7, show inline warning with specific revision suggestion
- **FR5.4** Coach is opt-in per sub — not all subs want this UX

---

## 10. Non-functional requirements

- **Latency**: triage p95 <5s; coach p95 <1.5s; crisis detection <100ms
- **Availability**: graceful degrade if Gemini unreachable (queue items shown without verdicts; dashboard still functional)
- **Cost cap**: daily $ ceiling per sub, hard-stops further LLM calls when hit
- **Rate limit**: 30 QPS per sub to Gemini, queued beyond
- **Storage**: ≤100MB Redis per sub at 90-day retention
- **Backfill**: ≤10 min for 10K items; user sees progress bar
- **i18n**: English only

---

## 11. Privacy / security / compliance

- All sub content sent to Gemini disclosed in install screen; mod accepts on behalf of sub
- API key stored as Devvit secret (never logged, never returned to client)
- No PII extraction beyond what's already public on Reddit
- Audit log retained 180 days, then purged
- Per-sub data isolation: never read another sub's Redis keys
- Compliance with Devvit Rules: no impersonating users, no bypassing report mechanisms, no shadow-banning, all actions attributed to mod who triggered them

---

## 12. Cost model

| Sub size | Daily events | Daily LLM cost | Daily emb cost | Total |
|---|---|---|---|---|
| 5K members | 500 | $0.15 | $0.005 | ~$0.16 |
| 50K members | 5,000 | $1.50 | $0.05 | ~$1.55 |
| 500K members | 50,000 | $15 | $0.50 | ~$15.50 |

For hackathon demo: hosted Vercel proxy with our Gemini key, capped at $10/day across all demo subs. Production: installer-pays.

---

## 13. Failure modes

| Failure | Mitigation |
|---|---|
| Gemini API down | Queue items shown without verdicts; mods act manually; auto-retry on backoff |
| Gemini returns malformed JSON | Schema validate; on fail, retry with stricter prompt; on second fail, escalate to mod |
| Devvit fetch quota hit | Pre-check `budget:daily:*`; hard stop at cap with mod alert |
| Redis quota hit | Stratified eviction: drop oldest non-removed items first |
| Backfill fails midway | Resumable via cursor in Redis; mod can retry from settings |
| Brigade detector false positive | Mod can disable Crisis Mode; auto-disengage on no-incident timeout |
| Calibration overcorrection | Cap few-shot examples at 5; weight recent mod actions more |
| Coach lag | Debounce 800ms; cache by content_hash; falls back to non-AI rule keywords if API slow |

---

## 14. Testing plan

- **Unit**: triage function with 50 hand-labeled fixtures; vector search correctness; crisis detector with synthetic windows
- **Integration**: full pipeline on staging sub; simulated brigade scripts
- **Live**: install on `r/aegis_test` (you create, <200 members) for days 18–19, real usage with one recruited friendly mod from r/devvit Discord
- **Demo rehearsal**: scripted 60s flow run 3x to verify timing

---

## 15. 22-day schedule

| Day | Date | Deliverable |
|---|---|---|
| 1 | May 5 | Scaffold, settings form, devvit.yaml allowlist, Gemini client wrapper |
| 2 | May 6 | Embedding pipeline, Memory service (store/search), Redis schemas |
| 3 | May 7 | Backfill job, progress UI, install wizard skeleton |
| 4 | May 8 | Triage engine v1 — Flash Lite call, JSON schema validation, retry |
| 5 | May 9 | Triggers wired (PostSubmit, CommentSubmit, Reports, ModAction) |
| 6 | May 10 | Action handlers (approve/remove/ban) + audit + calibration capture |
| 7 | May 11 | Dashboard custom post v1: list + sort + action buttons |
| 8 | May 12 | Item detail panel with precedent citations |
| 9 | May 13 | Sentinel risk scoring + Watchlist tab |
| 10 | May 14 | Crisis Mode detector |
| 11 | May 15 | Crisis Mode response (throttle, slow mode, mod DMs, banner) |
| 12 | May 16 | Vision integration |
| 13 | May 17 | Image perceptual hash + Memory match for vision |
| 14 | May 18 | Coach widget v1 (real-time scoring, similar-approved cite) |
| 15 | May 19 | Coach polish, debounce, cache, opt-in toggle |
| 16 | May 20 | DM drafter with tone control + preview UI |
| 17 | May 21 | Onboarding wizard, cost meter, dark mode, error states |
| 18 | May 22 | Live install on test sub; recruit r/devvit mod; 24h soak |
| 19 | May 23 | Bug bash from real usage; fix critical only |
| 20 | May 24 | Demo video — storyboard, capture, voice, edit, upload to YouTube |
| 21 | May 25 | Devpost submission text, screenshots, target communities, repo, feedback survey |
| 22 | May 26 | Final fixes; submit by 12:00 PT. **Do not touch May 27.** |

---

## 16. Open questions / risks (resolve on day 1)

1. **Custom-post embedding in submission flow** — does Devvit allow Coach to render in the actual post composer, or only as a separate widget? Needs early spike. Fallback: Coach lives as a sidebar on the sub.
2. **Devvit Redis size limits per sub** — verify 100MB/sub headroom. Fallback: tighter eviction.
3. **Gemini 3.1 Flash Lite JSON-mode reliability** — verify on day 1 with a few hundred test calls. Fallback: function-calling mode for stricter structure.
4. **Vision model cost on large image posts** — verify pricing. Fallback: Vision opt-in per sub.
5. **Backfill rate limits via Reddit API** — verify Devvit's reddit client handles this. Fallback: backfill last 30 days, not 90.

---

## 17. Submission checklist (Devpost)

- [ ] App listing live: `developers.reddit.com/apps/aegis`
- [ ] Test post in a public sub with <200 members
- [ ] YouTube demo video, public, ≤60s
- [ ] Devpost text description (sells Memory differentiator first, features second)
- [ ] 1–3 target communities (one big, one mid, one niche)
- [ ] Reddit usernames of all participants
- [ ] [Optional] Public GitHub repo link
- [ ] [Optional] Feedback survey for $200 prize
- [ ] [Optional] Helper nomination if anyone in r/devvit Discord helped

---

## 18. 60-second demo script

| t | beat |
|---|---|
| 0–5s | "Your subreddit has 3 years of context. Your mods can't access any of it." |
| 5–15s | Install Aegis. Backfill animation: 14,000 posts indexed in 90 seconds. |
| 15–30s | Open queue. Tap an item. Side panel shows 3 similar prior items with mod decisions and reasoning. Tap remove → DM drafted citing precedent. |
| 30–45s | Coach demo — user types a post, sees "3 similar approved posts" inline, revises before submit. |
| 45–55s | Crisis Mode triggers on simulated brigade — incoming comments match a prior raid signature; auto-throttle engages. |
| 55–60s | End card: "1,247 actions, 14 hours saved, modmail down 41%, brigade neutralized in 90s. Your sub's memory, working for you." |
