import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useGame } from '../state/game'
import { getFighter } from '../data/fighters'
import { SCENARIOS } from '../data/scenarios'
import { STORY_PROGRESSION } from '../data/story-tournament'
import { getArc } from '../data/story-career-arcs'
import { Voice } from '../lib/voice'
import { Sfx } from '../lib/audio'
import { StoryPortrait } from './StoryPortrait'

/**
 * Story Mode cutscene overlay.
 *
 * Renders one of five beats based on `storyCutscene.beat`:
 *   - chapter-intro       Lenny narrates the chapter setup over the stage background
 *   - pre-fight-dialogue  Opponent challenge + player matchStart, side-by-side portraits
 *   - post-fight-reaction Opponent concedes; player victorious in the corner
 *   - chapter-outro       Lenny wraps the chapter; pull-quote freeze frame
 *   - ending-splash       Final career-ending: player portrait + tagline + epitaph
 *
 * Driven by `advanceStoryBeat()` on SPACE / click. TTS plays via Voice.say()
 * which probes for pre-rendered Azure 4o MP3s at /audio/voices/{id}/{key}.mp3
 * and falls back to browser SpeechSynthesis if no file exists.
 */
export function StoryCutscene() {
  const cs = useGame((s) => s.storyCutscene)
  const playerFighterId = useGame((s) => s.storyState?.playerFighterId)
  const advance = useGame((s) => s.advanceStoryBeat)
  const voiceEnabled = useGame((s) => s.voiceEnabled)

  // SPACE / click / Enter advances to the next beat.
  useEffect(() => {
    if (!cs) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        Sfx.menuSelect()
        advance()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cs, advance])

  // TTS playback — fires once per cutscene id. For dialogue beats we stagger
  // the two lines (opponent first, player matchStart second).
  useEffect(() => {
    if (!cs || !voiceEnabled) return
    Voice.stop()

    const playerDef = playerFighterId ? getFighter(playerFighterId) : null
    const opponentDef = cs.opponentId ? getFighter(cs.opponentId) : null

    switch (cs.beat) {
      case 'chapter-intro':
      case 'chapter-outro': {
        // Lenny narrates.
        Voice.say(cs.text, 'lenny', `story-ch${cs.chapter}-${cs.beat}`)
        break
      }
      case 'pre-fight-dialogue': {
        // Two-line beat: opponent challenge first, then player's matchStart.
        if (opponentDef) {
          Voice.say(cs.text, opponentDef.id, `story-ch${cs.chapter}-opp`)
        }
        if (playerDef) {
          // Delay so the two lines don't overlap.
          setTimeout(() => {
            Voice.say(playerDef.voiceLines.matchStart, playerDef.id, 'matchStart')
          }, 2400)
        }
        break
      }
      case 'post-fight-reaction': {
        // Opponent concedes.
        if (opponentDef) {
          Voice.say(cs.text, opponentDef.id, 'lose')
        }
        break
      }
      case 'ending-splash': {
        // Lenny wraps the run with a personalized epitaph.
        Voice.say(cs.text, 'lenny', `story-ending-${playerFighterId ?? 'na'}`)
        break
      }
    }
    return () => { Voice.stop() }
  }, [cs?.id, voiceEnabled, cs?.beat, cs?.text, cs?.opponentId, cs?.chapter, playerFighterId, cs])

  if (!cs) return null

  // Look up the chapter's scenario for accent + background.
  const chapter = STORY_PROGRESSION[cs.chapter - 1]
  const scenario = chapter ? SCENARIOS[chapter.scenario] : null
  const accent = cs.accent ?? scenario?.accent ?? '#FFD60A'

  // Prefer the bespoke chapter title-card backdrop generated in Tier 3
  // (/public/story/chapters/{scenario}.png). Falls back to the stage
  // background if the chapter card doesn't exist on disk yet.
  const chapterCardSrc = chapter ? `/story/chapters/${chapter.scenario}.png` : null
  const stageBg = chapter ? `/stages/${chapter.scenario}.png` : null
  const [bgUrl, setBgUrl] = useState<string | null>(stageBg)
  useEffect(() => {
    if (!chapterCardSrc) { setBgUrl(stageBg); return }
    let cancelled = false
    const img = new Image()
    img.onload = () => { if (!cancelled) setBgUrl(chapterCardSrc) }
    img.onerror = () => { if (!cancelled) setBgUrl(stageBg) }
    img.src = chapterCardSrc
    return () => { cancelled = true }
  }, [chapterCardSrc, stageBg])

  const playerDef = playerFighterId ? getFighter(playerFighterId) : null
  const opponentDef = cs.opponentId ? getFighter(cs.opponentId) : null
  const lennyDef = getFighter('lenny')

  // Bespoke arc data — overrides the player's matchStart in pre-fight
  // dialogue and provides per-chapter title overrides.
  const playerArc = playerFighterId ? getArc(playerFighterId) : null
  const arcChapter = playerArc?.chapters[cs.chapter - 1]
  const playerDialogueLine = arcChapter?.preFightDialogue[1].text
    ?? playerDef?.voiceLines.matchStart
    ?? ''
  const chapterTitle = arcChapter?.chapterTitle ?? chapter?.chapterTitle ?? ''
  const chapterYearOrTimeframe = arcChapter
    ? `${arcChapter.year} · ${arcChapter.setting}`
    : (chapter?.chapterTimeframe ?? '')

  // Per-beat layout dispatcher
  return (
    <motion.div
      key={cs.id}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      className="absolute inset-0 z-50"
      style={{ background: '#0F0A1A' }}
      onClick={() => { Sfx.menuSelect(); advance() }}
    >
      {/* Background — chapter title-card if it exists, else stage. */}
      {bgUrl && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `url(${bgUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            imageRendering: 'pixelated' as const,
            opacity: cs.beat === 'ending-splash' ? 0.25 : 0.5,
          }}
        />
      )}

      {/* Color rim — accent glow on the active side */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse at center, transparent 30%, rgba(15,10,26,0.85) 100%)`,
        }}
      />

      {/* CRT scanlines for arcade feel */}
      <div
        className="absolute inset-0 pointer-events-none mix-blend-overlay opacity-30"
        style={{
          background:
            'repeating-linear-gradient(0deg, rgba(255,255,255,0.08) 0px, rgba(255,255,255,0.08) 1px, transparent 2px, transparent 4px)',
        }}
      />

      {/* Top status bar: chapter + scenario */}
      <div className="absolute top-0 left-0 right-0 z-10 px-8 py-4 flex items-center justify-between pointer-events-none">
        <div
          className="font-display tracking-widest"
          style={{
            fontSize: 12,
            letterSpacing: '0.4em',
            color: accent,
            textShadow: '2px 2px 0 black, 0 0 12px ' + accent,
          }}
        >
          CHAPTER {cs.chapter} OF 8
        </div>
        {chapter && (
          <div
            className="font-display tracking-widest"
            style={{
              fontSize: 11,
              letterSpacing: '0.35em',
              color: '#FFD60A',
              textShadow: '2px 2px 0 black',
            }}
          >
            ◆ {chapterYearOrTimeframe.toUpperCase()} · {scenario?.name ?? ''}
          </div>
        )}
      </div>

      {/* Beat-specific content */}
      <AnimatePresence mode="wait">
        {cs.beat === 'chapter-intro' && (
          <motion.div
            key="intro"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -20, opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="absolute inset-0 flex flex-col items-center justify-center px-12 z-20"
          >
            {/* Lenny portrait (small, top-left of the body) */}
            {lennyDef && (
              <div className="mb-6">
                <StoryPortrait fighter={lennyDef} side="a" active label="LENNY · HOST" />
              </div>
            )}
            <div
              className="font-display tracking-widest text-center mb-6"
              style={{
                fontSize: 38,
                letterSpacing: '0.18em',
                color: '#FFFFFF',
                textShadow: `4px 4px 0 black, 0 0 28px ${accent}`,
                transform: 'skewX(-4deg)',
              }}
            >
              {chapterTitle}
            </div>
            <div
              className="font-body text-center max-w-3xl leading-snug"
              style={{
                fontSize: 22,
                color: 'white',
                textShadow: '2px 2px 0 black',
                lineHeight: 1.5,
              }}
            >
              {cs.text}
            </div>
          </motion.div>
        )}

        {cs.beat === 'pre-fight-dialogue' && (
          <motion.div
            key="dialogue"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="absolute inset-0 flex flex-col items-center justify-center px-12 z-20"
          >
            <div className="flex items-end gap-12 mb-8">
              {opponentDef && (
                <DialogueColumn
                  fighter={opponentDef}
                  side="a"
                  line={cs.text}
                  accent={opponentDef.accent ?? accent}
                />
              )}
              <div
                className="font-display tracking-widest"
                style={{
                  fontSize: 38,
                  color: accent,
                  textShadow: '3px 3px 0 black, 0 0 18px ' + accent,
                  marginBottom: 80,
                }}
              >
                VS
              </div>
              {playerDef && (
                <DialogueColumn
                  fighter={playerDef}
                  side="b"
                  line={playerDialogueLine}
                  accent={playerDef.accent ?? '#FFD60A'}
                />
              )}
            </div>
          </motion.div>
        )}

        {cs.beat === 'post-fight-reaction' && (
          <motion.div
            key="reaction"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="absolute inset-0 flex flex-col items-center justify-center px-12 z-20"
          >
            {opponentDef && (
              <DialogueColumn
                fighter={opponentDef}
                side="a"
                line={cs.text}
                accent={opponentDef.accent ?? accent}
                speakerLabel={`${opponentDef.shortName} · DEFEATED`}
                dimmed
              />
            )}
            {playerDef && (
              <div className="mt-6 opacity-90">
                <StoryPortrait fighter={playerDef} side="b" active label={`${playerDef.shortName} · WINNER`} />
              </div>
            )}
          </motion.div>
        )}

        {cs.beat === 'chapter-outro' && (
          <motion.div
            key="outro"
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -30, opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="absolute inset-0 flex flex-col items-center justify-center px-12 z-20"
          >
            {lennyDef && (
              <div className="mb-6 opacity-80">
                <StoryPortrait fighter={lennyDef} side="a" active label="LENNY · HOST" />
              </div>
            )}
            <div
              className="font-body italic text-center max-w-3xl leading-snug"
              style={{
                fontSize: 28,
                color: 'white',
                textShadow: '2px 2px 0 black',
                lineHeight: 1.4,
                padding: '0 40px',
                borderLeft: `4px solid ${accent}`,
                borderRight: `4px solid ${accent}`,
              }}
            >
              &ldquo;{cs.text}&rdquo;
            </div>
          </motion.div>
        )}

        {cs.beat === 'ending-splash' && playerDef && (
          <motion.div
            key="ending"
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, type: 'spring', damping: 18 }}
            className="absolute inset-0 flex flex-col items-center justify-center px-12 z-20"
          >
            <div
              className="font-display tracking-widest mb-2"
              style={{
                fontSize: 14,
                letterSpacing: '0.5em',
                color: accent,
                textShadow: '2px 2px 0 black, 0 0 12px ' + accent,
              }}
            >
              ★ END OF SHOW ★
            </div>
            <div className="mb-6">
              <StoryPortrait fighter={playerDef} side="b" active label={playerDef.shortName} />
            </div>
            <div
              className="font-display tracking-widest text-center mb-4"
              style={{
                fontSize: 46,
                letterSpacing: '0.12em',
                color: '#FFFFFF',
                textShadow: `5px 5px 0 black, 0 0 32px ${playerDef.accent ?? accent}`,
                transform: 'skewX(-4deg)',
                maxWidth: '90%',
              }}
            >
              {playerDef.ult.comboTitle || playerDef.ult.name}
            </div>
            <div
              className="font-body italic text-center max-w-2xl mt-4"
              style={{
                fontSize: 20,
                color: 'white',
                textShadow: '2px 2px 0 black',
                lineHeight: 1.5,
              }}
            >
              {cs.text}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Press SPACE hint (appears after 1.5s) */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.5, duration: 0.4 }}
        className="absolute bottom-6 left-0 right-0 text-center font-display tracking-widest pointer-events-none"
        style={{
          fontSize: 10,
          letterSpacing: '0.4em',
          color: 'rgba(255,255,255,0.55)',
          textShadow: '2px 2px 0 black',
        }}
      >
        ◇ PRESS SPACE TO {cs.beat === 'pre-fight-dialogue' ? 'FIGHT' : cs.beat === 'ending-splash' ? 'RETURN' : 'CONTINUE'} ◇
      </motion.div>
    </motion.div>
  )
}

/**
 * Vertical layout: portrait above, dialogue bubble below.
 * Used for pre-fight and post-fight dialogue beats.
 */
function DialogueColumn({
  fighter,
  side,
  line,
  accent,
  speakerLabel,
  dimmed,
}: {
  fighter: import('../types').FighterDef
  side: 'a' | 'b'
  line: string
  accent: string
  speakerLabel?: string
  dimmed?: boolean
}) {
  return (
    <div className="flex flex-col items-center" style={{ width: 260 }}>
      <StoryPortrait fighter={fighter} side={side} active={!dimmed} label={speakerLabel ?? fighter.shortName} />
      <div
        className="font-body italic text-center mt-3 px-4 py-3"
        style={{
          fontSize: 18,
          color: 'white',
          textShadow: '2px 2px 0 black',
          lineHeight: 1.4,
          minHeight: 80,
          maxWidth: 280,
          background: 'rgba(15,10,26,0.85)',
          border: `2px solid ${accent}`,
          boxShadow: `inset -2px -2px 0 rgba(0,0,0,0.5), 0 0 12px ${accent}55`,
          opacity: dimmed ? 0.7 : 1,
        }}
      >
        &ldquo;{line}&rdquo;
      </div>
    </div>
  )
}
