import type { ScenarioId } from '../types'

/**
 * Story Mode — The Operator Tournament.
 *
 * 8 chapters of Lenny's Podcast segments. Each segment puts the player in
 * front of a scenario specialist who challenges the philosophy of their
 * stage. Chapter 8 = Lenny himself steps out from behind the microphone.
 *
 * Universal framings used by ALL 64 fighters. The marquee 8 (Amjad, Chesky,
 * Boris, Altman, Benioff, Fei-Fei Li, Elena Verna, Reid Hoffman) get bespoke
 * career arcs layered on top in `story-career-arcs.ts` that override the
 * `chapterIntro` and `preFightDialogue` for those fighters specifically. The
 * scenario + opponent + structure stay the same.
 *
 * Voice direction (Azure 4o TTS): Lenny narrator is `onyx`. Each opponent
 * speaks in their fighter's `ttsVoice` (falls back to `alloy` if unset).
 * The player's line in `pre-fight-dialogue` is pulled from their existing
 * `voiceLines.matchStart` so it always sounds in-character.
 */

export type StoryChapter = {
  /** 1-indexed chapter number. 8 = Lenny final boss. */
  chapter: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
  /** Scenario the fight takes place in. Drives stage background + bonuses. */
  scenario: ScenarioId
  /** Opponent the player fights. Scenario specialist by design. */
  opponentId: string
  /** Subtitle on the chapter title card (e.g. "BEFORE ANYONE BELIEVED"). */
  chapterTitle: string
  /** Vague stage-of-startup label (avoids per-fighter dating). */
  chapterTimeframe: string
  /** Lenny-narrated 3-4 line setup. Plays at `chapter-intro` beat. */
  chapterIntro: string
  /** Opponent's pre-fight dialogue line. Spoken in opponent's ttsVoice. */
  opponentChallenge: string
  /** Lenny's reaction line after the fight resolves. */
  chapterOutro: string
}

/**
 * The shared tournament arc. Plays for every fighter unless their ID is in
 * the marquee-8 override map.
 */
export const STORY_PROGRESSION: StoryChapter[] = [
  {
    chapter: 1,
    scenario: 'pre-pmf',
    opponentId: 'chesky',
    chapterTitle: 'BEFORE ANYONE BELIEVED',
    chapterTimeframe: 'Year One',
    chapterIntro:
      "Welcome back to the show. Today, we go to the beginning. The year you had three slides, " +
      "no traction, and one belief that everyone in your life politely doubted. " +
      "Your first guest tonight built the most-laughed-at company of his era. He shipped cereal " +
      "boxes to keep the lights on. Then he shipped a planet. Brian — let's talk Pre-PMF.",
    opponentChallenge: "If you're not embarrassed by your first version, you launched too late.",
    chapterOutro:
      "That's the lesson of the garage. Conviction beats market research. " +
      "Hold onto it — the next room is louder.",
  },
  {
    chapter: 2,
    scenario: 'hypergrowth',
    opponentId: 'turley',
    chapterTitle: 'WHEN EVERYTHING BROKE',
    chapterTimeframe: 'Year Two',
    chapterIntro:
      "You found fit. Now the line goes vertical. Servers melt. Hires triple. " +
      "Every system designed for ten people is now serving a million. " +
      "Nick Turley shipped a product called ChatGPT into a curve like that. " +
      "What he learned about hypergrowth nobody on this show has duplicated.",
    opponentChallenge: "The plane is being built mid-flight. Most teams crash trying to land it.",
    chapterOutro:
      "Velocity is the moat — and the trap. If you survived, " +
      "you earned the right to think about the next problem.",
  },
  {
    chapter: 3,
    scenario: 'plateau',
    opponentId: 'doshi',
    chapterTitle: 'THE HARDEST YEAR',
    chapterTimeframe: 'Year Three',
    chapterIntro:
      "Growth stopped. The dashboard you obsessed over hasn't moved in 90 days. " +
      "Your team is asking the questions, but quietly. " +
      "Shreyas Doshi has lived in this room more times than anyone I know. " +
      "When growth slows, strategy gets honest. Let's see how honest you can be.",
    opponentChallenge: "Most product strategies are two ICPs glued together. Pick one.",
    chapterOutro:
      "Strategy is a set of integrated choices. " +
      "If you forced yours, you just bought yourself the next S-curve.",
  },
  {
    chapter: 4,
    scenario: 'ai-native',
    opponentId: 'catwu',
    chapterTitle: 'THE PLATFORM SHIFT',
    chapterTimeframe: 'Year Four',
    chapterIntro:
      "A new substrate arrived. The team you built six years ago is suddenly working on " +
      "yesterday's machines. The model you shipped last quarter is already legacy. " +
      "Cat Wu ships a research preview every week. She doesn't blink at the cadence. " +
      "Tonight, she's the bar.",
    opponentChallenge: "Ship the smallest thing that teaches you something. Then ship again.",
    chapterOutro:
      "The platform shifts will keep coming. " +
      "The operators who survive are the ones who treat shipping as the only metric that matters.",
  },
  {
    chapter: 5,
    scenario: 'monetization',
    opponentId: 'madhavan',
    chapterTitle: 'MAKE IT PAY',
    chapterTimeframe: 'Year Five',
    chapterIntro:
      "The product works. The growth is real. Now somebody has to make the math " +
      "on the cap table actually work. Madhavan Ramanujam studied four hundred " +
      "companies and fifty unicorns to figure out what willingness-to-pay looks like " +
      "before you write your first feature. Let's see if you priced this right.",
    opponentChallenge: "Willingness to pay should be conversation number one — not number twenty.",
    chapterOutro:
      "Three tiers. Anchor, target, premium. " +
      "If you nailed it, the cap table breathes for the first time.",
  },
  {
    chapter: 6,
    scenario: 'crisis',
    opponentId: 'cagan',
    chapterTitle: 'WHEN WE ALMOST LOST IT',
    chapterTimeframe: 'Year Six',
    chapterIntro:
      "Every great operator has one of these chapters. Cash short. People scared. " +
      "Decisions heavy and humane. Marty Cagan has coached teams out of more " +
      "of these rooms than anyone on the show. " +
      "The right move is rarely the comfortable one.",
    opponentChallenge: "Discover before you deliver. The discovery you skipped is the crisis you're in.",
    chapterOutro:
      "In crisis the founder becomes the company. " +
      "If you held — congratulations. You earned the next chapter.",
  },
  {
    chapter: 7,
    scenario: 'distribution',
    opponentId: 'spiegel',
    chapterTitle: 'DISTRIBUTION IS DESTINY',
    chapterTimeframe: 'Year Seven',
    chapterIntro:
      "The product is great. The team is great. The question that decides whether you exist " +
      "in five years is whether anyone hears about it. " +
      "Evan Spiegel built a distribution moat so deep it survived three model platform shifts. " +
      "Tonight, he tests yours.",
    opponentChallenge: "Daily active people. Not users. People. That is the only number.",
    chapterOutro:
      "Distribution is the product. " +
      "If you held this room, you held the moat that mattered.",
  },
  {
    chapter: 8,
    scenario: 'ipo-prep',
    opponentId: 'lenny',
    chapterTitle: 'THE INTERVIEW',
    chapterTimeframe: 'The Conference Stage',
    chapterIntro:
      "Final segment. " +
      "I've spent three hundred episodes finding the patterns. Tonight I want to see if yours fits — " +
      "or if it breaks something I thought I knew. " +
      "There is no scoreboard for what happens here. " +
      "I'm not the host this round. I'm the opponent.",
    opponentChallenge: "You think you're unique. The pattern says otherwise. Let's find out.",
    chapterOutro:
      "Some operators come back as guests. Some come back as patterns. " +
      "Tonight you became both.",
  },
]

/**
 * Endings for non-marquee fighters. The marquee 8 override these with
 * bespoke `careerEnding` data in `story-career-arcs.ts`.
 *
 * The procedural ending pulls together: the fighter's existing `ult` voice
 * line as the closing tagline, a curated reflection from Lenny, and a final
 * pull-quote citation. Built at render time in StoryEnding.tsx.
 */
export const PROCEDURAL_ENDING_EPITAPH = (fighterName: string) =>
  `That's the operator I just met. ${fighterName}, you went the distance. ` +
  `What you said in this room is what the next operator is going to need to hear. ` +
  `Thanks for coming on the show.`
