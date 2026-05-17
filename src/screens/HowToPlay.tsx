import { useGame } from '../state/game'
import { Sfx } from '../lib/audio'

export function HowToPlay() {
  const setPhase = useGame((s) => s.setPhase)

  return (
    <div className="relative w-full h-full overflow-y-auto">
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(circle at top, #3B2360 0%, #1A0F2E 60%, #0F0A1A 100%)',
        }}
      />

      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => {
              Sfx.menuMove()
              setPhase('menu')
            }}
            className="font-display text-[10px] tracking-widest text-white/70"
          >
            ← MAIN MENU
          </button>
          <h1
            className="font-display text-3xl tracking-widest"
            style={{ color: '#FFD60A', textShadow: '4px 4px 0 black, 0 0 12px #F77F00' }}
          >
            HOW TO PLAY
          </h1>
          <div style={{ width: 80 }} />
        </div>

        <p className="font-body text-2xl text-white/90 mb-8 text-center max-w-3xl mx-auto leading-snug">
          OPERATORS is a turn-based fighter where 64 guests from Lenny&apos;s Podcast battle on pixel-art
          stages. Every move is named after a real framework. Every quote is verbatim.
        </p>

        {/* RESOURCES */}
        <Section title="RESOURCES" color="#FFD60A">
          <ResourceCard
            name="HP"
            color="#06D6A0"
            value="850–1100"
            desc="Health. Drops to 0 = K.O. Best of 3 rounds wins the match."
          />
          <ResourceCard
            name="MOMENTUM"
            color="#FCBF49"
            value="3 → 10"
            desc="Currency for moves. Start at 3. Gain +2 each turn (caps at 10)."
          />
          <ResourceCard
            name="SUPER METER"
            color="#F72585"
            value="0 → 100"
            desc="Powers Ultimates AND EX moves. +15 on landed hits, +20 on hits taken. PERSISTS across rounds."
          />
          <ResourceCard
            name="CONVICTION"
            color="#E63946"
            value="0 → 100"
            desc="Second resource. Chipped by every hit. Regens +5/turn. At ZERO you SHATTER (skip a turn, next hit you take +75%)."
          />
        </Section>

        {/* MOVES */}
        <Section title="THE 5-MOVE KIT" color="#06D6A0">
          <p className="font-body text-xl text-white/80 mb-3 col-span-full">
            Every fighter has the same five slots. Names + flavor are unique. Quotes are verbatim from real episodes.
          </p>
          <MoveCardRow
            type="LIGHT"
            color="#90E0EF"
            cost="1–2 momentum"
            role="Fast jab. Low damage. Chips a little Conviction. Often applies a debuff."
            ex="Chesky · USE YOUR OWN PRODUCT (applies HONEST FEEDBACK)"
          />
          <MoveCardRow
            type="HEAVY"
            color="#E63946"
            cost="3–4 momentum"
            role="Hard hit. Solid Conviction chip (-12). 2-turn cooldown."
            ex="Doshi · TWO ICPs GLUED TOGETHER (90 dmg, CRIT vs HONEST)"
          />
          <MoveCardRow
            type="SETUP"
            color="#06D6A0"
            cost="2 momentum"
            role="Self-buff or opponent-debuff. Required to unlock the combo finisher."
            ex="Chesky · FOUNDER MODE (apply F-MODE buff)"
          />
          <MoveCardRow
            type="COMBO"
            color="#FFD60A"
            cost="2–3 momentum"
            role="Finisher. Big bonus damage when chained from the right setup. Best Conviction chip per turn."
            ex="Chesky · AIR-DESIGN (after FOUNDER MODE = BUILT THE COMPANY I'D WANT TO WORK AT)"
          />
          <MoveCardRow
            type="ULTIMATE"
            color="#F72585"
            cost="5 momentum + 100 super"
            role="Character-defining mega move. +50% damage when the fighter's setup status is active. No cooldown."
            ex="Chesky · AIR IS A CITY · 220 dmg (+50% with FOUNDER MODE)"
          />
        </Section>

        {/* EX MOVES */}
        <Section title="EX MOVES — SHIFT-CAST" color="#00E5FF">
          <div className="col-span-full font-body text-xl text-white/85 space-y-3">
            <p>
              <span className="font-display text-base" style={{ color: '#00E5FF' }}>⚡ EX:</span>{' '}
              Hold <span className="font-display text-base text-white">[SHIFT]</span> while pressing a move key
              (or shift-click the card) to <em>EX-cast</em> a non-ult move. Costs <span style={{ color: '#F72585' }}>−50 super</span> on
              top of momentum. Deals <span style={{ color: '#00E5FF' }}>+50% damage</span> and chips an extra ×1.5 conviction.
            </p>
            <p className="text-white/70">
              EX gives the super meter a second, frequent sink. If you don&apos;t want to wait for ult, spend 50
              super for an amplified light/heavy/combo right now. A cyan ⚡EX badge appears on each move card
              when the meter is full enough to afford it.
            </p>
          </div>
        </Section>

        {/* CONVICTION + SHATTER */}
        <Section title="CONVICTION & SHATTER" color="#E63946">
          <div className="col-span-full font-body text-xl text-white/85 space-y-3">
            <p>
              <span className="font-display text-base" style={{ color: '#E63946' }}>CONVICTION:</span>{' '}
              Every fighter has a Conviction bar under their HP. Each hit chips it (Light −5 · Setup −3 ·
              Heavy −12 · Combo −15 · Ult −40). Crits chip ×2. EX moves chip ×1.5. A correctly-called READ
              chips −30 with no HP damage. Conviction regens +5 at the start of each turn (paused while
              shattered).
            </p>
            <p>
              <span className="font-display text-base" style={{ color: '#FFD60A' }}>SHATTER:</span>{' '}
              When Conviction reaches zero, the fighter is <span style={{ color: '#E63946' }}>SHATTERED</span>.
              Their next turn is consumed by a cinematic — they skip it entirely. The attacker&apos;s very
              next damaging hit lands for <span style={{ color: '#FFD60A' }}>+75% damage</span>. Then Conviction
              resets to 30 and play resumes.
            </p>
            <p className="text-white/70">
              Tactical takeaway: HP isn&apos;t the only path to victory. A focused chip strategy (Heavies +
              correct Reads) can open the punish window in 6–8 turns regardless of how much HP your opponent
              has.
            </p>
          </div>
        </Section>

        {/* SIGNATURE SEQUENCES */}
        <Section title="SIGNATURE SEQUENCES ★" color="#FFD60A">
          <div className="col-span-full font-body text-xl text-white/85 space-y-3">
            <p>
              <span className="font-display text-base" style={{ color: '#FFD60A' }}>★ SIGNATURE:</span>{' '}
              When your <span style={{ color: '#F72585' }}>ULT</span> lands on a{' '}
              <span style={{ color: '#E63946' }}>SHATTERED</span> opponent, the game freezes into a 4-second
              cinematic with the operator&apos;s iconic line, echo bursts, and the +75% damage bonus stacking
              on top of the ult&apos;s base + setup-status modifier.
            </p>
            <p className="text-white/70">
              The optimal kill chain: build super → chip conviction with heavies and reads → time your ult on
              the shatter window → SIGNATURE. Almost always a K.O.
            </p>
          </div>
        </Section>

        {/* SCENARIOS */}
        <Section title="SCENARIO BONUSES" color="#F72585">
          <p className="font-body text-xl text-white/80 mb-3 col-span-full">
            Every fight has a business <em>scenario</em>. Fighters do bonus damage when their framework actually applies.
          </p>
          <ScenarioRow name="Brian Chesky" bonus="+50% in PRE-PMF & CRISIS" />
          <ScenarioRow name="Madhavan Ramanujam" bonus="+50% in MONETIZATION" />
          <ScenarioRow name="Cat Wu" bonus="+50% in AI-NATIVE" />
          <ScenarioRow name="Evan Spiegel" bonus="+50% in DISTRIBUTION" />
          <ScenarioRow name="Nick Turley" bonus="+50% in HYPERGROWTH" />
          <ScenarioRow name="Shreyas Doshi" bonus="+40% in PLATEAU & IPO-PREP" />
          <ScenarioRow name="Marty Cagan" bonus="+30% in HYPERGROWTH & PLATEAU" />
          <ScenarioRow name="Lenny ★" bonus="+20% across ALL scenarios + Pattern Matching ULT" />
        </Section>

        {/* COMBOS & READS */}
        <Section title="COMBOS, READS & CRITS" color="#FFD60A">
          <div className="col-span-full font-body text-xl text-white/85 space-y-3">
            <p>
              <span className="font-display text-base" style={{ color: '#FFD60A' }}>COMBO:</span>{' '}
              Chain SETUP → COMBO finisher in consecutive turns to trigger a gold banner flash with bonus
              damage. The banner is the operator&apos;s real story (e.g.{' '}
              <em>BUILT THE COMPANY I&apos;D WANT TO WORK AT</em>).
            </p>
            <p>
              <span className="font-display text-base" style={{ color: '#00B4D8' }}>READ:</span>{' '}
              Spend 1 momentum to predict the opponent&apos;s next move type. If correct: their hit deals
              50% damage, you gain +20 super AND chip 30 of their Conviction. Reads are the most efficient
              shatter setup if you can call the move type.
            </p>
            <p>
              <span className="font-display text-base" style={{ color: '#EF233C' }}>CRIT:</span>{' '}
              12% chance per hit. 1.6× damage on HP. 2× chip on Conviction. White flash on screen. Builds
              super meter faster.
            </p>
          </div>
        </Section>

        {/* TURN FLOW */}
        <Section title="TURN FLOW" color="#90E0EF">
          <div className="col-span-full grid grid-cols-1 md:grid-cols-4 gap-3 font-body text-lg">
            <FlowStep n="1" text="Active player picks 1 move (light/heavy/setup/combo/ultimate) — or Shift+key for EX." />
            <FlowStep n="2" text="Move resolves: HP damage + Conviction chip + status + real podcast quote." />
            <FlowStep n="3" text="Opponent gains super from being hit. If their Conviction hit 0 → SHATTER cinematic." />
            <FlowStep n="4" text="Each fighter gains +2 momentum & +5 conviction at the start of their turn." />
          </div>
          <p className="col-span-full font-body text-lg text-white/70 mt-2">
            90-second round timer. If time runs out, higher HP wins the round. Best of 3 rounds. Super
            meter persists across rounds — bank it for a clutch round-2 ult.
          </p>
        </Section>

        {/* TIPS */}
        <Section title="TIPS" color="#06D6A0">
          <div className="col-span-full font-body text-xl text-white/85 space-y-2">
            <p>• <span className="font-display text-base text-white">Story Mode</span> is the campaign — pick any of the 64 operators and play their 8-chapter run hosted by Lenny. Eight marquee fighters (Amjad, Chesky, Boris, Altman, Benioff, Fei-Fei, Elena, Reid) have hand-written career arcs; look for the gold ★ in Character Select.</p>
            <p>• Hover any fighter on the select screen to see their archetype + signature ult.</p>
            <p>• Stack a SETUP before unleashing your Ultimate — the +50% signature multiplier applies when your buff is active.</p>
            <p>• Pay attention to the scenario at the top of the fight screen — that&apos;s where you do bonus damage.</p>
            <p>• Chip Conviction with Heavies and Reads. A correctly-called Read is the single biggest Conviction swing (−30).</p>
            <p>• When the super meter is full but you can&apos;t ult, watch for the &ldquo;⚡ NEED N MOM&rdquo; hint next to the meter — that&apos;s your gating reason.</p>
            <p>• Press <span className="font-display text-base text-white">[ESC]</span> to quit a match back to the menu.</p>
            <p>• <span className="font-display text-base text-white">Keyboard shortcuts</span> during combat: <span className="font-display text-base text-white">[Z] [X] [C] [V]</span> cast moves 1–4 · <span className="font-display text-base text-white">[B]</span> ult · <span className="font-display text-base text-white">[R]</span> READ · <span className="font-display text-base text-white">[SHIFT]+key</span> EX (costs 50 super). <span className="font-display text-base text-white">[1]–[5]</span> work as alternates for ZXCVB.</p>
            <p>• <span className="font-display text-base text-white">Difficulty</span> tunes the bots in every single-player mode: <span style={{ color: '#06D6A0' }}>EASY</span> picks bots who are weak on the current scenario · <span style={{ color: '#FCBF49' }}>NORMAL</span> is balanced · <span style={{ color: '#E63946' }}>HARD</span> faces the scenario specialist with +30–50% damage on that stage AND occasionally EX-amplifies their attacks. Lenny is always the final boss in Story Mode.</p>
            <p>• Every move you play unlocks a quote in your <span style={{ color: '#FFD60A' }}>Quote Bank</span>. Beat Story Mode to see how many frameworks you&apos;ve collected.</p>
          </div>
        </Section>

        <div className="text-center mt-10 mb-4">
          <button
            onClick={() => {
              Sfx.menuSelect()
              setPhase('menu')
            }}
            className="px-8 py-3 font-display text-base tracking-widest"
            style={{
              background: 'linear-gradient(180deg, #F77F0044, #E6394644)',
              color: 'white',
              border: '2px solid #E63946',
              boxShadow:
                'inset -2px -2px 0 rgba(0,0,0,0.6), inset 2px 2px 0 rgba(255,255,255,0.2)',
            }}
          >
            BACK TO MENU
          </button>
        </div>
      </div>
    </div>
  )
}

function Section({
  title,
  color,
  children,
}: {
  title: string
  color: string
  children: React.ReactNode
}) {
  return (
    <section className="mb-8">
      <div
        className="font-display text-xl tracking-widest mb-3 pb-2"
        style={{ color, borderBottom: `2px solid ${color}` }}
      >
        ▌ {title}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">{children}</div>
    </section>
  )
}

function ResourceCard({
  name,
  color,
  value,
  desc,
}: {
  name: string
  color: string
  value: string
  desc: string
}) {
  return (
    <div
      className="p-4"
      style={{
        background: 'rgba(15,10,26,0.7)',
        border: `2px solid ${color}`,
        boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.5)',
      }}
    >
      <div className="font-display text-[10px] tracking-widest" style={{ color }}>
        {name}
      </div>
      <div className="font-num text-3xl tabular-nums my-2" style={{ color: 'white' }}>
        {value}
      </div>
      <div className="font-body text-lg text-white/80 leading-snug">{desc}</div>
    </div>
  )
}

function MoveCardRow({
  type,
  color,
  cost,
  role,
  ex,
}: {
  type: string
  color: string
  cost: string
  role: string
  ex: string
}) {
  return (
    <div
      className="p-3 col-span-full md:col-span-1"
      style={{
        background: `linear-gradient(180deg, ${color}22, ${color}11)`,
        border: `2px solid ${color}`,
        boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.5)',
      }}
    >
      <div className="flex items-baseline gap-2">
        <span className="font-display text-[9px] tracking-widest" style={{ color }}>
          {type}
        </span>
        <span className="font-body text-base text-white/60">· {cost}</span>
      </div>
      <p className="font-body text-base text-white mt-1 leading-tight">{role}</p>
      <p className="font-body text-base text-white/60 italic mt-2">{ex}</p>
    </div>
  )
}

function ScenarioRow({ name, bonus }: { name: string; bonus: string }) {
  return (
    <div
      className="p-3 col-span-full md:col-span-1"
      style={{
        background: 'rgba(0,0,0,0.4)',
        border: '1px solid rgba(255,255,255,0.2)',
      }}
    >
      <div className="font-display text-[9px] tracking-widest text-white">{name}</div>
      <div className="font-body text-base mt-1" style={{ color: '#FFD60A' }}>
        {bonus}
      </div>
    </div>
  )
}

function FlowStep({ n, text }: { n: string; text: string }) {
  return (
    <div className="flex gap-2 items-start">
      <span
        className="font-display text-base flex items-center justify-center"
        style={{
          color: '#FFD60A',
          width: 28,
          height: 28,
          border: '2px solid #FFD60A',
          flexShrink: 0,
        }}
      >
        {n}
      </span>
      <span className="text-white/90">{text}</span>
    </div>
  )
}
