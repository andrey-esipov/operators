import { useEffect, useState } from 'react'
import { useGame } from '../state/game'
import { Sfx } from '../lib/audio'
import { Announcer } from '../lib/announcer'

/**
 * Generate Your Fighter — 4-question personalization flow.
 *
 * After winning Arcade Mode (defeating Lenny), the player is prompted
 * to answer 4 questions that build a custom Fighter Card with their
 * name, archetype, and 5 framework-style moves tailored to their answers.
 *
 * The output is a shareable card image (rendered as a stylized HTML
 * card with the operator-of-the-day visual language). Tweet button
 * pre-fills #lennysbuildathon.
 *
 * Storage: localStorage key `operators:my-fighter`.
 */

interface CustomFighter {
  name: string
  role: string
  stage: string
  framework: string
  dilemma: string
  archetype: string
  accent: string
  moves: Array<{ name: string; type: string; quote: string }>
  ult: { name: string; quote: string }
  createdAt: number
}

const ROLES = [
  { label: 'FOUNDER',    accent: '#E63946', archetype: 'AGGRO · FOUNDER MODE' },
  { label: 'PM',         accent: '#0077B6', archetype: 'STRATEGY · LOCK' },
  { label: 'ENGINEER',   accent: '#06D6A0', archetype: 'BUILDER · COMPOUND' },
  { label: 'DESIGNER',   accent: '#F72585', archetype: 'ARTISAN · TASTE' },
  { label: 'MARKETER',   accent: '#FCBF49', archetype: 'DISTRO · REMARKABLE' },
  { label: 'OPERATOR',   accent: '#7209B7', archetype: 'POLYMATH · ADAPTIVE' },
] as const

const STAGES = [
  { label: 'PRE-PMF',      desc: 'Still hunting fit' },
  { label: 'HYPERGROWTH',  desc: 'Scaling weekly' },
  { label: 'PLATEAU',      desc: 'Need a new vector' },
  { label: 'AI-NATIVE',    desc: 'Building on models' },
  { label: 'MONETIZATION', desc: 'Pricing + contracts' },
  { label: 'CRISIS',       desc: 'Cash is short' },
] as const

const FRAMEWORKS = [
  'Founder Mode',
  'LNO Framework',
  'Outcome Pricing',
  'Permission Marketing',
  'Continuous Discovery',
  'Thinking in Bets',
  'Calm Company',
  'Distribution Moat',
  'Agent Loop',
  'Ship Small',
] as const

const DILEMMAS = [
  { label: 'I want to ship faster', moveBase: 'SHIP SMALL' },
  { label: 'I want to learn before building', moveBase: 'CONTINUOUS DISCOVERY' },
  { label: 'I want to charge more', moveBase: 'OUTCOME PRICING' },
  { label: 'I want to find product–market fit', moveBase: 'CUSTOMER DEV LOOP' },
  { label: 'I want to win the long game', moveBase: 'COMPOUND TRUST' },
  { label: 'I want to build with AI', moveBase: 'AGENT LOOP' },
] as const

function buildFighter(args: {
  name: string
  role: string
  stage: string
  framework: string
  dilemma: string
}): CustomFighter {
  const roleEntry = ROLES.find((r) => r.label === args.role) ?? ROLES[0]
  const dilemmaEntry = DILEMMAS.find((d) => d.label === args.dilemma) ?? DILEMMAS[0]

  const moves = [
    {
      type: 'light',
      name: `${args.framework.toUpperCase()} JAB`,
      quote: `My version of ${args.framework} — light + repeatable.`,
    },
    {
      type: 'heavy',
      name: dilemmaEntry.moveBase,
      quote: dilemmaEntry.label + '.',
    },
    {
      type: 'setup',
      name: `${args.stage} FOCUS`,
      quote: `In ${args.stage.toLowerCase()}, this is what I optimize for.`,
    },
    {
      type: 'combo',
      name: 'CONVICTION CHAIN',
      quote: 'I believe this because I have tested it.',
    },
    {
      type: 'ultimate',
      name: `${args.name.toUpperCase()} DOCTRINE`,
      quote: `When in doubt, I ${args.dilemma.replace(/^I want to /, '').toLowerCase()}.`,
    },
  ]

  return {
    name: args.name || 'OPERATOR',
    role: args.role,
    stage: args.stage,
    framework: args.framework,
    dilemma: args.dilemma,
    archetype: roleEntry.archetype,
    accent: roleEntry.accent,
    moves: moves.slice(0, 5),
    ult: { name: moves[4].name, quote: moves[4].quote },
    createdAt: Date.now(),
  }
}

const STORAGE_KEY = 'operators:my-fighter'

export function GenerateFighter() {
  const setPhase = useGame((s) => s.setPhase)
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [stage, setStage] = useState('')
  const [framework, setFramework] = useState('')
  const [dilemma, setDilemma] = useState('')
  const [fighter, setFighter] = useState<CustomFighter | null>(null)

  // Load existing on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as CustomFighter
        setFighter(parsed)
        setStep(5)  // skip to result
      }
    } catch {
      // ignore
    }
  }, [])

  function next() {
    Sfx.menuSelect()
    setStep((s) => s + 1)
  }

  function generate() {
    Sfx.menuSelect()
    Announcer.ultimate()  // dramatic flourish
    const f = buildFighter({ name, role, stage, framework, dilemma })
    setFighter(f)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(f)) } catch { /* quota */ }
    setStep(5)
  }

  function tweet() {
    if (!fighter) return
    Sfx.menuSelect()
    const text = `I'm ${fighter.name} — ${fighter.archetype} fighter, built from my real PM/founder profile. Came out of OPERATORS, a tactical fighter on @lennysan's podcast data. #lennysbuildathon`
    const url = 'https://operators.replit.app'
    window.open(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
      '_blank',
      'noopener,noreferrer',
    )
  }

  function reset() {
    Sfx.menuMove()
    setFighter(null)
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* */ }
    setName(''); setRole(''); setStage(''); setFramework(''); setDilemma('')
    setStep(0)
  }

  return (
    <div className="relative w-full h-full overflow-y-auto">
      <div
        className="fixed inset-0 -z-10 pointer-events-none"
        style={{
          background: 'radial-gradient(circle at 50% 20%, #7209B722 0%, #1A0F2E 50%, #0F0A1A 100%)',
        }}
      />

      {/* Header */}
      <div
        className="sticky top-0 z-20 px-6 py-3 backdrop-blur-md flex items-center justify-between"
        style={{ background: 'rgba(15,10,26,0.92)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}
      >
        <button
          onClick={() => { Sfx.menuMove(); setPhase('menu') }}
          className="font-display text-[10px] tracking-widest text-white/70"
        >
          ← MAIN MENU
        </button>
        <h1
          className="font-display text-xl tracking-widest"
          style={{ color: '#FFD60A', textShadow: '3px 3px 0 black' }}
        >
          GENERATE YOUR FIGHTER
        </h1>
        <div className="font-display text-[9px] tracking-widest text-white/60">
          {step < 5 ? `STEP ${step + 1} / 5` : '★ READY ★'}
        </div>
      </div>

      <div className="p-8 pb-24 max-w-4xl mx-auto">
        {step === 0 && (
          <StepCard title="WHAT'S YOUR NAME, OPERATOR?" subtitle="The world needs to know who's fighting.">
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="YOUR NAME"
              className="w-full px-4 py-3 font-display text-2xl text-white text-center tracking-widest"
              style={{
                background: 'rgba(0,0,0,0.5)',
                border: '2px solid #FFD60A',
                outline: 'none',
                textShadow: '2px 2px 0 black',
              }}
            />
            <NextButton disabled={!name.trim()} onClick={next} label="NEXT →" />
          </StepCard>
        )}

        {step === 1 && (
          <StepCard title="WHAT'S YOUR ROLE?" subtitle="Each role gets a different fighting archetype.">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {ROLES.map((r) => (
                <Tile
                  key={r.label}
                  selected={role === r.label}
                  accent={r.accent}
                  onClick={() => { setRole(r.label); Sfx.menuMove() }}
                  label={r.label}
                  desc={r.archetype}
                />
              ))}
            </div>
            <NextButton disabled={!role} onClick={next} label="NEXT →" />
          </StepCard>
        )}

        {step === 2 && (
          <StepCard title="WHAT STAGE ARE YOU IN?" subtitle="Where you are right now shapes your moves.">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {STAGES.map((s) => (
                <Tile
                  key={s.label}
                  selected={stage === s.label}
                  accent="#06D6A0"
                  onClick={() => { setStage(s.label); Sfx.menuMove() }}
                  label={s.label}
                  desc={s.desc}
                />
              ))}
            </div>
            <NextButton disabled={!stage} onClick={next} label="NEXT →" />
          </StepCard>
        )}

        {step === 3 && (
          <StepCard title="PICK A FRAMEWORK YOU LIVE BY" subtitle="This becomes your signature jab.">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {FRAMEWORKS.map((fw) => (
                <Tile
                  key={fw}
                  selected={framework === fw}
                  accent="#F72585"
                  onClick={() => { setFramework(fw); Sfx.menuMove() }}
                  label={fw.toUpperCase()}
                />
              ))}
            </div>
            <NextButton disabled={!framework} onClick={next} label="NEXT →" />
          </StepCard>
        )}

        {step === 4 && (
          <StepCard title="WHAT ARE YOU TRYING TO DO RIGHT NOW?" subtitle="This becomes your heavy + ultimate.">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {DILEMMAS.map((d) => (
                <Tile
                  key={d.label}
                  selected={dilemma === d.label}
                  accent="#FCBF49"
                  onClick={() => { setDilemma(d.label); Sfx.menuMove() }}
                  label={d.label}
                  desc={`MOVE: ${d.moveBase}`}
                />
              ))}
            </div>
            <NextButton disabled={!dilemma} onClick={generate} label="⚡ GENERATE MY FIGHTER" />
          </StepCard>
        )}

        {step === 5 && fighter && (
          <FighterCard fighter={fighter} onTweet={tweet} onReset={reset} />
        )}
      </div>
    </div>
  )
}

function StepCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2
          className="font-display tracking-widest"
          style={{
            color: '#FFD60A',
            fontSize: 28,
            letterSpacing: '0.12em',
            textShadow: '4px 4px 0 black',
          }}
        >
          {title}
        </h2>
        <p className="font-body text-lg text-white/70 mt-2">{subtitle}</p>
      </div>
      {children}
    </div>
  )
}

function Tile({
  selected, accent, onClick, label, desc,
}: {
  selected: boolean; accent: string; onClick: () => void; label: string; desc?: string
}) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-4 text-left transition-transform hover:translate-y-[-2px]"
      style={{
        background: selected
          ? `linear-gradient(180deg, ${accent}55, ${accent}22)`
          : 'rgba(0,0,0,0.3)',
        color: 'white',
        border: `2px solid ${selected ? accent : 'rgba(255,255,255,0.18)'}`,
        boxShadow: selected
          ? `0 0 16px ${accent}88, inset -2px -2px 0 rgba(0,0,0,0.5)`
          : 'inset -2px -2px 0 rgba(0,0,0,0.4)',
      }}
    >
      <div
        className="font-display text-base tracking-widest"
        style={{ color: selected ? accent : 'white' }}
      >
        {label}
      </div>
      {desc && <p className="font-body text-sm text-white/70 mt-1">{desc}</p>}
    </button>
  )
}

function NextButton({ disabled, onClick, label }: { disabled: boolean; onClick: () => void; label: string }) {
  return (
    <div className="flex justify-center mt-6">
      <button
        disabled={disabled}
        onClick={onClick}
        onMouseEnter={Sfx.menuMove}
        className="px-8 py-3 font-display text-lg tracking-widest transition-transform hover:translate-y-[-2px]"
        style={{
          background: disabled ? '#1A1230' : 'linear-gradient(180deg, #F7258555, #7209B755)',
          color: 'white',
          border: `2px solid ${disabled ? '#444' : '#F72585'}`,
          boxShadow: disabled
            ? 'inset -2px -2px 0 rgba(0,0,0,0.4)'
            : 'inset -2px -2px 0 rgba(0,0,0,0.5), inset 2px 2px 0 rgba(255,255,255,0.2), 0 0 24px #F7258555',
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
          letterSpacing: '4px',
          textShadow: '2px 2px 0 black',
        }}
      >
        {label}
      </button>
    </div>
  )
}

function FighterCard({
  fighter, onTweet, onReset,
}: {
  fighter: CustomFighter; onTweet: () => void; onReset: () => void
}) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2
          className="font-display tracking-widest"
          style={{
            color: '#FFD60A',
            fontSize: 28,
            letterSpacing: '0.12em',
            textShadow: '4px 4px 0 black, 0 0 18px #F77F00',
          }}
        >
          ★ YOU ARE THE FIGHTER ★
        </h2>
        <p className="font-body text-lg text-white/70 mt-2">Welcome to the roster, {fighter.name}.</p>
      </div>

      {/* The card */}
      <div
        id="fighter-card"
        className="mx-auto max-w-2xl p-6"
        style={{
          background: `linear-gradient(135deg, ${fighter.accent}33 0%, rgba(15,10,26,0.92) 60%, ${fighter.accent}22 100%)`,
          border: `3px solid ${fighter.accent}`,
          boxShadow: `0 0 36px ${fighter.accent}66, inset -3px -3px 0 rgba(0,0,0,0.5), inset 3px 3px 0 rgba(255,255,255,0.15)`,
        }}
      >
        {/* Header */}
        <div className="flex items-baseline justify-between">
          <div
            className="font-display text-[9px] tracking-widest"
            style={{ color: fighter.accent }}
          >
            ★ OPERATOR · {fighter.role}
          </div>
          <div
            className="font-display text-[8px] tracking-widest text-white/50"
          >
            BUILT FROM YOUR PROFILE
          </div>
        </div>
        <div
          className="font-display tracking-widest mt-2"
          style={{
            color: fighter.accent,
            fontSize: 52,
            letterSpacing: '0.06em',
            lineHeight: 0.95,
            textShadow: `6px 6px 0 black, 0 0 24px ${fighter.accent}88`,
          }}
        >
          {fighter.name.toUpperCase()}
        </div>
        <div className="font-display text-[10px] tracking-widest text-white/70 mt-2">
          {fighter.archetype}
        </div>
        <div className="font-body text-base text-white/85 mt-3">
          Stage: <span style={{ color: fighter.accent }}>{fighter.stage}</span> · Signature framework: <span style={{ color: fighter.accent }}>{fighter.framework}</span>
        </div>

        {/* Moves */}
        <div className="mt-5 space-y-2">
          {fighter.moves.map((m, i) => (
            <div
              key={i}
              className="flex items-baseline gap-3 p-2"
              style={{
                background: 'rgba(0,0,0,0.4)',
                border: '1px solid rgba(255,255,255,0.1)',
              }}
            >
              <span
                className="font-display text-[8px] tracking-widest"
                style={{ color: fighter.accent, minWidth: 60 }}
              >
                {m.type.toUpperCase()}
              </span>
              <span className="font-display text-base text-white" style={{ minWidth: 200 }}>
                {m.name}
              </span>
              <span className="font-body italic text-base text-white/70">&ldquo;{m.quote}&rdquo;</span>
            </div>
          ))}
        </div>

        {/* Ult banner */}
        <div
          className="mt-4 p-3"
          style={{
            background: `linear-gradient(135deg, ${fighter.accent}44, rgba(0,0,0,0.5))`,
            border: `2px solid ${fighter.accent}`,
            boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.5)',
          }}
        >
          <div className="font-display text-[9px] tracking-widest" style={{ color: fighter.accent }}>
            ⚡ SIGNATURE ULTIMATE
          </div>
          <div className="font-display text-lg tracking-widest text-white mt-1">
            {fighter.ult.name}
          </div>
          <p className="font-body italic text-base text-white/90 mt-1">
            &ldquo;{fighter.ult.quote}&rdquo;
          </p>
        </div>

        {/* Footer */}
        <div className="font-display text-[7px] tracking-widest text-white/40 text-center mt-5">
          OPERATORS · A TACTICAL FIGHTER ON LENNY'S PODCAST · operators.replit.app
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-center gap-3 flex-wrap">
        <button
          onClick={onTweet}
          onMouseEnter={Sfx.menuMove}
          className="px-6 py-3 font-display text-base tracking-widest"
          style={{
            background: 'linear-gradient(180deg, #00B4D844, #0077B644)',
            color: 'white',
            border: '2px solid #00B4D8',
            boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.5), 0 0 16px #00B4D855',
            cursor: 'pointer',
          }}
        >
          ↗ TWEET MY CARD
        </button>
        <button
          onClick={onReset}
          onMouseEnter={Sfx.menuMove}
          className="px-6 py-3 font-display text-base tracking-widest"
          style={{
            background: 'rgba(0,0,0,0.4)',
            color: 'white',
            border: '2px solid rgba(255,255,255,0.4)',
            cursor: 'pointer',
          }}
        >
          ↺ REGENERATE
        </button>
      </div>
    </div>
  )
}
