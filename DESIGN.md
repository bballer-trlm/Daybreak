# Design System — Daybreak

## Product Context
- **What this is:** Real-time market intelligence platform for professional equity and options traders
- **Who it's for:** ~50 Trillium traders — professionals making decisions in seconds to minutes
- **Space/industry:** Institutional trading intelligence. Peers: Bloomberg Terminal, Benzinga Pro, Unusual Whales
- **Project type:** Internal web app, large-monitor desktop primary (27"+ screens, multi-monitor setups)

---

## Aesthetic Direction
- **Direction:** Industrial/Precision — dark terminal with craft. Not Bloomberg's retro CRT aesthetic, not Koyfin's consumer-app feel. A Bloomberg Terminal designed by a product team in 2025 with taste: serious, dense, purposeful.
- **Decoration level:** Minimal — typography, color, and data density do all the work. No decorative elements.
- **Mood:** The platform should feel like a co-pilot that earns trust. It is quiet when nothing is urgent, loud when something matters. Every visual element communicates state — nothing is ornamental.
- **Reference:** Bloomberg Terminal (density + signal discipline), Unusual Whales (color restraint)

---

## Core UX Principle: Two Views, Not Filters

Daybreak is not a Bloomberg News clone where traders manage word lists and keyword filters. It is an analyst that does the filtering for the trader.

### The Two Views
```
┌──────────────────────────────────────────────────────────────────┐
│  ● Curated     Wire                       [⚙ Feeds]  [Columns] │
└──────────────────────────────────────────────────────────────────┘
```

**Curated** (default tab): AI-selected stories relevant to this trader. No filters, no word lists. Ordered by urgency × relevance × Daybreak Score. Earns trust by being right, not by being configured.

**Wire** (second tab): The full ingestion pipe. Everything, in raw chronological order. The trader uses this to audit what the AI is seeing and spot misses. Like "All Mail" to Curated's "Important."

### The Feedback Loop
The trader teaches the AI — they do not configure filters:

```
Wire row (story AI didn't curate) →  [ ↑ ]  "Should've been in Curated"
Curated row (story wasn't relevant) → [ ↓ ]  "Not for me"
```

Both signals flow back to the screener/scoring agents. Each trader's Curated tab calibrates to their book and style over time. A "Missed by Curated" indicator (subtle gray dot) on Wire rows makes the audit fast — trader can see at a glance what the AI missed.

**Feedback UI rules:**
- Nudge affordance (`↑`/`↓`) appears on row hover, right-aligned — doesn't interrupt reading
- Brief inline toast on submit: *"Signal sent. Daybreak will learn from this."*
- Watchlist additions are also preference signals (not just bookmarks)

### Feed Configuration
⚙ Feeds button opens a slide-over drawer (not a modal, fits within right-panel space):
- Which source feeds are active (Reuters, FT, BBG, SEC EDGAR, DOJ, etc.)
- Per-feed metadata: structured ticker column, topics, regions, authors — toggle which fields are available as optional columns in Wire view
- User-level weights: sectors/entities this trader follows — these are AI weights, not hard filters

---

## Color

### Approach: Restrained-semantic
Dark foundation. Color is reserved for signal — not decoration. When color appears, it means something specific.

### Palette

| Role | Hex | Usage |
|------|-----|-------|
| Background | `#0A0B0D` | Page — near-black, slightly warm |
| Surface | `#111318` | Panels, sidebar |
| Surface raised | `#1A1E26` | Selected rows, hover states, drawer backgrounds |
| Border | `#252B36` | Row dividers, panel edges |
| Text primary | `#E2E4E9` | Headlines, labels |
| Text secondary | `#8B91A0` | Timestamps, sources, metadata |
| Text muted | `#4B5263` | Read items, disabled, placeholders |

### Signal Colors (non-negotiable — trader muscle memory)

| Signal | Hex | Background | Usage |
|--------|-----|-----------|-------|
| Bullish | `#22C55E` | `#052E16` | Score badges (+), price up |
| Bearish | `#EF4444` | `#2C0A0A` | Score badges (−), price down |
| Breaking/Urgent | `#F59E0B` | `#2D1A00` | Row urgency stripe, row tint |
| Neutral | `#6B7280` | `#1A1E26` | Unscored, indeterminate |

**Score badge brightness scales with magnitude:**
- `+87` → bright green on green-mid background
- `+41` → lighter green on dark green background
- `+08` → near-gray green on dark background
- Same scaling pattern for bearish

### Status / Category Tag Colors (differentiated from signals)

| Tag type | Hex | Rationale |
|----------|-----|-----------|
| BREAKING | `#F59E0B` amber | Urgent, warm — stands out first |
| MACRO | `#14B8A6` teal | Cool, distinct from amber |
| SEC / Regulatory | `#94A3B8` slate | Institutional, neutral |
| Source tags | `#4B5263` muted | Background metadata |

**Rule:** Urgency tags (BREAKING) are warm. Category tags (MACRO, SEC) are cool. They never share a color. A trader glancing quickly can distinguish them without reading.

### Accent (Daybreak Identity)

| Role | Hex | Usage |
|------|-----|-------|
| Accent | `#0EA5E9` | Interactive elements, focus, selected state, tickers |
| Accent dim | `#0369A1` | Active nav, pressed states |
| Accent bg | `#041E2E` | Selected row background, ticker badge fill |

The accent is named for the brand: sky blue at dawn. It stands apart from every signal color and won't visually collide with red/green/amber.

### Dark Mode
This is a dark-mode-first product. A light mode is not planned for Phase 1 — traders use dark all day for eye fatigue reasons.

---

## Typography

### Fonts: Geist Family

**UI + Headlines:** Geist Sans
- Clean, engineered, readable at 13–15px density
- Same family as the Next.js/Vercel ecosystem the platform is built on
- Not Inter (overused) — Geist has the same feel with less visual baggage

**Tickers + Scores + Timestamps:** Geist Mono (`tabular-nums`)
- `AAPL`, `−87`, `+41`, `14:32:07.423` — always align in columns
- Same font family, zero visual friction between prose and data
- `font-variant-numeric: tabular-nums` required on all score and timestamp columns

**Loading:** Vercel Geist CDN
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
```

### Type Scale

| Role | Font | Size | Weight | Color |
|------|------|------|--------|-------|
| Feed headline | Geist | 13px | 400 | `--text-primary` |
| Selected/expanded headline | Geist | 15px | 600 | `--text-primary` |
| Body / summary | Geist | 13px | 400 | `--text-secondary` |
| Column headers | Geist Mono | 10px | 400 | `--text-muted` (uppercase) |
| Timestamps | Geist Mono | 11px | 400 | `--text-muted` |
| Ticker symbols (inline) | Geist Mono | 11px | 500 | `--accent` |
| Score badges | Geist Mono | 12px | 500 | signal color |
| Tag labels | Geist Mono | 9px | 500 | signal color (uppercase) |
| Sidebar items | Geist | 13px | 400 | `--text-secondary` |
| Section labels | Geist Mono | 10px | 400 | `--text-muted` (uppercase) |
| Keyboard hints | Geist Mono | 10px | 400 | `--text-muted` |

### Inline Ticker Treatment
Tickers embedded in headline text use `font-family: Geist Mono, font-weight: 500, color: --accent` — no background box, no badge border. The distinction comes from font + color, not shape. This keeps the headline readable left-to-right without visual breaks.

```
Fed hikes 50bps — AAPL and JPM trade lower in afterhours
                   ^^^^      ^^^  (Geist Mono, accent color)
```

---

## Spacing

- **Base unit:** 4px
- **Density:** Compact — this is a professional tool, not a consumer app. Whitespace is earned, not default.
- **Feed row height:** 38px (fixed — variable heights break scan rhythm)
- **Scale:** `2 / 4 / 8 / 12 / 16 / 24 / 32 / 48`

```css
--space-2xs:  2px;
--space-xs:   4px;
--space-sm:   8px;
--space-md:   12px;
--space-lg:   16px;
--space-xl:   24px;
--space-2xl:  32px;
--space-3xl:  48px;
```

---

## Layout

### 3-Panel Structure
```
┌──────────────────┬─────────────────────────────────┬────────────────────┐
│  Sidebar         │  Feed (main)                    │  Detail panel      │
│  (200px / icon   │                                 │  (340px,           │
│   rail / hidden) │  [view tabs + controls]         │   expandable)      │
│                  │  ─────────────────────────────  │                    │
│  Watchlist       │  feed rows...                   │  Article detail    │
│  Sectors         │                                 │  Enrichment status │
│  Filters         │                                 │  Entity impacts    │
│  Feed config     │                                 │  Research          │
└──────────────────┴─────────────────────────────────┴────────────────────┘
```

**Sidebar states:**
- Full (200px) — watchlist, sectors, keyboard hints, feed config
- Icon rail (40px) — icons only, tooltip on hover
- Hidden (0px) — full feed width reclaimed

Toggle button at top of sidebar cycles through states. Preference persisted per-user.

**Right panel states:**
- Collapsed — full feed width
- Standard (340px) — article detail + enrichment + entities
- Expanded (50% viewport) — deep research, historical scenarios

**Max content width:** 1600px
**Border radius:** `2px` (sm) / `4px` (md) / `6px` (lg) — tight, not bubbly

### Feed Column System
**Default column order (left → right = urgency → time → content → impact):**

```
[3px stripe] [Flags] [Timestamp ms] [Source] [Headline + inline tickers] [Score]
```

- **Urgency stripe** (3px, non-removable): amber = breaking, sky = normal, transparent = read
- **Flags column** (optional, user-toggleable): `BRKG`, `MACRO`, `SEC` tag badges — keeps headline uncluttered
- **Timestamp** (optional): `HH:MM:SS.mmm` format — millisecond precision for traders who need it
- **Source** (optional): abbreviated, monospace — `BBG`, `FT`, `RTRS`, `SEC`
- **Headline**: always present, always left-justified, fills remaining space. Inline tickers in Geist Mono accent.
- **Score** (optional): right-aligned, fixed 56px — always in the same visual position for quick scanning

**All columns except headline are user-configurable:** show/hide, reorder. Preferences persisted per-user. Column config accessed via `[Columns]` button in feed header.

### Breaking Row Treatment
Breaking news does NOT use an inline `BREAKING` badge that pushes headline text right. Instead:
1. **Urgency stripe:** 2–3px left stripe pulses amber on INSERT, then holds solid
2. **Row background:** subtle amber tint (`rgba(245,158,11,0.04)`) on the row
3. **Flags column:** `BRKG` badge in amber (if Flags column is visible)
4. **Headline remains fully left-justified** — eye path unbroken

### Curated vs. Wire Tab Bar
```
● Curated     Wire                        [⚙ Feeds]  [Columns]  [↑ 3 Misses]
```
- Tabs at top of feed, always visible
- `↑ N Misses` indicator when there are Wire stories not in Curated — invites audit
- `[⚙ Feeds]` opens slide-over drawer for feed configuration
- `[Columns]` opens column visibility/order manager

---

## Motion

**Approach:** Minimal-functional — every animation communicates state. No decoration.

| Interaction | Animation | Duration | Easing |
|-------------|-----------|----------|--------|
| Headline INSERT | Slide in from top | 150ms | ease-out |
| Score badge arrival | Single scale pulse (1→1.05→1) | 200ms | ease-out |
| Breaking flash | Amber border pulse 2–3× then holds | 800ms × 3 | ease-in-out |
| Sidebar collapse | Width transition | 150ms | ease-in-out |
| Panel expand | Width + opacity | 200ms | ease-out |
| Keyboard focus | Instant highlight, no animation | — | — |
| Row hover | Instant background change | — | — |
| Nudge toast | Fade in, hold 2s, fade out | 150ms / 2000ms / 150ms | ease |

**Rule:** Animate once to signal state change. Never loop to decorate. If a user could miss the action, animate once. If they couldn't miss it (hover, click), don't animate at all.

---

## AI Enrichment Pipeline — Condensed Display

The detail panel shows pipeline status as a **single-line strip**, not a verbose stage list:

```
✓ Screener  ·  ✓ Entities: AAPL EU JPM  ·  −64  ·  Novelty: 23  ·  ⟳ Research...
```

States:
- `✓` green = complete
- `⟳` accent = in progress (subtle spin animation, 600ms)
- `✗` red = failed (row still shows in feed, degraded gracefully)
- `·` muted = pending

Full stage output available on expand (not shown by default — detail panel real estate is for the analysis, not the pipeline metadata).

## Novelty Score Display

Novelty is 0–100 (100 = first-ever headline for this entity on a material event; 0 = near-duplicate of recent headline). It is surfaced in two places:

**Feed row (urgency stripe dot):**
- High novelty (>80): a filled accent dot (`●`) overlaid at the bottom of the urgency stripe
- The dot signals "genuinely new information" without adding a column or breaking scan rhythm
- Not shown for novelty ≤80 — the stripe is clean by default

```
[●]  [BRKG]  [14:32:07.123]  [RTRS]  Fed hikes 50bps — AAPL JPM lower  +64  [↑]
 ↑
 accent dot = high novelty (>80)
```

**Detail panel (pipeline strip + "Previously reported" note):**
- Novelty score always shown in the pipeline strip: `Novelty: 23`
- If novelty < 40: display a muted "Previously reported" note below the strip with links to the 2–3 most similar recent headlines for the same entity:

```
⚠ Previously reported — 3 similar AAPL headlines in last 48h  [view →]
```

**Novelty column (Wire view, optional):**
- Opt-in column in Wire for power users who want to scan novelty across the full pipe
- Geist Mono, 11px, `--text-muted` — low-contrast because it's supplementary, not primary signal
- Format: `23` (no label — context is set by column header)

---

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-18 | Geist family (Sans + Mono) | Same family for prose and data; cleaner than Inter; native to the Next.js ecosystem |
| 2026-03-18 | Dark mode only (Phase 1) | Traders use dark all day; contrast for signal colors is stronger on dark |
| 2026-03-18 | Fixed 38px row height | Variable row heights break scan rhythm; precision tools use fixed rows |
| 2026-03-18 | No inline Breaking badge | Inline badges push headline off left edge, breaking eye path; use stripe + row tint instead |
| 2026-03-18 | Sky blue accent `#0EA5E9` | Distinct from all signal colors (red/green/amber); named for the Daybreak brand |
| 2026-03-18 | Warm/cool tag color split | Breaking = amber (warm, urgent); category tags = teal/slate (cool, informational) |
| 2026-03-18 | Two-view model (Curated + Wire) | Daybreak does the filtering — not the user. Wire is the audit surface; Curated is the AI analyst view |
| 2026-03-18 | Feedback loop over filter config | Traders teach the AI via ↑/↓ signals, not word lists. Watchlist additions are preference signals. |
| 2026-03-18 | Collapsible sidebar (3 states) | Screen real estate is precious; sidebar earns its space, can be hidden when not needed |
| 2026-03-18 | Millisecond timestamps | Traders operate in seconds-to-minutes hold times; ms precision is meaningful |
| 2026-03-18 | Novelty score: feed dot + detail panel | High novelty (>80) = accent dot on urgency stripe; always in pipeline strip; "Previously reported" note when novelty <40. Feed stays clean; detail panel has full context. |
