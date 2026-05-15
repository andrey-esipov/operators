import { useGame } from '../state/game'
import { Sfx } from '../lib/audio'
import { FIGHTERS } from '../data/fighters'

/**
 * Credits / About page. Surfaced from the main menu's settings row.
 *
 * Buildathon judging weights "Use of Replit" — this page is the explicit
 * attribution surface that names every tool, dataset, and inspiration that
 * shaped the entry. Doubles as a record of HOW the game was built so the
 * Replit team can see the stack at a glance.
 */
export function Credits() {
  const setPhase = useGame((s) => s.setPhase)
  return (
    <div className="relative w-full h-full overflow-y-auto">
      <div
        className="absolute inset-0 -z-10 pointer-events-none"
        style={{
          background:
            'radial-gradient(circle at 30% 20%, #3B2360 0%, transparent 60%), radial-gradient(circle at 70% 80%, #7209B7 0%, transparent 50%), linear-gradient(180deg, #1A0F2E 0%, #0F0A1A 100%)',
        }}
      />

      <div className="sticky top-0 z-20 px-6 py-4 backdrop-blur-md flex items-center justify-between" style={{ background: 'rgba(15,10,26,0.85)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <button
          onClick={() => { Sfx.menuMove(); setPhase('menu') }}
          className="font-display text-[10px] tracking-widest text-white/70"
        >
          ← MAIN MENU
        </button>
        <h1
          className="font-display text-2xl tracking-widest"
          style={{ color: '#FFD60A', textShadow: '4px 4px 0 black' }}
        >
          CREDITS
        </h1>
        <div className="font-display text-[8px] tracking-widest text-white/40">
          v1.0 · #LENNYSBUILDATHON
        </div>
      </div>

      <div className="px-6 py-8 max-w-3xl mx-auto space-y-6">
        <Section title="THE GAME" accent="#FFD60A">
          <p className="font-body text-lg text-white/85 leading-relaxed">
            <strong className="font-display tracking-widest text-base" style={{ color: '#FFD60A' }}>OPERATORS</strong>
            {' '}is a turn-based tactical fighter built on the 298-episode archive of
            Lenny's Podcast. {FIGHTERS.length} guests are playable. Every move name is a real
            framework. Every flavor quote is verbatim with an episode + timestamp link.
            Built for the Lenny × Replit Buildathon — submission window 2026.
          </p>
        </Section>

        <Section title="DATA · LENNY'S NEWSLETTER & PODCAST" accent="#06D6A0">
          <ul className="font-body text-base text-white/80 space-y-1.5 leading-snug">
            <li>• 298 podcast episodes (4.56M words of transcript)</li>
            <li>• 354 newsletter posts (1.09M words)</li>
            <li>• Hosted by Lenny Rachitsky — used with admiration, not affiliation</li>
            <li>• Episodes linked at exact timestamps on YouTube</li>
          </ul>
        </Section>

        <Section title="BUILT WITH · REPLIT AGENT & CLAUDE CODE" accent="#F72585">
          <ul className="font-body text-base text-white/80 space-y-1.5 leading-snug">
            <li>• <strong>Replit Agent</strong> — primary build agent; project scaffold, combat state machine, all React screens, daily-tournament backend</li>
            <li>• <strong>Claude Code</strong> (Anthropic) — escape-hatch for tricky balancing math, animation timing, audio pipelines</li>
            <li>• <strong>Vite 6 + React 19 + TypeScript</strong> — frontend stack</li>
            <li>• <strong>Tailwind CSS 4 + Framer Motion + Zustand</strong> — UI / animations / state</li>
            <li>• <strong>Replit Deployments</strong> — static hosting at operators.replit.app</li>
          </ul>
        </Section>

        <Section title="ART · pixel-perfect 16-bit sprites" accent="#00B4D8">
          <ul className="font-body text-base text-white/80 space-y-1.5 leading-snug">
            <li>• <strong>Azure OpenAI gpt-image-2</strong> — sprite generator</li>
            <li>• Edit-from-stance pipeline: each fighter's stance is generated from a prose bio,
              then attack/win/lose poses are edited from that stance — preserves face/outfit
              consistency across all four poses</li>
            <li>• {FIGHTERS.length} fighters × 4 poses = {FIGHTERS.length * 4} sprites total</li>
            <li>• 8 parallax stage backgrounds with ambient motion layers</li>
            <li>• Title-screen artwork hand-prompted to evoke SF II / KoF '98 / SF III Third Strike</li>
          </ul>
        </Section>

        <Section title="AUDIO · original score + voice acting" accent="#FCBF49">
          <ul className="font-body text-base text-white/80 space-y-1.5 leading-snug">
            <li>• <strong>Suno</strong> — original soundtrack (menu + 2 battle tracks)</li>
            <li>• <strong>Azure OpenAI gpt-4o-mini-tts</strong> — fighter voice lines (9 per fighter; tone-tuned per character via prose voice instructions)</li>
            <li>• Procedural chiptune fallback synthesized on-device via WebAudio</li>
            <li>• SFX: hand-tuned WebAudio oscillators (hit / crit / combo / K.O.)</li>
          </ul>
        </Section>

        <Section title="DESIGN INSPIRATION" accent="#90E0EF">
          <ul className="font-body text-base text-white/80 space-y-1.5 leading-snug">
            <li>• <strong>Street Fighter II / SF III Third Strike</strong> — HUD, FIGHT! banner, K.O. cinematic</li>
            <li>• <strong>King of Fighters '98</strong> — character select aesthetic</li>
            <li>• <strong>Marvel Snap</strong> — card-style fighter profile cards</li>
            <li>• <strong>LennyRPG</strong> by Ben Shih — the proof that the dataset deserves a game</li>
          </ul>
        </Section>

        <Section title="THE OPERATOR BEHIND THE CURTAIN" accent="#E63946">
          <p className="font-body text-lg text-white/85 leading-relaxed">
            Vibe-coded by one solo founder. If you played this and it made you smile,
            <a
              href="https://twitter.com/intent/tweet?text=Just%20played%20OPERATORS%20%E2%80%94%20a%20tactical%20fighter%20built%20on%20Lenny's%20podcast%20data%20%23lennysbuildathon&url=https%3A%2F%2Foperators.replit.app"
              target="_blank"
              rel="noopener noreferrer"
              className="px-1 mx-1"
              style={{ color: '#00B4D8', borderBottom: '1px dashed #00B4D8', textDecoration: 'none' }}
            >
              tell Lenny on X
            </a>
            with #lennysbuildathon. That's the only way the dataset's stewards know it landed.
          </p>
        </Section>

        <div className="text-center py-8">
          <div className="font-display text-[8px] tracking-widest text-white/40">
            ◇ OPERATORS · v1.0 · #LENNYSBUILDATHON · operators.replit.app ◇
          </div>
        </div>
      </div>
    </div>
  )
}

function Section({ title, accent, children }: { title: string; accent: string; children: React.ReactNode }) {
  return (
    <div
      className="p-4"
      style={{
        background: 'rgba(15,10,26,0.65)',
        border: `2px solid ${accent}`,
        boxShadow: `inset -2px -2px 0 rgba(0,0,0,0.5), inset 2px 2px 0 rgba(255,255,255,0.06), 0 0 18px ${accent}33`,
      }}
    >
      <div
        className="font-display text-base tracking-widest mb-3 pb-2"
        style={{ color: accent, borderBottom: `1px solid ${accent}66`, textShadow: '2px 2px 0 black' }}
      >
        ▌ {title}
      </div>
      {children}
    </div>
  )
}
