# OPERATORS

A turn-based tactical fighting game where 16 of the most iconic guests from **Lenny's Podcast** face off in 2D combat. Every fighter has 5 signature moves named after their real frameworks. Every move's flavor text is a verbatim quote with episode + timestamp. Every fight takes place in a business **scenario** — and each fighter does bonus damage in the scenarios where their philosophy actually applies.

Submission for the **[Lenny × Replit Buildathon](https://lennysbuildathon.replit.app/)** (May 6 – May 27, 2026).

## Stack

- **Vite + React 19 + TypeScript** — UI
- **Tailwind CSS v4** — styling, custom 24-color palette
- **Framer Motion** — combat juice (screen shake, banner slide-ins, transitions)
- **Zustand** — game state machine
- **WebAudio (procedural)** — chiptune SFX synthesized at runtime
- **Replit Deployments** — hosting (required by buildathon)
- **Azure OpenAI gpt-image-2** — sprite generation pipeline
- **Anthropic Claude** — fighter content extraction from podcast transcripts

## Local dev

```bash
npm install
npm run dev
# open http://localhost:5173
```

## Deploy to Replit (buildathon submission)

1. Go to https://replit.com → Create Repl → Import from GitHub → paste `https://github.com/andrey-esipov/operators`
2. Replit auto-detects the `.replit` config and runs `npm install && npm run build`
3. Click `Deploy` → choose `Autoscale` or `Static` deployment
4. Live at `<your-repl-name>.replit.app`
5. (Optional) Generate real sprites with Azure gpt-image-2 by adding secrets in the Replit Secrets panel:
   - `AZURE_OPENAI_ENDPOINT`
   - `AZURE_OPENAI_API_KEY`
   - `AZURE_OPENAI_DEPLOYMENT`
   Then run `npx tsx scripts/generate-fighter-sprites.ts` from the Replit shell.

## Build

```bash
npm run build
```

## Asset generation

```bash
# Extract per-fighter content from the podcast/newsletter dataset
npx tsx scripts/extract-fighter-content.ts

# Generate fighter sprites via Azure gpt-image-2
npx tsx scripts/generate-fighter-sprites.ts
```

Required env vars (see `.env.example`):

```
ANTHROPIC_API_KEY=...
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com
AZURE_OPENAI_DEPLOYMENT=gpt-image-2
AZURE_OPENAI_API_VERSION=2025-04-01-preview
```

## Game design (one-pager)

- **Turn-based**, alternating moves, ~5-minute matches. Best of 3 rounds, 90s per round.
- **Resources**: HP (1000) · Momentum (1–8, +1/turn) · Super Meter (0–100)
- **Each fighter has 5 moves**: light · heavy · setup · combo · ultimate
- **Status effects** named after operator wisdom: CONFUSED ICP, FOUNDER MODE, OUTCOME DEBT, …
- **Combos** chain setup → finisher with a banner flash of the operator's iconic story
- **Reads** counter specific move types — adds prediction depth
- **Scenario-aware damage**: Chesky +50% in Pre-PMF; Madhavan +50% in Monetization; …
- **Ultimates**: 8 momentum + 100 super meter, character-defining signature moves

## Credits

- Podcast + newsletter data: [Lenny's Newsletter](https://www.lennysnewsletter.com/)
- Built with [Replit Agent](https://replit.com/agent)
- Inspired by Street Fighter II, King of Fighters, Slay the Spire, and [LennyRPG](https://www.lennysnewsletter.com/p/how-i-built-lennyrpg) by Ben Shih

## Status

`init` — May 12, 2026. Daily build-in-public progress on X with #lennysbuildathon.
