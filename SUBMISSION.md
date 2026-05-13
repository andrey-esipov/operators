# OPERATORS — Buildathon Submission

**Live**: `operators.replit.app` _(deploy in progress)_
**Repo**: https://github.com/andrey-esipov/operators
**Built**: May 12–27, 2026 for the Lenny × Replit Buildathon

## What it is

OPERATORS is a turn-based tactical fighting game where the most iconic guests from Lenny's Podcast face off in 2D combat. Every fighter has 5 signature moves named after their **real frameworks**. Every move's flavor text is a **verbatim quote with episode + timestamp**. Every fight takes place in a business **scenario** — and each fighter does bonus damage in the scenarios where their philosophy actually applies.

Beat all 8 stages in Arcade Mode. Final boss: **Lenny himself**, with a Pattern Matching ultimate that costs HP if you miss the trivia interrupt.

## How it scores on the rubric

### 1. Creative use of the dataset
- Every move is named after a real framework spoken on the podcast
- Every move's flavor is a **verbatim quote with episode + timestamp citation** (no paraphrasing)
- Scenario-aware damage bonuses make the dataset **mechanical**, not decorative — Chesky's "FOUNDER MODE" does +50% in Pre-PMF because the podcast says founder mode matters most there
- The **Quote Bank** every player builds while playing is a portable knowledge artifact

### 2. Usefulness
- Players **learn the operators' frameworks by playing them**
- The persistent Quote Bank exports as a personal share-card of "frameworks I learned"
- Daily play = daily reinforcement of the most-cited PM/founder wisdom

### 3. Execution & polish
- SF II-tradition pixel sprite art, generated via Azure gpt-image-2
- Pixel-perfect rendering (`image-rendering: pixelated`, Press Start 2P + VT323 fonts)
- Parallax stage backgrounds, screen shake, flash overlays, combo banners
- Procedural chiptune SFX (WebAudio) for arcade feel
- CRT scanline overlay (toggleable)
- Zero-crash 5-min match flow tested end-to-end

### 4. Use of Replit
- Built and deployed on Replit (`operators.replit.app`)
- Replit DB for Quote Bank persistence
- Replit Agent vibe-coded the entire combat engine in 16 days

### 5. Community engagement
- Built in public on X with `#lennysbuildathon` from Day 1
- Every Quote Bank export is a share card
- Daily-replayable Arcade Mode = recurring social moments

## Stack

- Vite + React 19 + TypeScript + Tailwind v4
- Framer Motion for animations
- Zustand for game state
- WebAudio for procedural chiptune SFX
- Azure OpenAI gpt-image-2 for pixel sprite generation
- Anthropic Claude for fighter content extraction

## What's in the box

- **8 starting fighters** (Chesky, Doshi, Cat Wu, Madhavan, Spiegel, Turley, Cagan) + **Lenny as final boss**
- **40 unique moves** with verbatim podcast quotes
- **8 business scenarios** (Pre-PMF, Hypergrowth, Plateau, AI-Native, Monetization, Crisis, IPO-Prep, Distribution)
- **Status effects** named after operator wisdom (CONFUSED ICP, FOUNDER MODE, OUTCOME DEBT…)
- **Combo system** that chains setup → finisher with the operator's iconic story flashing on screen
- **Scenario-aware damage** — frameworks do bonus damage where they actually apply
- **Arcade Mode** — 8-stage progression vs bots
- **VS Mode** — local hot-seat 2-player
- **Quote Bank** — persistent library of every quote you've unlocked
- **CRT overlay** — toggleable arcade-feel scanlines

## Submission

Tag: `@lennysan @amasad @Replit #lennysbuildathon`
Demo video: _(60–90 sec, recorded May 26)_
