import { useGame } from '../state/game'
import { getFighter } from '../data/fighters'
import { SCENARIOS } from '../data/scenarios'
import quotePool from '../data/quote-pool.json'
import { Sprite } from '../components/Sprite'
import { Sfx } from '../lib/audio'
import { Voice } from '../lib/voice'
import { youtubeDeepLink, hasYouTube } from '../lib/youtube'
import type { Move, QuotePoolEntry, ScenarioId } from '../types'

const POOL = quotePool as Record<string, QuotePoolEntry[]>

/**
 * Fighter Spotlight — comprehensive deep-dive on a single fighter.
 *
 * Sections:
 *   1. Hero header — large sprite + name + archetype + episode + bio
 *   2. Signature Ultimate — big card with quote + DMG + requirements
 *   3. Full 5-move kit — each with name, type, damage, cost, quote, episode, deep-link
 *   4. Scenario specialty — table of scenario bonuses with stage cards
 *   5. Verbatim quote pool — 5 representative quotes with timestamps
 *   6. Listen-now CTA — open episode on YouTube (or note if unavailable)
 *
 * This is the bridge from game → real podcast. Each entry deep-links
 * to the actual episode at the actual timestamp.
 */
export function FighterSpotlight() {
  const id = useGame((s) => s.spotlightFighter)
  const setPhase = useGame((s) => s.setPhase)
  const setSpot = useGame((s) => s.setSpotlightFighter)
  const f = id ? getFighter(id) : null

  if (!f) {
    return (
      <div className="w-full h-full flex items-center justify-center text-white/60 font-body text-xl">
        No fighter selected.
        <button
          onClick={() => setPhase('character-select')}
          className="ml-4 font-display text-[10px] tracking-widest px-3 py-1 border border-white/40"
        >
          BACK
        </button>
      </div>
    )
  }

  const episodeLink = youtubeDeepLink(f.id, undefined)
  const sampleQuotes = (POOL[f.id] ?? []).slice(0, 5)
  const scenarioBonuses = Object.entries(f.scenarioBonus)
    .sort(([, a], [, b]) => (b as number) - (a as number))

  return (
    <div className="relative w-full h-full overflow-y-auto">
      <div
        className="fixed inset-0 -z-10 pointer-events-none"
        style={{
          background: `radial-gradient(circle at 30% 20%, ${f.accent}22 0%, #1A0F2E 50%, #0F0A1A 100%)`,
        }}
      />

      {/* Header bar */}
      <div
        className="sticky top-0 z-20 px-6 py-3 backdrop-blur-md flex items-center justify-between"
        style={{
          background: 'rgba(15,10,26,0.92)',
          borderBottom: `2px solid ${f.accent}66`,
        }}
      >
        <button
          onClick={() => {
            Sfx.menuMove()
            setSpot(null)
            setPhase('character-select')
          }}
          className="font-display text-[10px] tracking-widest text-white/70"
        >
          ← BACK
        </button>
        <h1
          className="font-display text-xl tracking-widest"
          style={{ color: f.accent, textShadow: '3px 3px 0 black' }}
        >
          FIGHTER SPOTLIGHT
        </h1>
        <button
          onClick={() => {
            Sfx.menuSelect()
            Voice.say(f.voiceLines.matchStart, f.id, 'matchStart')
          }}
          className="font-display text-[9px] tracking-widest px-2 py-1"
          style={{ border: `1px solid ${f.accent}`, color: f.accent }}
          title="Hear their voice"
        >
          🗣 VOICE
        </button>
      </div>

      <div className="p-6 pb-24 space-y-8">
        {/* 1. HERO */}
        <section className="flex gap-8 items-start">
          <div
            className="flex-shrink-0 relative"
            style={{
              width: 260,
              height: 360,
              background: `linear-gradient(180deg, ${f.accent}22, ${f.accent}08)`,
              border: `3px solid ${f.accent}`,
              boxShadow: `inset -3px -3px 0 rgba(0,0,0,0.5), inset 3px 3px 0 rgba(255,255,255,0.15), 0 0 28px ${f.accent}55`,
            }}
          >
            <Sprite fighter={f} side="a" state="stance" />
          </div>
          <div className="flex-1 min-w-0">
            <div
              className="font-display tracking-widest"
              style={{
                color: f.accent,
                fontSize: 56,
                lineHeight: 0.95,
                textShadow: '6px 6px 0 black, 0 0 24px ' + f.accent + '88',
              }}
            >
              {f.name.toUpperCase()}
            </div>
            <div className="font-display text-base tracking-widest text-white/70 mt-3">
              {f.archetype} · {f.episode}
            </div>
            <p className="font-body text-2xl text-white mt-4 leading-snug max-w-2xl">
              {f.bio}
            </p>

            {/* Quick stats row */}
            <div className="flex gap-6 mt-5 font-display text-[11px] tracking-widest">
              <Stat label="HP"  value={String(f.maxHp)} color="#06D6A0" />
              <Stat label="ULT" value={String(f.ult.baseDamage)} color="#F72585" />
              <Stat
                label="BEST IN"
                value={(() => {
                  const tops = scenarioBonuses
                    .filter(([, v]) => (v as number) >= 1.3)
                    .slice(0, 2)
                    .map(([k]) => SCENARIOS[k as ScenarioId].tag)
                  return tops.length > 0 ? tops.join(' / ') : 'ALL-ROUNDER'
                })()}
                color="#FFD60A"
              />
            </div>

            {/* Listen CTA */}
            {hasYouTube(f.id) && episodeLink && (
              <a
                href={episodeLink}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => Sfx.menuSelect()}
                className="inline-block mt-5 px-4 py-2 font-display text-[10px] tracking-widest"
                style={{
                  background: `linear-gradient(180deg, ${f.accent}44, ${f.accent}11)`,
                  color: 'white',
                  border: `2px solid ${f.accent}`,
                  boxShadow: `inset -2px -2px 0 rgba(0,0,0,0.5), 0 0 16px ${f.accent}55`,
                  textDecoration: 'none',
                }}
              >
                ▶ LISTEN TO {f.episode.toUpperCase()} ON YOUTUBE
              </a>
            )}
          </div>
        </section>

        {/* 2. SIGNATURE ULTIMATE */}
        <section>
          <SectionHeader color="#F72585" label="▌ SIGNATURE ULTIMATE" />
          <div
            className="p-5"
            style={{
              background: 'linear-gradient(135deg, rgba(247,37,133,0.18), rgba(114,9,183,0.10))',
              border: '2px solid #F72585',
              boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.5), 0 0 24px rgba(247,37,133,0.3)',
            }}
          >
            <div className="flex items-baseline justify-between">
              <span className="font-display text-[10px] tracking-widest" style={{ color: '#F72585' }}>
                ⚡ {f.ult.type.toUpperCase()} · MOMENTUM {f.ult.momentum} · SUPER 100
              </span>
              <span className="font-num text-2xl text-white tabular-nums">
                {f.ult.baseDamage} DMG
              </span>
            </div>
            <div
              className="font-display tracking-widest mt-2"
              style={{ color: 'white', fontSize: 28, letterSpacing: '0.1em' }}
            >
              {f.ult.name}
            </div>
            <p className="font-body italic text-xl text-white/90 mt-3 leading-snug max-w-3xl">
              &ldquo;{f.ult.quote}&rdquo;
            </p>
            <div className="flex items-center justify-between mt-3 text-[9px] font-display tracking-widest">
              <span className="text-white/50">{f.ult.episode} · {f.ult.timestamp}</span>
              {f.ult.requiresSelfStatus && (
                <span style={{ color: '#FFD60A' }}>REQUIRES: {f.ult.requiresSelfStatus.replace('_', ' ')}</span>
              )}
              {(() => {
                const link = youtubeDeepLink(f.id, f.ult.timestamp)
                return link ? (
                  <a
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2 py-0.5"
                    style={{ border: '1px solid #F72585', color: '#F72585', textDecoration: 'none' }}
                  >
                    ▶ EPISODE
                  </a>
                ) : null
              })()}
            </div>
          </div>
        </section>

        {/* 3. FULL 5-MOVE KIT */}
        <section>
          <SectionHeader color={f.accent} label="▌ FULL MOVE KIT" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {f.moves.map((m) => (
              <MoveDetailCard key={m.id} move={m} fighterId={f.id} accent={f.accent} />
            ))}
          </div>
        </section>

        {/* 4. SCENARIO SPECIALTY */}
        <section>
          <SectionHeader color={f.accent} label="▌ SCENARIO SPECIALTY" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {scenarioBonuses.map(([sc, mult]) => {
              const scenario = SCENARIOS[sc as ScenarioId]
              const m = mult as number
              const pct = Math.round((m - 1) * 100)
              const isStrong = m >= 1.4
              return (
                <div
                  key={sc}
                  className="p-3"
                  style={{
                    background: isStrong ? `${scenario.accent}1A` : 'rgba(0,0,0,0.3)',
                    border: `2px solid ${isStrong ? scenario.accent : 'rgba(255,255,255,0.12)'}`,
                    boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.4)',
                  }}
                >
                  <div className="flex items-baseline justify-between">
                    <span style={{ fontSize: 20 }}>{scenario.icon}</span>
                    <span
                      className="font-num text-base font-display tracking-widest"
                      style={{ color: isStrong ? '#06D6A0' : '#FFD60A' }}
                    >
                      +{pct}%
                    </span>
                  </div>
                  <div
                    className="font-display text-[9px] tracking-widest mt-2"
                    style={{ color: scenario.accent }}
                  >
                    {scenario.tag}
                  </div>
                  <div className="font-display text-base text-white mt-1">{scenario.name}</div>
                  <p className="font-body text-sm text-white/70 mt-1 leading-tight">
                    {scenario.description}
                  </p>
                </div>
              )
            })}
          </div>
        </section>

        {/* 5. VERBATIM QUOTE POOL */}
        {sampleQuotes.length > 0 && (
          <section>
            <SectionHeader color={f.accent} label="▌ MORE VERBATIM QUOTES" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {sampleQuotes.map((q, i) => {
                const link = youtubeDeepLink(f.id, q.timestamp)
                return (
                  <div
                    key={i}
                    className="p-4"
                    style={{
                      background: 'rgba(15,10,26,0.65)',
                      border: `2px solid ${f.accent}77`,
                      boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.4)',
                    }}
                  >
                    <p className="font-body italic text-lg text-white/90 leading-snug">
                      &ldquo;{q.quote}&rdquo;
                    </p>
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/10">
                      <span className="font-display text-[8px] tracking-widest text-white/50">
                        {f.episode} · {q.timestamp}
                      </span>
                      {link && (
                        <a
                          href={link}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => Sfx.menuSelect()}
                          className="font-display text-[8px] tracking-widest px-1.5 py-0.5"
                          style={{ border: `1px solid ${f.accent}`, color: f.accent, textDecoration: 'none' }}
                        >
                          ▶ JUMP
                        </a>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* 6. VOICE LINES PEEK */}
        <section>
          <SectionHeader color={f.accent} label="▌ VOICE LINES" />
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {[
              ['MATCH START', f.voiceLines.matchStart],
              ['WIN',         f.voiceLines.win],
              ['LOSE',        f.voiceLines.lose],
              ['K.O.',        f.voiceLines.ko],
              ['CRIT',        f.voiceLines.crit],
              ['ULTIMATE',    f.voiceLines.ult],
              ...f.voiceLines.trash.map((t, i): [string, string] => [`TRASH ${i + 1}`, t]),
            ].map(([key, text]) => (
              <div
                key={key}
                className="p-2"
                style={{
                  background: 'rgba(0,0,0,0.35)',
                  border: '1px solid rgba(255,255,255,0.12)',
                }}
              >
                <div className="font-display text-[8px] tracking-widest" style={{ color: f.accent }}>
                  {key}
                </div>
                <p className="font-body italic text-base text-white/85 leading-tight mt-1">
                  &ldquo;{text}&rdquo;
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

function SectionHeader({ color, label }: { color: string; label: string }) {
  return (
    <div
      className="font-display text-sm tracking-widest pb-2 mb-3"
      style={{ color, borderBottom: `1px solid ${color}55`, textShadow: '2px 2px 0 black' }}
    >
      {label}
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div className="text-white/50">{label}</div>
      <div className="font-num text-2xl tabular-nums" style={{ color }}>
        {value}
      </div>
    </div>
  )
}

function MoveDetailCard({ move, fighterId, accent }: { move: Move; fighterId: string; accent: string }) {
  const link = youtubeDeepLink(fighterId, move.timestamp)
  const typeColor: Record<Move['type'], string> = {
    light: '#90E0EF', heavy: '#E63946', setup: '#06D6A0', combo: '#FFD60A', ultimate: '#F72585',
  }
  return (
    <div
      className="p-4"
      style={{
        background: 'rgba(15,10,26,0.65)',
        border: `2px solid ${accent}55`,
        boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.4)',
      }}
    >
      <div className="flex items-baseline justify-between">
        <span className="font-display text-[9px] tracking-widest" style={{ color: typeColor[move.type] }}>
          {move.type.toUpperCase()} · MOM {move.momentum}
        </span>
        <span className="font-num text-xl text-white tabular-nums">{move.baseDamage} DMG</span>
      </div>
      <div className="font-display text-lg tracking-wider text-white mt-1">{move.name}</div>
      <p className="font-body text-base text-white/70 mt-1 leading-snug">{move.description}</p>
      <p className="font-body italic text-lg text-white/90 mt-2 leading-snug">&ldquo;{move.quote}&rdquo;</p>
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/10">
        <span className="font-display text-[8px] tracking-widest text-white/50">
          {move.episode} · {move.timestamp}
        </span>
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => Sfx.menuSelect()}
            className="font-display text-[8px] tracking-widest px-1.5 py-0.5"
            style={{ border: `1px solid ${accent}`, color: accent, textDecoration: 'none' }}
          >
            ▶ EPISODE
          </a>
        )}
      </div>
    </div>
  )
}
