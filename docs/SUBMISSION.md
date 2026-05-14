# OPERATORS — Buildathon Submission Package

**Deadline:** May 27, 2026 EOD
**Live URL:** `operators.replit.app` (after deploy)
**Hashtag:** `#lennysbuildathon`

---

## Submission Portal Post (paste into Replit submission form)

**Title:** OPERATORS — A Tactical Fighter Built on Lenny's Podcast

**Tagline (≤140 chars):** 27 podcast guests. 135 verbatim frameworks. Turn-based combat where Chesky's "Founder Mode" actually does +50% damage.

**Description (3 paragraphs):**

OPERATORS is a turn-based tactical fighting game where 27 of the most iconic guests from Lenny's Podcast face off in 2D combat. Every fighter has a 5-move kit named after their real frameworks — Chesky's "Founder Mode", Doshi's "LNO Framework", Madhavan's "Outcome Pricing", Annie Duke's "Pre-Mortem", Boris Cherny's "Claude.md". Every move's flavor text is a verbatim quote with episode + timestamp, and clicking any quote opens the actual YouTube episode at the moment they said it. The dataset isn't decoration — it's the mechanics: pricing experts do +50% damage in Cap Table scenarios, AI-native fighters dominate the Datacenter stage, founder-mode aggression beats slow strategic plays in Crisis.

The game ships with five modes — **Arcade** (8-stage gauntlet ending in Lenny himself as final boss), **VS** (local 2-player hot-seat), **Practice** (infinite resources to learn any movekit), **Daily Challenge** (date-seeded matchup, same for everyone today), and **Random** — across three difficulty levels with per-fighter AI personalities (Chesky-bots aggressive, Doshi-bots set up combos defensively, Jason Fried-bots play patient, Boris-bots spike hard). Combat juice: K.O. cinematic with slow-mo + particle burst + winner's voice line, full-screen comic-book combo banners, crit slow-mo, hit-lag, status halos that telegraph buffs, screen shake, and procedural chiptune music synthesized live via WebAudio (zero audio assets shipped).

Beyond combat, it's a real PM learning tool. The **Quote Bank** is searchable with 10 themed filters (pricing, distribution, AI-native, leadership, growth, positioning, product-sense, execution, culture, strategy) and exports as Markdown with linked citations. The **Framework Encyclopedia** indexes all 135 frameworks by topic — click any one to open the real podcast at the real timestamp. Built entirely with Vite + React + Zustand + Framer Motion + Tailwind. Sprite art via Azure gpt-image-2 with a stance-as-reference edit pipeline that locks character identity across all four poses. Quote pool extracted directly from transcript frontmatter — no LLM inference at runtime.

**Live URL:** https://operators.replit.app
**GitHub:** https://github.com/andrey-esipov/operators

---

## Screenshot Order (for portal upload)

1. **`docs/screenshots/01-menu.png`** — Main menu with bespoke title artwork + Operator of the Day banner + curated quote
2. **`docs/screenshots/02-character-select.png`** — 27-fighter grid + expandable profile card with full move list
3. **`docs/screenshots/03-fight.png`** — Mid-combat: HP bars at top, sprites facing off, move bar at bottom, status halo on a fighter
4. **`docs/screenshots/04-quote-callout.png`** — Quote overlay with verbatim quote, episode, and timestamp + YouTube link
5. **`docs/screenshots/05-ko.png`** — K.O. cinematic frozen mid-particle-burst
6. **`docs/screenshots/06-encyclopedia.png`** — Framework Encyclopedia grouped by topic
7. **`docs/screenshots/07-stage-select.png`** — Stage select with bonus chips

To capture: open the dev server (`npm run dev`), navigate to each screen, take Cmd+Shift+4 region screenshot, save to `docs/screenshots/`.

---

## Demo Video Script (60–90s, target 75s)

**00:00 — 00:04** — Splash on the title screen with bespoke gpt-image-2 hero artwork. Menu music starts. Quote rotating: "Founder mode is when the CEO is in the details." — Chesky, ep 217.

**00:04 — 00:08** — Click ▶ ARCADE MODE. Character select grid blooms in. Hover Chesky, profile card shows "AGGRO · FOUNDER MODE · ep 217" with bio + signature ult. Click select.

**00:08 — 00:12** — Stage reveal: "PRE-PMF GARAGE" with topical description. Audience-bobbing ambient motion in the office stage behind.

**00:12 — 00:15** — ROUND 1 banner crashes down. FIGHT! shouts. Both fighters quote their matchStart voice line via browser TTS.

**00:15 — 00:25** — Combat exchange. Chesky uses USE YOUR OWN PRODUCT (light). Doshi takes 35 dmg. Quote callout overlay: "If you don't use your own product every day, you can't build a great one." — ep 217 · 02:14 · ▶ EPISODE button visible.

**00:25 — 00:30** — Chesky casts FOUNDER MODE (setup) — sprite gets red halo aura, "F-MODE" status chip appears. Then casts AIR-DESIGN (combo). Combo banner crashes in full-screen: "BUILT THE COMPANY I'D WANT TO WORK AT" — gold, skewed, with shockwave.

**00:30 — 00:38** — Doshi at low HP, bar pulsing red. Chesky momentum hits 8, super meter at 100, gold ring around fighter telegraphs. Cast AIR IS A CITY ultimate — slow-mo, screen flash, voice line "AIR IS A CITY."

**00:38 — 00:45** — K.O. cinematic: white flash → "K.O.!" banner crash → particle burst → "CHESKY WINS" + voice line "Ship it. Always." Quote Bank notification: 5 new entries.

**00:45 — 00:55** — Cut to Quote Bank. Show search bar, theme chips (PRICING, DISTRIBUTION, AI-NATIVE etc.), one card expanded showing quote + episode + YouTube ▶ button. Click → opens real YouTube video at real timestamp.

**00:55 — 01:05** — Cut to Framework Encyclopedia — 135 frameworks indexed by topic. Click PRODUCT SENSE chip, filter shows Julie Zhuo + Cat Wu + Marty Cagan + Dylan Field cards.

**01:05 — 01:15** — Cut to Stats screen — achievements grid, roster heatmap (★ used / ⚔ defeated), career stats.

**01:15 — 01:20** — End card: "OPERATORS · operators.replit.app · #lennysbuildathon · built in 16 days with Replit Agent".

Total: 80s. Record with screen capture (QuickTime / Loom), edit out dead frames in iMovie, upload to YouTube + crosspost on X.

---

## Build-in-Public Posts (queue up)

### Final-stretch sequence (Day 14 — May 26)

**X post 1 (morning):** "OPERATORS is feature-complete. 27 fighters. 5 modes. 135 verbatim frameworks. K.O. cinematic. Tomorrow: deploy + demo video. #lennysbuildathon"

**X post 2 (afternoon):** [video] "When Founder Mode procs at low HP and Chesky lands AIR IS A CITY on Lenny himself. Slow-mo + voice line + K.O. banner. Built every animation in CSS. #lennysbuildathon"

**X post 3 (evening):** "Framework Encyclopedia: 135 real PM frameworks searchable by topic. Click any → opens the real podcast at the real timestamp. The game IS the index. #lennysbuildathon"

### Submission day (May 27)

**X thread:**
1. "16 days ago I started OPERATORS — a tactical fighter built on @lennysan's podcast data. Submitting today. Live at operators.replit.app · #lennysbuildathon"
2. "27 fighters, each a real podcast guest. 5 moves per fighter, each a real framework. Flavor text is verbatim with episode + timestamp. The data is the mechanics, not flavor."
3. "Beat Lenny in Arcade Mode to flex pattern-matching. Daily Challenge for routine. Practice mode if you want to learn a kit. Framework Encyclopedia if you just want the frameworks."
4. "Shipped: K.O. cinematic, combo banner, status halos, crit slow-mo, hit-lag, 8 fully-animated stages, TTS voice lines, procedural chiptune music. Zero audio assets."
5. "Massive thanks @amasad and @Replit team for the platform. Built with Replit Agent + Claude Code. Submitting now. Vote ⚡ if it makes you laugh + learn at the same time."

---

## Submission Day Checklist

- [ ] `operators.replit.app` deployed and confirmed stable
- [ ] 7 screenshots captured + saved to `docs/screenshots/`
- [ ] Demo video recorded, edited, uploaded to YouTube (unlisted ok)
- [ ] Demo video URL added to submission form
- [ ] Title + description + tagline copied into portal
- [ ] GitHub repo set to public
- [ ] Replit DM @amasad with the submission link
- [ ] Cross-post X thread with @lennysan tag
- [ ] Cross-post on Lenny's community Slack/Discord
- [ ] LinkedIn post with screenshot + URL
- [ ] Submit at https://lennysbuildathon.replit.app/ before May 27 EOD
