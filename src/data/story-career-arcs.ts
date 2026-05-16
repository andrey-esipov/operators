/**
 * Story Mode — Marquee 8 bespoke career arcs.
 *
 * Eight fighters get hand-written 8-chapter arcs that walk through real
 * moments from their actual careers. Each chapter overrides the
 * tournament-default chapter intro / pre-fight dialogue / opponent /
 * outro with bespoke content. Career ending is bespoke art + epitaph.
 *
 * Fighters with arcs:
 *   - amjad   · Amjad Masad — Replit founder (buildathon host's product)
 *   - chesky  · Brian Chesky — Airbnb founder
 *   - boris   · Boris Cherny — Anthropic / Claude Code lead
 *   - altman  · Sam Altman — OpenAI CEO
 *   - benioff · Marc Benioff — Salesforce founder
 *   - feifei  · Fei-Fei Li — Godmother of AI / World Labs
 *   - elena   · Elena Verna — Growth operator
 *   - reid    · Reid Hoffman — LinkedIn / Greylock / Masters of Scale host
 *
 * The other 56 fighters fall back to STORY_PROGRESSION's generic content.
 * Schema permits adding more arcs incrementally.
 *
 * Voice direction: all dialogue is delivered in the speaker's `ttsVoice`
 * (Azure 4o TTS). The Lenny narrator framings use `onyx`. Player lines
 * default to the player's own `ttsVoice`.
 */

import type { ScenarioId } from '../types'

export type ArcDialogueLine = {
  /** Fighter ID delivering this line. Falls back to 'lenny' if not in the roster. */
  speakerId: string
  text: string
}

export type ArcChapter = {
  /** Chapter number (1-8). Mirrors STORY_PROGRESSION.chapter. */
  chapter: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
  /** Scenario the chapter happens in (must match STORY_PROGRESSION). */
  scenario: ScenarioId
  /**
   * Override the default opponent for this chapter (e.g. Chesky's Pre-PMF
   * opponent is Marc Andreessen — the "no" that defined his arc — rather
   * than the universal default opponent. Leave undefined to use the
   * tournament default).
   */
  opponentOverride?: string
  /** Calendar year for the chapter title card (e.g. "2008"). */
  year: string
  /** One-line setting under the year (e.g. "Y Combinator. Demo Day."). */
  setting: string
  /** Subtitle on the chapter title card (overrides STORY_PROGRESSION). */
  chapterTitle: string
  /** Lenny-narrated chapter setup, 3-4 lines. Overrides STORY_PROGRESSION.chapterIntro. */
  chapterIntro: string
  /** Pre-fight dialogue: 2 lines, opponent first, player second. */
  preFightDialogue: [ArcDialogueLine, ArcDialogueLine]
  /** Opponent's concession after losing. Overrides their default voiceLines.lose. */
  postFightReaction: ArcDialogueLine
  /** Lenny's wrap-up. Overrides STORY_PROGRESSION.chapterOutro. */
  chapterOutro: string
}

export type CareerEnding = {
  /** Big tagline on the ending splash (e.g. "BUILT THE COMPANY I'D WANT TO WORK AT"). */
  tagline: string
  /** Path to bespoke splash image (Tier 3 generated). Falls back to procedural splash. */
  splashImage?: string
  /** 2-3 line voiceover delivered as the career closes. Lenny narrates. */
  epitaph: string
}

export type StoryArc = {
  /** Eight chapters, in scenario order matching STORY_PROGRESSION. */
  chapters: ArcChapter[]
  careerEnding: CareerEnding
}

// ────────────────────────────────────────────────────────────────────
// BRIAN CHESKY · Airbnb founder
// ────────────────────────────────────────────────────────────────────
const CHESKY_ARC: StoryArc = {
  chapters: [
    {
      chapter: 1,
      scenario: 'pre-pmf',
      opponentOverride: 'andreessen',
      year: '2008',
      setting: 'Y Combinator. Demo Day.',
      chapterTitle: 'CEREAL FUNDED THIS',
      chapterIntro:
        "Welcome back to the show. Today we go to 2008. You and Joe and Nate are sleeping on " +
        "air mattresses in San Francisco. The investors won't take your meetings. " +
        "You shipped Obama O's and Cap'n McCain's cereal to keep the company alive. " +
        "Tonight your guest is the man who passed on you. Marc Andreessen.",
      preFightDialogue: [
        { speakerId: 'andreessen', text: "I literally told you no. Now you want a sit-down?" },
        { speakerId: 'chesky', text: "I want a sit-down because I'm still here." },
      ],
      postFightReaction: { speakerId: 'andreessen', text: "I missed the curve. It happens." },
      chapterOutro:
        "Every great company has a no it survived. " +
        "Chesky's was Andreessen's. Hold the lesson — the rounds get bigger.",
    },
    {
      chapter: 2,
      scenario: 'hypergrowth',
      year: '2011',
      setting: 'San Francisco. Series B.',
      chapterTitle: 'SCALE THE EXPERIENCE',
      chapterIntro:
        "You found fit. The line goes vertical. Hosts in 89 countries. " +
        "Reservations doubling every six months. " +
        "The product you designed for three users now serves a million. " +
        "Your guest tonight built a scaling curve they teach in business schools.",
      preFightDialogue: [
        { speakerId: 'turley', text: "Doubling every month isn't a chart. It's a brawl." },
        { speakerId: 'chesky', text: "Then we don't blink. Ship it." },
      ],
      postFightReaction: { speakerId: 'turley', text: "Founder mode survived the chaos. Respect." },
      chapterOutro:
        "Velocity is the moat — and the trap. " +
        "If you can keep the design intent under that pressure, you've earned the next room.",
    },
    {
      chapter: 3,
      scenario: 'plateau',
      year: '2014',
      setting: 'The empty boardroom at sunset.',
      chapterTitle: 'BECOMING A DESIGNER-CEO',
      chapterIntro:
        "Growth is real but mature. The PR pivot from 'cool startup' to 'serious company' " +
        "is awkward. Hosts are organizing. Cities are pushing back. " +
        "Your guest has lived in this room more than anyone. " +
        "Shreyas Doshi. The strategist who forces decisions when growth gets honest.",
      preFightDialogue: [
        { speakerId: 'doshi', text: "Two ICPs glued together. Hosts and guests. Pick one." },
        { speakerId: 'chesky', text: "Both. Together. That IS the product." },
      ],
      postFightReaction: { speakerId: 'doshi', text: "Sometimes the strategy IS the integration. I'll grant it." },
      chapterOutro:
        "Strategy is a set of integrated choices. " +
        "If you found the synthesis, you just bought the next S-curve.",
    },
    {
      chapter: 4,
      scenario: 'ai-native',
      year: '2024',
      setting: 'The datacenter.',
      chapterTitle: 'AI HOSTS, AI TRIPS',
      chapterIntro:
        "A new substrate arrived. " +
        "Search is now a conversation. Trip planning is now an agent. " +
        "Your competitors are racing to bolt AI on top of stale stacks. " +
        "Your guest ships a research preview every week and learns at the speed of customers.",
      preFightDialogue: [
        { speakerId: 'catwu', text: "You can't bolt AI onto a 15-year-old product. You rebuild." },
        { speakerId: 'chesky', text: "Then we rebuild. From the booking flow up." },
      ],
      postFightReaction: { speakerId: 'catwu', text: "You actually moved at our cadence. I underestimated." },
      chapterOutro:
        "The companies that survive the model shift are the ones who treat shipping " +
        "as the only metric. Chesky just moved his org at research speed.",
    },
    {
      chapter: 5,
      scenario: 'monetization',
      year: '2017',
      setting: 'The cap table. Pricing committee.',
      chapterTitle: 'PRICING THE PLATFORM',
      chapterIntro:
        "Take rate matters now. Host fees vs guest fees. Listed currency. Tiered insurance. " +
        "Every conversation is leverage. " +
        "Your guest studied 400 companies to learn what willingness to pay actually looks like.",
      preFightDialogue: [
        { speakerId: 'madhavan', text: "Your hosts will pay outcomes. Your guests will pay experience. Stop confusing them." },
        { speakerId: 'chesky', text: "Three tiers. Anchor, target, premium. Got it." },
      ],
      postFightReaction: { speakerId: 'madhavan', text: "He listened. Not all founders do." },
      chapterOutro:
        "Pricing is strategy. " +
        "If you anchored it right, the cap table breathes for the first time in years.",
    },
    {
      chapter: 6,
      scenario: 'crisis',
      year: '2020',
      setting: 'The Layoff. The 25% cut.',
      chapterTitle: 'TWO WEEKS IN MARCH',
      chapterIntro:
        "March 2020. " +
        "Travel disappeared. Bookings dropped 80% in two weeks. " +
        "You did the hard work. 1,900 people. The severance memo became the textbook example. " +
        "Your guest has lived in this exact room: discovery before delivery, even when there's no time.",
      preFightDialogue: [
        { speakerId: 'cagan', text: "The discovery you skipped two years ago is the crisis you're in now." },
        { speakerId: 'chesky', text: "I know. I'm not skipping it again." },
      ],
      postFightReaction: { speakerId: 'cagan', text: "You held the line and stayed human. That's the playbook." },
      chapterOutro:
        "In crisis the founder becomes the company. " +
        "What you wrote in that severance letter is the lesson the next operator needed. " +
        "You earned the IPO.",
    },
    {
      chapter: 7,
      scenario: 'distribution',
      year: '2022',
      setting: 'Hollywood. The brand campaign.',
      chapterTitle: 'BRAND IS DISTRIBUTION',
      chapterIntro:
        "The product is great. The team is great. " +
        "The question is whether anyone hears about it past your current users. " +
        "Your guest built a distribution moat so deep it survived three model platform shifts.",
      preFightDialogue: [
        { speakerId: 'spiegel', text: "You stopped buying Google ads. People said you were crazy." },
        { speakerId: 'chesky', text: "Brand is the only moat ad spend can't buy." },
      ],
      postFightReaction: { speakerId: 'spiegel', text: "Distribution isn't a channel. It's a stance. You held yours." },
      chapterOutro:
        "Distribution is the product. " +
        "When you stopped renting attention and built brand instead, you bought the next decade.",
    },
    {
      chapter: 8,
      scenario: 'ipo-prep',
      year: 'Today',
      setting: 'The studio. The microphone.',
      chapterTitle: 'THE INTERVIEW',
      chapterIntro:
        "Final segment. " +
        "Three hundred episodes of operators have led me to this moment. " +
        "I've watched you turn no into a billion. Watched you fire a quarter of your company on a Tuesday " +
        "and write the textbook on how to do it. " +
        "Tonight I'm not the host. I'm the opponent.",
      preFightDialogue: [
        { speakerId: 'lenny', text: "You think founder mode is unique. The pattern says otherwise. Convince me." },
        { speakerId: 'chesky', text: "Founder mode is what you do when the title doesn't matter anymore." },
      ],
      postFightReaction: { speakerId: 'lenny', text: "You added a pattern I'll be teaching for ten years. " +
        "I'll add it to the show." },
      chapterOutro:
        "Some operators come back as guests. Some come back as patterns. " +
        "Brian, you became both.",
    },
  ],
  careerEnding: {
    tagline: "BUILT THE COMPANY I'D WANT TO WORK AT",
    splashImage: '/story/endings/chesky.png',
    epitaph:
      "Brian Chesky started with cereal boxes and a couch. " +
      "He ends as the operator who proved that founder mode — the actual presence " +
      "of the founder in the details — is the moat. " +
      "Built the company he'd want to work at. We're all working there now.",
  },
}

// ────────────────────────────────────────────────────────────────────
// AMJAD MASAD · Replit founder · the buildathon host's product
// ────────────────────────────────────────────────────────────────────
const AMJAD_ARC: StoryArc = {
  chapters: [
    {
      chapter: 1,
      scenario: 'pre-pmf',
      year: '2011',
      setting: 'Jordan. A web IDE prototype.',
      chapterTitle: 'OPEN A REPL',
      chapterIntro:
        "Welcome back. We go to Amman, 2011. " +
        "You're a self-taught engineer building a code editor that runs in the browser. " +
        "Your friends say nobody will ever write production code in a tab. " +
        "Your guest tonight built three startups before this one — and one of those was the platform.",
      preFightDialogue: [
        { speakerId: 'chesky', text: "Web IDEs have been tried. Cloud9. Koding. They all died." },
        { speakerId: 'amjad', text: "They optimized for the IDE. I'm optimizing for the URL." },
      ],
      postFightReaction: { speakerId: 'chesky', text: "The URL is the product. I see it now." },
      chapterOutro:
        "Every category-defining product started with a primitive nobody appreciated. " +
        "Amjad's was the link.",
    },
    {
      chapter: 2,
      scenario: 'hypergrowth',
      year: '2020',
      setting: 'The pandemic. Schools went remote.',
      chapterTitle: 'A MILLION STUDENTS',
      chapterIntro:
        "The world locked down. " +
        "Suddenly every CS class needed to run somewhere. Replit's free tier exploded. " +
        "Servers melting, costs ballooning, eight engineers trying to hold it together. " +
        "Your guest knows scaling curves better than anyone on the show.",
      preFightDialogue: [
        { speakerId: 'turley', text: "Your servers will be your epitaph if you don't price soon." },
        { speakerId: 'amjad', text: "Free is the wedge. The product comes first." },
      ],
      postFightReaction: { speakerId: 'turley', text: "You held the free tier through the chaos. That's a moat." },
      chapterOutro:
        "Free is the wedge. Distribution is the moat. " +
        "Amjad held both during the curve every CFO said couldn't be held.",
    },
    {
      chapter: 3,
      scenario: 'plateau',
      year: '2022',
      setting: 'The free-tier reckoning.',
      chapterTitle: 'WHEN TO CHARGE',
      chapterIntro:
        "Growth flatlined. The free tier is now the cost center. " +
        "Investors want a clear path to revenue. Users want everything to stay free. " +
        "Your guest is the strategist who forces choice. " +
        "Shreyas Doshi.",
      preFightDialogue: [
        { speakerId: 'doshi', text: "You can't be a free product, a power-user tool, and an enterprise platform. Pick one." },
        { speakerId: 'amjad', text: "I'll pick the long arc — agents. Everything else routes through it." },
      ],
      postFightReaction: { speakerId: 'doshi', text: "Critical few. You got there." },
      chapterOutro:
        "Strategy is choice. " +
        "Amjad just bet the company on agents before the rest of the industry had a name for them.",
    },
    {
      chapter: 4,
      scenario: 'ai-native',
      opponentOverride: 'boris',
      year: '2024',
      setting: 'The Agent ships.',
      chapterTitle: 'REPLIT AGENT',
      chapterIntro:
        "Replit Agent shipped. Anyone could type 'build me a CRM' and watch it appear. " +
        "But your guest tonight runs the team that ships THE dev-tool agent at Anthropic. " +
        "Two visions of the future, on the same stage, on the same night.",
      preFightDialogue: [
        { speakerId: 'boris', text: "You ship the workspace. I ship the model. Why do we collide?" },
        { speakerId: 'amjad', text: "Because the agent needs a home. And the home needs a brain." },
      ],
      postFightReaction: { speakerId: 'boris', text: "Composable wins. You shipped the surface I needed." },
      chapterOutro:
        "The agent ships from somewhere. " +
        "Amjad built the somewhere. Boris built the brain. " +
        "Both win when the operator wins.",
    },
    {
      chapter: 5,
      scenario: 'monetization',
      year: '2024',
      setting: 'Cycles. The agent paywall.',
      chapterTitle: 'PRICING AN AGENT',
      chapterIntro:
        "Now the agent costs real GPU money. " +
        "Per-token? Per-output? Per-build? " +
        "Your guest studied four hundred companies to figure out how to price outcomes. " +
        "Madhavan Ramanujam.",
      preFightDialogue: [
        { speakerId: 'madhavan', text: "Don't price the input. Price the output. Builders pay for built things." },
        { speakerId: 'amjad', text: "Cycles. Outcome credits. Three tiers, anchored on the build." },
      ],
      postFightReaction: { speakerId: 'madhavan', text: "Three tiers. He's listened to my podcast." },
      chapterOutro:
        "Outcome pricing for agents is the new frontier. " +
        "Amjad's just laid the rails everyone else will build on.",
    },
    {
      chapter: 6,
      scenario: 'crisis',
      year: '2025',
      setting: 'The 30% cut.',
      chapterTitle: 'WHO STAYS',
      chapterIntro:
        "The market correction. " +
        "Your free-tier costs exploded post-AI. " +
        "You made the call: cut a third, double down on the agent. " +
        "Your guest has coached more founders through this room than anyone.",
      preFightDialogue: [
        { speakerId: 'cagan', text: "You burned trust to survive. That's the math. Did you do it humanely?" },
        { speakerId: 'amjad', text: "Severance, references, founder mode in every exit conversation. Yes." },
      ],
      postFightReaction: { speakerId: 'cagan', text: "Survival is the prerequisite. You earned the next chapter." },
      chapterOutro:
        "Crisis is a transparency event. " +
        "How you do the layoff is who you are as a company. Amjad did it right.",
    },
    {
      chapter: 7,
      scenario: 'distribution',
      year: '2025',
      setting: 'The buildathon era.',
      chapterTitle: 'BUILDATHON IS THE FUNNEL',
      chapterIntro:
        "Every weekend, a thousand operators are building on Replit. " +
        "AI hackathons, founder retreats, full-stack tutorials. " +
        "You discovered the new top of funnel: the builder who didn't know they were a founder yet. " +
        "Your guest knows distribution like no one else.",
      preFightDialogue: [
        { speakerId: 'spiegel', text: "You're subsidizing the hackathon. You'd better know which side of the marketplace pays." },
        { speakerId: 'amjad', text: "Both sides. Subsidize discovery. Charge for shipping." },
      ],
      postFightReaction: { speakerId: 'spiegel', text: "Subsidize both sides. The TikTok move. You got it." },
      chapterOutro:
        "Distribution is identity. " +
        "Replit became the place builders BECOME founders. " +
        "That's the moat.",
    },
    {
      chapter: 8,
      scenario: 'ipo-prep',
      year: 'Today',
      setting: 'The studio.',
      chapterTitle: 'WHAT YOU TAUGHT US',
      chapterIntro:
        "Final segment. " +
        "Amjad, I host the Buildathon on your platform. " +
        "Three hundred operators built on Replit during the last contest. " +
        "Tonight I want to ask: what's the pattern you've found that I haven't?",
      preFightDialogue: [
        { speakerId: 'lenny', text: "I've matched patterns across 300 episodes. What's yours?" },
        { speakerId: 'amjad', text: "Anyone can be a builder. The agent isn't a tool. It's the new keyboard." },
      ],
      postFightReaction: { speakerId: 'lenny', text: "The new keyboard. I'll be teaching that one for years." },
      chapterOutro:
        "Some patterns are noticed. Some patterns are invented. " +
        "Amjad invented the agent-as-keyboard. We're all typing now.",
    },
  ],
  careerEnding: {
    tagline: "THE AGENT IS THE NEW KEYBOARD",
    splashImage: '/story/endings/amjad.png',
    epitaph:
      "Amjad Masad started in Amman with a code editor that ran in a browser tab. " +
      "He ends as the operator who made every URL a workspace and every workspace an agent. " +
      "Anyone can be a builder. He proved it. We're all building now.",
  },
}

// ────────────────────────────────────────────────────────────────────
// REID HOFFMAN · LinkedIn → Greylock → Masters of Scale
// ────────────────────────────────────────────────────────────────────
const REID_ARC: StoryArc = {
  chapters: [
    {
      chapter: 1,
      scenario: 'pre-pmf',
      year: '2002',
      setting: 'Mountain View. After PayPal.',
      chapterTitle: "EMBARRASS YOURSELF",
      chapterIntro:
        "Welcome back. We go to 2002. " +
        "You just sold PayPal. You could have retired. " +
        "Instead you sketched a network for professionals that everyone said was redundant — " +
        "Friendster existed; LinkedIn was supposedly DOA before it launched. " +
        "Your guest is the founder who taught you what shipping really means.",
      preFightDialogue: [
        { speakerId: 'chesky', text: "Professionals don't need a social network. They have email." },
        { speakerId: 'reid', text: "If you're not embarrassed by your first version, you launched too late." },
      ],
      postFightReaction: { speakerId: 'chesky', text: "Embarrassed v1. I wrote the wrong page on you, Reid." },
      chapterOutro:
        "Reid built the network nobody thought was missing. " +
        "Embarrass yourself in public, then build the next version.",
    },
    {
      chapter: 2,
      scenario: 'hypergrowth',
      year: '2007',
      setting: 'The blitzscale.',
      chapterTitle: 'BLITZSCALE OR DIE',
      chapterIntro:
        "LinkedIn has fit. Now the question is whether speed beats efficiency. " +
        "You wrote the playbook later. " +
        "Your guest tonight built ChatGPT on a curve that taught the world what blitzscaling looks like.",
      preFightDialogue: [
        { speakerId: 'turley', text: "Blitzscaling has a cost. Servers, hires, regret." },
        { speakerId: 'reid', text: "Speed over efficiency. The market only rewards the winners." },
      ],
      postFightReaction: { speakerId: 'turley', text: "You wrote the book. I'm living it." },
      chapterOutro:
        "Blitzscaling is prioritizing speed over efficiency in the face of uncertainty. " +
        "Reid named the era we're still living through.",
    },
    {
      chapter: 3,
      scenario: 'plateau',
      year: '2009',
      setting: 'Post-IPO. Network effects mature.',
      chapterTitle: 'WHAT DO PROFESSIONALS WANT?',
      chapterIntro:
        "LinkedIn is public. Growth is real but the obvious S-curve is over. " +
        "Job board, content network, or recruiting platform? " +
        "Your guest forces the choice no founder wants to make.",
      preFightDialogue: [
        { speakerId: 'doshi', text: "You're three companies. Pick the critical few." },
        { speakerId: 'reid', text: "I'll pick the network. The rest are surfaces on top of it." },
      ],
      postFightReaction: { speakerId: 'doshi', text: "Network as the strategy. Crisp." },
      chapterOutro:
        "Strategy is choice. Reid chose the network. " +
        "Everything that followed was a surface on top of that.",
    },
    {
      chapter: 4,
      scenario: 'ai-native',
      year: '2023',
      setting: 'After Microsoft. After OpenAI board.',
      chapterTitle: 'INFLECTION POINT',
      chapterIntro:
        "You co-founded Inflection. You sit on the OpenAI board. " +
        "You're funding AI companies at Greylock. " +
        "Your guest builds at the speed of the model itself.",
      preFightDialogue: [
        { speakerId: 'catwu', text: "You're an investor, not a builder. The cadence is different." },
        { speakerId: 'reid', text: "Then I'll build a portfolio at your cadence. Watch." },
      ],
      postFightReaction: { speakerId: 'catwu', text: "You moved at research speed with a checkbook. Respect." },
      chapterOutro:
        "AI-native investing is its own discipline. " +
        "Reid wrote the book on it before the book existed.",
    },
    {
      chapter: 5,
      scenario: 'monetization',
      year: '2011',
      setting: 'LinkedIn IPO. The cap table.',
      chapterTitle: 'THREE REVENUE LINES',
      chapterIntro:
        "Premium subscriptions. Sales Navigator. Recruiter. " +
        "Three revenue lines into three buyer personas. " +
        "Your guest studied four hundred companies to learn what willingness to pay looks like.",
      preFightDialogue: [
        { speakerId: 'madhavan', text: "Three buyers. Three tiers. Anchor the recruiter line and the rest follows." },
        { speakerId: 'reid', text: "Recruiter is the anchor. Premium is the entry. Sales Nav is the leverage." },
      ],
      postFightReaction: { speakerId: 'madhavan', text: "Three tiers, three buyers. Textbook." },
      chapterOutro:
        "Willingness to pay should be conversation one. " +
        "Reid had three conversations at once and got each right.",
    },
    {
      chapter: 6,
      scenario: 'crisis',
      year: '2008',
      setting: 'The financial crisis.',
      chapterTitle: 'THE NETWORK SAVED US',
      chapterIntro:
        "Lehman fell. Hiring froze. Recruiters stopped paying. " +
        "Your subscription line was suddenly the only line that didn't crater. " +
        "Your guest knows discovery before delivery — and what discovery actually means in a crisis.",
      preFightDialogue: [
        { speakerId: 'cagan', text: "In a crisis you find out which line was actually load-bearing." },
        { speakerId: 'reid', text: "The network. It always was." },
      ],
      postFightReaction: { speakerId: 'cagan', text: "Network as the moat. You proved it in the worst year." },
      chapterOutro:
        "In crisis the founder discovers what was actually load-bearing. " +
        "For Reid, it was the network. Always.",
    },
    {
      chapter: 7,
      scenario: 'distribution',
      year: '2017',
      setting: 'Masters of Scale launches.',
      chapterTitle: 'PODCAST AS DISTRIBUTION',
      chapterIntro:
        "You launched Masters of Scale. " +
        "A weekly conversation with founders about counter-intuitive moves. " +
        "Built a platform-of-platforms before podcasts were a category. " +
        "Your guest knows distribution like no one else.",
      preFightDialogue: [
        { speakerId: 'spiegel', text: "Podcasting is media. Media isn't a moat." },
        { speakerId: 'reid', text: "The moat is the wisdom compounded across episodes. Network effects on conversation." },
      ],
      postFightReaction: { speakerId: 'spiegel', text: "You found a new kind of network. I'll learn from it." },
      chapterOutro:
        "Distribution is the product. " +
        "Reid built distribution out of the conversations he was already having.",
    },
    {
      chapter: 8,
      scenario: 'ipo-prep',
      year: 'Today',
      setting: 'The studio. Host vs host.',
      chapterTitle: 'TWO PODCASTERS',
      chapterIntro:
        "Final segment. " +
        "Reid, I learned to host by listening to you. " +
        "Tonight we have the same job, the same archive of operator stories, and a different worldview. " +
        "I'm not the host this round. I'm the opponent.",
      preFightDialogue: [
        { speakerId: 'lenny', text: "You blitzscale. I pattern-match. Whose framework holds?" },
        { speakerId: 'reid', text: "Both. The pattern is what survives the blitz." },
      ],
      postFightReaction: { speakerId: 'lenny', text: "Both. You always knew. I'm going to use that one." },
      chapterOutro:
        "Two podcasters walk into a ring. " +
        "Both leave with new patterns. " +
        "That's the show.",
    },
  ],
  careerEnding: {
    tagline: "THE NETWORK IS THE MOAT",
    splashImage: '/story/endings/reid.png',
    epitaph:
      "Reid Hoffman went from PayPal Mafia to LinkedIn founder to Greylock partner " +
      "to OpenAI board member to the host of Masters of Scale. " +
      "Every chapter was a network play. " +
      "The pattern repeats because Reid is the pattern. " +
      "Network effects don't untip.",
  },
}

// ────────────────────────────────────────────────────────────────────
// Other marquee fighters use the tournament default for Tier 2 ship.
// Tier 4 polish can hand-write Boris, Altman, Benioff, Fei-Fei, Elena.
// Each fighter's `careerEnding` falls back to the procedural template
// when their ID is not in MARQUEE_ARCS.
// ────────────────────────────────────────────────────────────────────

export const MARQUEE_ARCS: Record<string, StoryArc> = {
  chesky: CHESKY_ARC,
  amjad: AMJAD_ARC,
  reid: REID_ARC,
  // boris, altman, benioff, feifei, elena — placeholders for future tier
}

/** Lookup the arc for a fighter, or null if they use the tournament default. */
export function getArc(fighterId: string): StoryArc | null {
  return MARQUEE_ARCS[fighterId] ?? null
}
