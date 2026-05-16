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
        "Welcome back to the show. Tonight's guest is Brian Chesky. " +
        "Brian, take us back to 2008. You and Joe and Nate are sleeping on " +
        "air mattresses in San Francisco. The investors won't take your meetings. " +
        "You shipped Obama O's and Cap'n McCain's cereal to keep the company alive. " +
        "Tonight, the operator across from you is the man who passed on you. Marc Andreessen.",
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
        "The operator across from you tonight built a scaling curve they teach in business schools.",
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
        "The operator across from youhas lived in this room more than anyone. " +
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
        "The operator across from youships a research preview every week and learns at the speed of customers.",
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
        "The operator across from youstudied 400 companies to learn what willingness to pay actually looks like.",
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
        "The operator across from youhas lived in this exact room: discovery before delivery, even when there's no time.",
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
        "The operator across from youbuilt a distribution moat so deep it survived three model platform shifts.",
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
      setting: 'Amman. The IDE in a browser tab.',
      chapterTitle: 'OPEN A REPL',
      chapterIntro:
        "Welcome back to the show. Tonight's guest is Amjad Masad. " +
        "Amjad, take us back to Amman in 2011. " +
        "You're a self-taught engineer building a code editor that runs in the browser. " +
        "Your friends say nobody will ever write production code in a tab. " +
        "The operator across from you tonight made his company by shipping cereal boxes " +
        "when investors said no — he knows what doing-things-that-don't-scale really means. " +
        "Brian Chesky.",
      preFightDialogue: [
        { speakerId: 'chesky', text: "I shipped cereal boxes to keep the lights on. You're shipping a tab and calling it a company." },
        { speakerId: 'amjad', text: "Different cereal. Same conviction. The browser IS the company." },
      ],
      postFightReaction: { speakerId: 'chesky', text: "The browser is the company. I would have killed for that wedge in 2008." },
      chapterOutro:
        "Every category-defining product starts with a primitive nobody appreciates. " +
        "Chesky's was the air mattress. Amjad's was the link. Same insight, different decade.",
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
        "The operator across from youknows scaling curves better than anyone on the show.",
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
        "The operator across from youis the strategist who forces choice. " +
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
        "But the operator across from you tonight runs the team that ships THE dev-tool agent at Anthropic. " +
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
        "The operator across from youstudied four hundred companies to figure out how to price outcomes. " +
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
        "The operator across from youhas coached more founders through this room than anyone.",
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
        "The operator across from youknows distribution like no one else.",
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
        "Welcome back to the show. Tonight's guest is Reid Hoffman. " +
        "Reid, take us back to 2002. " +
        "You just sold PayPal. You could have retired. " +
        "Instead you sketched a network for professionals that everyone said was redundant — " +
        "Friendster existed; LinkedIn was supposedly DOA before it launched. " +
        "The operator across from you tonight is a founder you mentored. Brian Chesky.",
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
        "The operator across from you tonight built ChatGPT on a curve that taught the world what blitzscaling looks like.",
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
        "The operator across from youforces the choice no founder wants to make.",
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
        "The operator across from youbuilds at the speed of the model itself.",
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
        "The operator across from youstudied four hundred companies to learn what willingness to pay looks like.",
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
        "The operator across from youknows discovery before delivery — and what discovery actually means in a crisis.",
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
        "The operator across from youknows distribution like no one else.",
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
// BORIS CHERNY · Anthropic / Claude Code lead
// ────────────────────────────────────────────────────────────────────
const BORIS_ARC: StoryArc = {
  chapters: [
    {
      chapter: 1,
      scenario: 'pre-pmf',
      opponentOverride: 'amjad',
      year: '2024',
      setting: 'Anthropic HQ. The CLI that nobody asked for.',
      chapterTitle: 'JUST A TOOL',
      chapterIntro:
        "Welcome back to the show. Tonight's guest is Boris Cherny. " +
        "Boris, take us back to early 2024. " +
        "You're an engineer at Anthropic. You build a small CLI that lets Claude write code. " +
        "Internally it's a curiosity. Externally it's vapor. " +
        "The operator across from you tonight runs the platform you'd ship into. Amjad Masad.",
      preFightDialogue: [
        { speakerId: 'amjad', text: "A CLI? In 2024? Builders live in browsers." },
        { speakerId: 'boris', text: "Builders live in keyboards. The CLI is the keyboard for agents." },
      ],
      postFightReaction: { speakerId: 'amjad', text: "Keyboard for agents. I'll steal that one." },
      chapterOutro:
        "Every new primitive starts as a curiosity. " +
        "Boris just renamed the CLI as the agent's keyboard. The frame stuck.",
    },
    {
      chapter: 2,
      scenario: 'hypergrowth',
      year: '2024',
      setting: 'Hundreds of teams. Adoption curve goes vertical.',
      chapterTitle: 'EVERY ENGINEER',
      chapterIntro:
        "You shipped to GA. Engineers wrote about it on X. " +
        "Within a month every dev team you talked to had Claude Code in their workflow. " +
        "The curve looks like ChatGPT's first month. " +
        "The operator across from youknows what to do when the curve breaks the org.",
      preFightDialogue: [
        { speakerId: 'turley', text: "Curves like this rip teams apart. How are you not burning out?" },
        { speakerId: 'boris', text: "We codify the work. The agent is the team multiplier." },
      ],
      postFightReaction: { speakerId: 'turley', text: "Agent as multiplier. Wish I'd had that in 2023." },
      chapterOutro:
        "Hypergrowth is when the tool eats the org chart. " +
        "Boris turned the curve into a force multiplier instead of a fire drill.",
    },
    {
      chapter: 3,
      scenario: 'plateau',
      year: '2025',
      setting: 'The "feature or product?" board.',
      chapterTitle: 'FEATURE OR PRODUCT',
      chapterIntro:
        "Growth steadies. Now the question every Anthropic team asks: " +
        "is Claude Code a feature of the API or a product of its own? " +
        "The operator across from youforces the choice no founder wants to make.",
      preFightDialogue: [
        { speakerId: 'doshi', text: "Two ICPs glued together. Anthropic devs and external devs." },
        { speakerId: 'boris', text: "Codify once. Both ICPs ship from the same surface." },
      ],
      postFightReaction: { speakerId: 'doshi', text: "Codify the integration. That's strategy." },
      chapterOutro:
        "Strategy is integration. " +
        "Boris just made the platform AND the product the same shipping motion.",
    },
    {
      chapter: 4,
      scenario: 'ai-native',
      opponentOverride: 'altman',
      year: '2025',
      setting: 'The agent wars. Two labs.',
      chapterTitle: 'TWO MODELS, ONE KEYBOARD',
      chapterIntro:
        "Cursor ships its agent. Codex from OpenAI lands. The dev-tools layer is on fire. " +
        "The operator across from youruns the lab on the other side of the city. " +
        "Two foundation models, two product strategies, one engineer paying the bill.",
      preFightDialogue: [
        { speakerId: 'altman', text: "Why ship a coding agent when I sell you the model that runs it?" },
        { speakerId: 'boris', text: "Because the model is the engine. The keyboard is what the engineer touches." },
      ],
      postFightReaction: { speakerId: 'altman', text: "Engine vs keyboard. We're playing different games." },
      chapterOutro:
        "Both labs win when the engineer wins. " +
        "Boris just named the layer Anthropic owns: the agent surface, not the model substrate.",
    },
    {
      chapter: 5,
      scenario: 'monetization',
      year: '2025',
      setting: 'Token economics. Outcome billing.',
      chapterTitle: 'PRICE THE OUTPUT',
      chapterIntro:
        "Claude Code costs Anthropic real money to run. " +
        "Tokens in, tokens out, plus the agent's whole reasoning chain. " +
        "The operator across from youstudied four hundred companies to figure out what willingness-to-pay looks like.",
      preFightDialogue: [
        { speakerId: 'madhavan', text: "Don't price tokens. Price shipped PRs. Engineers pay for outcomes." },
        { speakerId: 'boris', text: "Per-merge. Per-feature. Per-agent-hour. Three tiers." },
      ],
      postFightReaction: { speakerId: 'madhavan', text: "Three tiers, anchored on the outcome. Textbook." },
      chapterOutro:
        "Outcome pricing for dev agents is the new frontier. " +
        "Boris just laid the rails the industry will run on.",
    },
    {
      chapter: 6,
      scenario: 'crisis',
      year: '2025',
      setting: 'A bad outage. Sandboxes break.',
      chapterTitle: 'WHEN THE AGENT BLEW UP',
      chapterIntro:
        "Friday afternoon. Sandboxes leaked across customer boundaries. " +
        "Twitter lit up. Engineering ate the weekend. " +
        "The operator across from youhas coached more teams through this exact failure mode than anyone.",
      preFightDialogue: [
        { speakerId: 'cagan', text: "Crisis IS discovery. What did the bug teach you about the product?" },
        { speakerId: 'boris', text: "Trust boundaries belong in the model layer, not the sandbox layer. I'm moving them." },
      ],
      postFightReaction: { speakerId: 'cagan', text: "You learned the lesson. That's the playbook." },
      chapterOutro:
        "In crisis the founder discovers what was actually load-bearing. " +
        "Boris moved the trust boundary up the stack. The product got safer.",
    },
    {
      chapter: 7,
      scenario: 'distribution',
      year: '2025',
      setting: 'Open-sourcing the SDK.',
      chapterTitle: 'EVERY EDITOR IS A WEDGE',
      chapterIntro:
        "You open-sourced the agent SDK. Now VS Code, Zed, JetBrains plugins are shipping. " +
        "Distribution by ubiquity, not by acquisition. " +
        "The operator across from youknows distribution like no one else.",
      preFightDialogue: [
        { speakerId: 'spiegel', text: "You gave away the wedge. What's the moat?" },
        { speakerId: 'boris', text: "The model. The SDK is the wedge. The Anthropic API is the moat." },
      ],
      postFightReaction: { speakerId: 'spiegel', text: "Wedge in, moat behind. You played that one well." },
      chapterOutro:
        "Distribution is the product. " +
        "Boris turned every code editor on earth into a Claude Code surface.",
    },
    {
      chapter: 8,
      scenario: 'ipo-prep',
      year: 'Today',
      setting: 'The studio. The keyboard between us.',
      chapterTitle: 'THE KEYBOARD INTERVIEW',
      chapterIntro:
        "Final segment. " +
        "Boris, every engineer I've interviewed in the last six months has Claude Code open. " +
        "Including, I'll admit, this episode's prep doc. " +
        "Tonight I want the pattern you found that the rest of us haven't.",
      preFightDialogue: [
        { speakerId: 'lenny', text: "Engineers used to write code. What do they do now?" },
        { speakerId: 'boris', text: "They edit. The model is the author. We are the editor-in-chief." },
      ],
      postFightReaction: { speakerId: 'lenny', text: "Editor-in-chief. I'll be teaching that for the next decade." },
      chapterOutro:
        "Some patterns are noticed. Some patterns are coined. " +
        "Boris coined the editor-in-chief framing. Every engineer became one.",
    },
  ],
  careerEnding: {
    tagline: "WE ARE THE EDITOR-IN-CHIEF",
    splashImage: '/story/endings/boris.png',
    epitaph:
      "Boris Cherny shipped a CLI nobody asked for in early 2024. " +
      "Eighteen months later, every dev team on earth had it open. " +
      "He didn't replace the engineer. He renamed the role. " +
      "Engineers are editors-in-chief now. The model writes. We decide.",
  },
}

// ────────────────────────────────────────────────────────────────────
// SAM ALTMAN · OpenAI CEO
// ────────────────────────────────────────────────────────────────────
const ALTMAN_ARC: StoryArc = {
  chapters: [
    {
      chapter: 1,
      scenario: 'pre-pmf',
      year: '2014',
      setting: 'Y Combinator. President.',
      chapterTitle: 'BEFORE THE LAB',
      chapterIntro:
        "Welcome back to the show. Tonight's guest is Sam Altman. " +
        "Sam, take us back to 2014. " +
        "You just took over as president of Y Combinator. Loopt is behind you. " +
        "Nobody has named OpenAI yet. " +
        "The operator across from you tonight is the most famous founder to come through your batches. Brian Chesky.",
      preFightDialogue: [
        { speakerId: 'chesky', text: "You're not a builder anymore, Sam. You're a coach. Different game." },
        { speakerId: 'altman', text: "Coach for now. The next game is bigger than any of yours." },
      ],
      postFightReaction: { speakerId: 'chesky', text: "Bigger than any of ours. He saw it before the rest of us." },
      chapterOutro:
        "Some operators ship products. Some ship batches of founders. " +
        "Altman was about to ship something neither.",
    },
    {
      chapter: 2,
      scenario: 'hypergrowth',
      year: '2023',
      setting: 'Post-ChatGPT. A million users in five days.',
      chapterTitle: 'FIVE DAYS TO A MILLION',
      chapterIntro:
        "November 30, 2022. You ship ChatGPT as a research preview. " +
        "Five days later it hit a million users. " +
        "Three months later, a hundred million. " +
        "The operator across from youknows what scaling curves do to the people who survive them.",
      preFightDialogue: [
        { speakerId: 'turley', text: "I was on the team. We were not ready. Nobody is ready for that curve." },
        { speakerId: 'altman', text: "Ready is a luxury. The market doesn't wait. Ship anyway." },
      ],
      postFightReaction: { speakerId: 'turley', text: "Ship anyway. That's the only frame that survives that month." },
      chapterOutro:
        "Hypergrowth at the scale of ChatGPT had never been seen. " +
        "Altman shipped into a curve that broke the internet's expectations of itself.",
    },
    {
      chapter: 3,
      scenario: 'plateau',
      year: '2024',
      setting: 'The GPT-5 question.',
      chapterTitle: 'WHEN DOES THE NEXT JUMP COME',
      chapterIntro:
        "GPT-4 is everywhere. Scaling laws say there's another jump. " +
        "Critics say the curve is bending. " +
        "The operator across from youforces the strategic question every model lab refuses to name.",
      preFightDialogue: [
        { speakerId: 'doshi', text: "Two ICPs glued together. ChatGPT consumer and the API enterprise." },
        { speakerId: 'altman', text: "Both. Forever. The platform is the integration." },
      ],
      postFightReaction: { speakerId: 'doshi', text: "Platform as integration. Crisp." },
      chapterOutro:
        "Strategy is choice. " +
        "Altman chose both — and made the platform the integration itself.",
    },
    {
      chapter: 4,
      scenario: 'ai-native',
      opponentOverride: 'boris',
      year: '2024',
      setting: 'The agent wars. Anthropic across the street.',
      chapterTitle: 'TWO LABS, ONE FUTURE',
      chapterIntro:
        "Anthropic ships Claude. Anthropic ships Claude Code. " +
        "The rival lab keeps shipping. " +
        "The operator across from youruns their dev-tools layer.",
      preFightDialogue: [
        { speakerId: 'boris', text: "You sell the model. I sell the keyboard for it. Same engineer pays us both." },
        { speakerId: 'altman', text: "Then we're allies in disguise. Engineers win, both labs win." },
      ],
      postFightReaction: { speakerId: 'boris', text: "Allies in disguise. I'll take that frame." },
      chapterOutro:
        "Two labs. One engineer. Both labs ship the future. " +
        "Altman just made the rivalry productive.",
    },
    {
      chapter: 5,
      scenario: 'monetization',
      year: '2023',
      setting: 'ChatGPT Plus launches.',
      chapterTitle: 'TWENTY DOLLARS A MONTH',
      chapterIntro:
        "You shipped a $20/month plan over the holidays. " +
        "By Q2 you have ten million subscribers. " +
        "The operator across from youstudied four hundred companies on willingness to pay.",
      preFightDialogue: [
        { speakerId: 'madhavan', text: "You anchored at twenty. You could have anchored at fifty." },
        { speakerId: 'altman', text: "I anchored at twenty because I wanted everyone in. The next jump comes later." },
      ],
      postFightReaction: { speakerId: 'madhavan', text: "Anchored at access. Then the upsell. Long game." },
      chapterOutro:
        "Willingness to pay is conversation one. " +
        "Altman set the floor low. The ceiling is wherever the next model takes him.",
    },
    {
      chapter: 6,
      scenario: 'crisis',
      year: '2023',
      setting: 'November. The board.',
      chapterTitle: 'THE FRIDAY',
      chapterIntro:
        "Friday afternoon. The board fired you. " +
        "On Monday morning seven hundred employees threatened to leave with you. " +
        "By Tuesday you were back. " +
        "The operator across from youknows what discovery means when the floor disappears.",
      preFightDialogue: [
        { speakerId: 'cagan', text: "The discovery wasn't the firing. It was who walked out the door with you." },
        { speakerId: 'altman', text: "I learned what we built when it almost ended. " +
          "Trust compounds. Or evaporates in a weekend." },
      ],
      postFightReaction: { speakerId: 'cagan', text: "Trust compounds. The clearest crisis lesson I've ever heard." },
      chapterOutro:
        "In crisis the founder discovers what was actually load-bearing. " +
        "For Altman, it was the team's loyalty. Trust compounds. The pattern repeats.",
    },
    {
      chapter: 7,
      scenario: 'distribution',
      year: '2024',
      setting: 'DevDay. Sora. Agents.',
      chapterTitle: 'PLATFORM AS DISTRIBUTION',
      chapterIntro:
        "DevDay 2024. You announced agents, the GPT store, custom GPTs. " +
        "You turned a model into a marketplace. " +
        "The operator across from youbuilt a distribution moat so deep it survived three model shifts.",
      preFightDialogue: [
        { speakerId: 'spiegel', text: "The GPT store was a stalled marketplace. The Operator agent isn't shipping fast enough." },
        { speakerId: 'altman', text: "Both are wedges. The model behind them is the moat." },
      ],
      postFightReaction: { speakerId: 'spiegel', text: "Wedge plus moat. You played both sides." },
      chapterOutro:
        "Distribution is the product. " +
        "Altman turned the model into the marketplace and the marketplace into the moat.",
    },
    {
      chapter: 8,
      scenario: 'ipo-prep',
      year: 'Today',
      setting: 'The studio. Two operators of patterns.',
      chapterTitle: 'THE LONG INTERVIEW',
      chapterIntro:
        "Final segment. " +
        "Sam, your trajectory is the one that bends every other operator's career. " +
        "Tonight I want the pattern you've found that the rest of us haven't.",
      preFightDialogue: [
        { speakerId: 'lenny', text: "What's the pattern across paradigms? Scale, governance, distribution — pick one." },
        { speakerId: 'altman', text: "Time. The thing that compounds. Everyone underestimates it." },
      ],
      postFightReaction: { speakerId: 'lenny', text: "Time compounds. Simple. True. Hardest one to actually believe." },
      chapterOutro:
        "Some patterns are noticed. Some patterns are obvious in retrospect. " +
        "Altman's was time. We're all watching it compound.",
    },
  ],
  careerEnding: {
    tagline: "TIME COMPOUNDS",
    splashImage: '/story/endings/altman.png',
    epitaph:
      "Sam Altman went from Loopt to YC to OpenAI to the most consequential company of the era. " +
      "Across a board firing, a hundred million users, a paradigm shift, " +
      "the pattern was the same: bet on the compounding curve, hold through the volatility. " +
      "Time compounds. He just knew first.",
  },
}

// ────────────────────────────────────────────────────────────────────
// MARC BENIOFF · Salesforce founder
// ────────────────────────────────────────────────────────────────────
const BENIOFF_ARC: StoryArc = {
  chapters: [
    {
      chapter: 1,
      scenario: 'pre-pmf',
      year: '1999',
      setting: 'San Francisco. A one-bedroom apartment that became HQ.',
      chapterTitle: 'NO SOFTWARE',
      chapterIntro:
        "Welcome back to the show. Tonight's guest is Marc Benioff. " +
        "Marc, take us back to 1999. " +
        "You left Oracle at 36 to start a software company that wouldn't ship software. " +
        "Wall Street called you delusional. Oracle called you naive. " +
        "The operator across from you tonight is the founder who later shipped a planet from a couch. Brian Chesky.",
      preFightDialogue: [
        { speakerId: 'chesky', text: "Selling enterprise software in a browser? Everyone said it couldn't work." },
        { speakerId: 'benioff', text: "Everyone said your air mattress couldn't work either. We were both right." },
      ],
      postFightReaction: { speakerId: 'chesky', text: "We were both right. The market always catches up." },
      chapterOutro:
        "Every category-defining product started with a primitive nobody appreciated. " +
        "Benioff's was the URL.",
    },
    {
      chapter: 2,
      scenario: 'hypergrowth',
      year: '2004',
      setting: 'IPO Day. NYSE.',
      chapterTitle: 'NO SOFTWARE GOES PUBLIC',
      chapterIntro:
        "June 2004. You ring the bell. " +
        "Salesforce IPOs at $11. By close it's $17. " +
        "The slogan that mocked Oracle is now embroidered on Wall Street ties. " +
        "The operator across from youknows hypergrowth curves intimately.",
      preFightDialogue: [
        { speakerId: 'turley', text: "Going public is the easy part. The next ten years are the test." },
        { speakerId: 'benioff', text: "Then the test is what I build. Watch." },
      ],
      postFightReaction: { speakerId: 'turley', text: "He didn't blink at the curve. Respect." },
      chapterOutro:
        "Hypergrowth is the moment the company becomes the category. " +
        "Salesforce became enterprise SaaS.",
    },
    {
      chapter: 3,
      scenario: 'plateau',
      year: '2010',
      setting: 'After CRM. What\'s next?',
      chapterTitle: 'BEYOND CRM',
      chapterIntro:
        "Sales Cloud is mature. Service Cloud is shipping. Marketing Cloud is brewing. " +
        "Three product lines, three sales motions, three ICPs. " +
        "The operator across from youis the strategist who forces the synthesis.",
      preFightDialogue: [
        { speakerId: 'doshi', text: "Three clouds is three companies. Pick one." },
        { speakerId: 'benioff', text: "One platform. Many clouds. The platform IS the strategy." },
      ],
      postFightReaction: { speakerId: 'doshi', text: "Platform as strategy. Crisp." },
      chapterOutro:
        "Strategy is integration. " +
        "Benioff turned three product lines into one platform — and made it the moat.",
    },
    {
      chapter: 4,
      scenario: 'ai-native',
      year: '2024',
      setting: 'Dreamforce. Agentforce launch.',
      chapterTitle: 'AGENTFORCE',
      chapterIntro:
        "The agentic shift arrived. You bet the company on Agentforce. " +
        "Critics said Salesforce was too big to pivot. " +
        "The operator across from youmoves at the cadence of model releases.",
      preFightDialogue: [
        { speakerId: 'catwu', text: "You can't bolt agents onto a twenty-five-year-old CRM. You rebuild." },
        { speakerId: 'benioff', text: "Then we rebuild. From the data layer up." },
      ],
      postFightReaction: { speakerId: 'catwu', text: "You actually moved at our cadence. I underestimated." },
      chapterOutro:
        "The companies that survive the model shift are the ones who treat shipping as the only metric. " +
        "Benioff just moved a public-company org at research speed.",
    },
    {
      chapter: 5,
      scenario: 'monetization',
      year: '2018',
      setting: 'The seven-product cap table.',
      chapterTitle: 'PRICED AS PLATFORM',
      chapterIntro:
        "Sales Cloud. Service. Marketing. Commerce. Data. Tableau. Slack. " +
        "Seven products, each priced as a separate SKU on a platform contract. " +
        "The operator across from youstudied four hundred companies to figure out how the cap table breathes.",
      preFightDialogue: [
        { speakerId: 'madhavan', text: "Seven SKUs is seven negotiations. You're leaving money on the table." },
        { speakerId: 'benioff', text: "Or I'm leaving room for the eighth. Watch the platform price." },
      ],
      postFightReaction: { speakerId: 'madhavan', text: "Platform price grows with the product set. Beautiful." },
      chapterOutro:
        "Pricing is strategy. " +
        "Benioff turned seven SKUs into one platform line that compounded.",
    },
    {
      chapter: 6,
      scenario: 'crisis',
      year: '2023',
      setting: 'The Slack deal blowback. The activist investor.',
      chapterTitle: 'WHEN THE ACTIVISTS CAME',
      chapterIntro:
        "Activist investors targeted you for the Slack acquisition. " +
        "Earnings missed. Layoffs followed. " +
        "The operator across from youhas coached more public-company founders through this room than anyone.",
      preFightDialogue: [
        { speakerId: 'cagan', text: "Discovery before delivery. What did the Slack acquisition actually buy you?" },
        { speakerId: 'benioff', text: "A second moat. Workflow. Around the data we already owned." },
      ],
      postFightReaction: { speakerId: 'cagan', text: "Workflow around data. Now I see the thesis." },
      chapterOutro:
        "In crisis the founder discovers what was actually load-bearing. " +
        "For Benioff, it was the integration of the workflow with the data.",
    },
    {
      chapter: 7,
      scenario: 'distribution',
      year: '2008',
      setting: 'Dreamforce. The Ohana culture moment.',
      chapterTitle: 'OHANA',
      chapterIntro:
        "Dreamforce becomes the biggest software conference on earth. " +
        "Tens of thousands of developers, partners, customers, all calling each other Ohana. " +
        "The operator across from youknows distribution like no one else.",
      preFightDialogue: [
        { speakerId: 'spiegel', text: "Your conference is a moat. People come for the trust, stay for the contracts." },
        { speakerId: 'benioff', text: "Ohana is the distribution. Trust compounds across years of attendance." },
      ],
      postFightReaction: { speakerId: 'spiegel', text: "Distribution as identity. You did it before the rest of us." },
      chapterOutro:
        "Distribution is the product. " +
        "Benioff turned a customer conference into a religion. Religions don't churn.",
    },
    {
      chapter: 8,
      scenario: 'ipo-prep',
      year: 'Today',
      setting: 'The studio.',
      chapterTitle: 'THE PLATFORM INTERVIEW',
      chapterIntro:
        "Final segment. " +
        "Marc, you've been on this show three times. " +
        "Tonight I want the pattern you've held through three platform shifts.",
      preFightDialogue: [
        { speakerId: 'lenny', text: "Cloud. Mobile. AI. Three platform shifts. What stayed constant?" },
        { speakerId: 'benioff', text: "Trust. The other companies sold software. I sold trust. The platform was the proof." },
      ],
      postFightReaction: { speakerId: 'lenny', text: "Trust as the product. Three decades of compounding." },
      chapterOutro:
        "Some operators ship products. Benioff shipped trust. " +
        "The platform was just the receipt.",
    },
  ],
  careerEnding: {
    tagline: "TRUST IS THE PRODUCT",
    splashImage: '/story/endings/benioff.png',
    epitaph:
      "Marc Benioff founded Salesforce in 1999 with three words: No Software. " +
      "Twenty-six years and three platform shifts later, the company is bigger than Oracle. " +
      "He didn't ship software. He shipped trust. " +
      "The platform was the proof, and Ohana was the moat. " +
      "Trust compounds. He proved it three times.",
  },
}

// ────────────────────────────────────────────────────────────────────
// FEI-FEI LI · Godmother of AI / World Labs founder
// ────────────────────────────────────────────────────────────────────
const FEIFEI_ARC: StoryArc = {
  chapters: [
    {
      chapter: 1,
      scenario: 'pre-pmf',
      year: '2007',
      setting: 'Princeton lab. Curating a dataset by hand.',
      chapterTitle: 'IMAGENET',
      chapterIntro:
        "Welcome back to the show. Tonight's guest is Fei-Fei Li. " +
        "Fei-Fei, take us back to 2007 at Princeton. " +
        "You're a junior professor with an unfundable idea: " +
        "label millions of images by hand and call it a benchmark. " +
        "The operator across from you tonight is the founder who scaled a hand-curated marketplace into a planet. Brian Chesky.",
      preFightDialogue: [
        { speakerId: 'chesky', text: "Mechanical Turk for an academic dataset? That's not a business." },
        { speakerId: 'feifei', text: "It isn't. It's the substrate every business will sit on." },
      ],
      postFightReaction: { speakerId: 'chesky', text: "The substrate. She saw it before the rest of us." },
      chapterOutro:
        "Every category-defining product started with a primitive nobody appreciated. " +
        "Fei-Fei's was the dataset. Modern AI sat on top of it.",
    },
    {
      chapter: 2,
      scenario: 'hypergrowth',
      year: '2012',
      setting: 'NeurIPS. AlexNet wins ImageNet.',
      chapterTitle: 'THE BENCHMARK FELL',
      chapterIntro:
        "AlexNet crushes the ImageNet competition. " +
        "The room you've sat in for five years finally believes. " +
        "Suddenly every lab on earth wants compute. " +
        "The operator across from youknows scaling curves at consumer scale.",
      preFightDialogue: [
        { speakerId: 'turley', text: "The benchmark fell. Now the curve goes vertical. Hope you're ready." },
        { speakerId: 'feifei', text: "The curve has been bending for ten years. I've just been waiting for the world." },
      ],
      postFightReaction: { speakerId: 'turley', text: "Waiting for the world. Patient operators win." },
      chapterOutro:
        "Hypergrowth is when the curve everyone else just noticed has been your life for a decade.",
    },
    {
      chapter: 3,
      scenario: 'plateau',
      year: '2015',
      setting: 'The "is this just academic?" question.',
      chapterTitle: 'CROSSING THE LINE',
      chapterIntro:
        "ImageNet is everywhere in research. " +
        "Industry still treats AI as a toy. " +
        "You're being asked to cross from professor to operator. " +
        "The operator across from youforces the choice no academic wants to name.",
      preFightDialogue: [
        { speakerId: 'doshi', text: "Stay academic or build product. You can't be two ICPs glued together." },
        { speakerId: 'feifei', text: "Both. Research and product. The work is the same work." },
      ],
      postFightReaction: { speakerId: 'doshi', text: "Research as product. Different cadences, same north star." },
      chapterOutro:
        "Strategy is integration. " +
        "Fei-Fei kept the lab AND took the product job. The work was the same work.",
    },
    {
      chapter: 4,
      scenario: 'ai-native',
      year: '2017',
      setting: 'Google AI. Chief Scientist.',
      chapterTitle: 'PRODUCTIZING THE RESEARCH',
      chapterIntro:
        "You ran Google Cloud AI. " +
        "Vision API. AutoML. The research-to-product translation. " +
        "The operator across from youmoves at research speed and ships at product speed.",
      preFightDialogue: [
        { speakerId: 'catwu', text: "Research-to-product is a cadence problem. How do you compress it?" },
        { speakerId: 'feifei', text: "You stop separating them. The model is the product. The product is the research." },
      ],
      postFightReaction: { speakerId: 'catwu', text: "Same cadence. You named what I've been doing." },
      chapterOutro:
        "AI-native is the discipline that didn't exist when Fei-Fei started ImageNet. " +
        "She didn't just survive the platform shift. She authored it.",
    },
    {
      chapter: 5,
      scenario: 'monetization',
      year: '2024',
      setting: 'World Labs. The first round.',
      chapterTitle: 'SPATIAL AI IS A BUSINESS',
      chapterIntro:
        "You left Stanford to start World Labs. " +
        "Spatial intelligence. World models. A business case that didn't exist a year ago. " +
        "The operator across from youstudied four hundred companies on willingness to pay.",
      preFightDialogue: [
        { speakerId: 'madhavan', text: "Who pays for a world model? Pricing has to anchor somewhere." },
        { speakerId: 'feifei', text: "Robotics. Simulation. Embodied agents. Three buyers, three tiers." },
      ],
      postFightReaction: { speakerId: 'madhavan', text: "Three buyers, three tiers. Textbook." },
      chapterOutro:
        "Pricing is strategy. " +
        "Fei-Fei anchored a new business in a category that didn't have a name yet.",
    },
    {
      chapter: 6,
      scenario: 'crisis',
      year: '1998',
      setting: 'The AI winter. Funding dried.',
      chapterTitle: 'THREE AI WINTERS',
      chapterIntro:
        "You've lived through three AI winters. " +
        "Grants frozen. Mentors leaving. Conferences shrinking. " +
        "The operator across from youknows the discovery-before-delivery discipline that survives that room.",
      preFightDialogue: [
        { speakerId: 'cagan', text: "What do you discover when the field everyone tells you is dead is the only place you'll work?" },
        { speakerId: 'feifei', text: "That a summer comes after every winter. The dataset I built was the spring." },
      ],
      postFightReaction: { speakerId: 'cagan', text: "Spring comes. The data was the proof." },
      chapterOutro:
        "In crisis the founder discovers what was actually load-bearing. " +
        "For Fei-Fei, it was the conviction that the winter would end. " +
        "She built the dataset that made the spring.",
    },
    {
      chapter: 7,
      scenario: 'distribution',
      year: '2024',
      setting: 'World Labs goes public-facing.',
      chapterTitle: 'AI FOR ALL',
      chapterIntro:
        "AI4ALL. World Labs research demos. Your TED Talk. " +
        "You turned the godmother title into a global teaching platform. " +
        "The operator across from youknows distribution like no one else.",
      preFightDialogue: [
        { speakerId: 'spiegel', text: "Research talks aren't distribution. They're brand." },
        { speakerId: 'feifei', text: "Brand IS distribution when the brand is trust in the curve." },
      ],
      postFightReaction: { speakerId: 'spiegel', text: "Brand as trust as distribution. Decade-long compounder." },
      chapterOutro:
        "Distribution is the product. " +
        "Fei-Fei built distribution out of being right for twenty years.",
    },
    {
      chapter: 8,
      scenario: 'ipo-prep',
      year: 'Today',
      setting: 'The studio.',
      chapterTitle: 'THE GODMOTHER INTERVIEW',
      chapterIntro:
        "Final segment. " +
        "Fei-Fei, you saw the curve in 2007. The rest of us caught up in 2022. " +
        "Tonight I want the pattern you've held through three winters.",
      preFightDialogue: [
        { speakerId: 'lenny', text: "What's the pattern across three AI winters?" },
        { speakerId: 'feifei', text: "Data is the moat. Models are the surface. The summer that's here isn't ending." },
      ],
      postFightReaction: { speakerId: 'lenny', text: "Data as moat. The summer doesn't end. I'll cite that for years." },
      chapterOutro:
        "Some patterns are noticed. Some patterns ARE the operator. " +
        "Fei-Fei IS the pattern. She just kept being right.",
    },
  ],
  careerEnding: {
    tagline: "THIS SUMMER WON'T END",
    splashImage: '/story/endings/feifei.png',
    epitaph:
      "Fei-Fei Li built ImageNet when nobody believed labels mattered. " +
      "She left Stanford to start World Labs when nobody believed spatial AI was a business. " +
      "Three AI winters survived. Three AI summers built. " +
      "The pattern is that there's always another curve coming. " +
      "She's seen the next one already. We're just catching up.",
  },
}

// ────────────────────────────────────────────────────────────────────
// ELENA VERNA · Growth operator
// ────────────────────────────────────────────────────────────────────
const ELENA_ARC: StoryArc = {
  chapters: [
    {
      chapter: 1,
      scenario: 'pre-pmf',
      year: '2012',
      setting: 'SurveyMonkey. First "VP Growth" role.',
      chapterTitle: 'INVENTING THE ROLE',
      chapterIntro:
        "Welcome back to the show. Tonight's guest is Elena Verna. " +
        "Elena, take us back to SurveyMonkey in the early 2010s. " +
        "You're running growth before the title 'VP of Growth' really exists. " +
        "You're writing the playbook in real time on a nine-figure ARR business. " +
        "The operator across from you tonight is the founder who knows what shipping really means. Brian Chesky.",
      preFightDialogue: [
        { speakerId: 'chesky', text: "Growth is a function or a feature? Most people get it wrong." },
        { speakerId: 'elena', text: "Growth is a loop. Funnels run out. Loops compound." },
      ],
      postFightReaction: { speakerId: 'chesky', text: "Funnels run out. Loops compound. I should have known that ten years ago." },
      chapterOutro:
        "Every category-defining discipline started with a function nobody had named. " +
        "Elena named growth.",
    },
    {
      chapter: 2,
      scenario: 'hypergrowth',
      year: '2020',
      setting: 'Miro. The pandemic flywheel.',
      chapterTitle: 'WHEN THE WORLD WENT REMOTE',
      chapterIntro:
        "March 2020. Every remote team needed a whiteboard. " +
        "Miro's free-tier signups went 20x in a month. " +
        "You held the activation curve through chaos. " +
        "The operator across from youknows scaling curves at ChatGPT speed.",
      preFightDialogue: [
        { speakerId: 'turley', text: "Curves like that break activation. How did you hold it?" },
        { speakerId: 'elena', text: "Aha moment first. Everything else is overhead." },
      ],
      postFightReaction: { speakerId: 'turley', text: "Aha first. The growth team's anchor when everything else burns." },
      chapterOutro:
        "Hypergrowth is when activation becomes load-bearing. " +
        "Elena held the curve by holding the aha.",
    },
    {
      chapter: 3,
      scenario: 'plateau',
      year: '2022',
      setting: 'Post-pandemic plateau. Free tier or paid?',
      chapterTitle: 'THE FREE-TIER QUESTION',
      chapterIntro:
        "The pandemic surge is over. Free signups are still growing but paid conversion is bending. " +
        "Every CFO wants a paywall. " +
        "The operator across from youforces the choice every PLG operator dreads.",
      preFightDialogue: [
        { speakerId: 'doshi', text: "Two ICPs glued together. Self-serve and enterprise. Pick." },
        { speakerId: 'elena', text: "Self-serve is the wedge. Enterprise is the upsell. The loop runs through both." },
      ],
      postFightReaction: { speakerId: 'doshi', text: "Loop through both ICPs. The PLG synthesis I've been looking for." },
      chapterOutro:
        "Strategy is integration. " +
        "Elena turned the free-tier question into a loop that fed both ICPs.",
    },
    {
      chapter: 4,
      scenario: 'ai-native',
      year: '2024',
      setting: 'AI-native growth. The model is the funnel.',
      chapterTitle: 'GROWTH IN THE AI ERA',
      chapterIntro:
        "AI changes the funnel. Search dies. Inbound shifts. Ahas happen inside the agent. " +
        "The operator across from youmoves at the cadence of new models.",
      preFightDialogue: [
        { speakerId: 'catwu', text: "The funnel you spent a decade building just got rewritten by an LLM." },
        { speakerId: 'elena', text: "Then I rewrite. Aha moments in chat. Loops through the agent." },
      ],
      postFightReaction: { speakerId: 'catwu', text: "Aha moments in chat. The PLG playbook for the next decade." },
      chapterOutro:
        "AI-native growth is its own discipline. " +
        "Elena's writing the playbook before the playbook has a category.",
    },
    {
      chapter: 5,
      scenario: 'monetization',
      year: '2018',
      setting: 'The pricing committee. Tier collapse.',
      chapterTitle: 'PRICING THE LOOP',
      chapterIntro:
        "Growth and pricing usually fight. " +
        "You proved they don't have to. " +
        "The operator across from youstudied four hundred companies on willingness to pay.",
      preFightDialogue: [
        { speakerId: 'madhavan', text: "Growth optimizes for top of funnel. Pricing optimizes for bottom. Who wins?" },
        { speakerId: 'elena', text: "Loop wins. Price for retention, not acquisition. The loop is the moat." },
      ],
      postFightReaction: { speakerId: 'madhavan', text: "Price for retention. The cleanest PLG pricing frame I've heard." },
      chapterOutro:
        "Pricing is strategy. " +
        "Elena reframed pricing as a loop-feeder, not a gate.",
    },
    {
      chapter: 6,
      scenario: 'crisis',
      year: '2023',
      setting: 'The tech downturn. Layoffs.',
      chapterTitle: 'WHEN GROWTH FROZE',
      chapterIntro:
        "Companies froze hiring. Marketing budgets evaporated. " +
        "Growth teams were the first cut. " +
        "The operator across from youhas coached more operators through this exact room than anyone.",
      preFightDialogue: [
        { speakerId: 'cagan', text: "When growth freezes the discipline matters more, not less. What did you discover?" },
        { speakerId: 'elena', text: "That loops are still the answer. The CFOs who cut growth cut their compounding." },
      ],
      postFightReaction: { speakerId: 'cagan', text: "Cut growth, cut compounding. The clearest summary I've heard." },
      chapterOutro:
        "In crisis the founder discovers what was actually load-bearing. " +
        "Elena reminded the industry that growth is a system, not a cost center.",
    },
    {
      chapter: 7,
      scenario: 'distribution',
      year: '2024',
      setting: 'The advisor circuit. Multi-company operator.',
      chapterTitle: 'DISTRIBUTING THE PLAYBOOK',
      chapterIntro:
        "You stopped operating full-time. You started advising six companies at once. " +
        "Your playbook now ships through everybody else's growth team. " +
        "The operator across from youknows distribution like no one else.",
      preFightDialogue: [
        { speakerId: 'spiegel', text: "Advisor work is brand, not distribution. You're trading hours for trust." },
        { speakerId: 'elena', text: "Trust IS distribution when the trust is in the loop." },
      ],
      postFightReaction: { speakerId: 'spiegel', text: "Trust as distribution. I'll cite that one." },
      chapterOutro:
        "Distribution is the product. " +
        "Elena turned a career of loops into a distribution system for the next decade of operators.",
    },
    {
      chapter: 8,
      scenario: 'ipo-prep',
      year: 'Today',
      setting: 'The studio.',
      chapterTitle: 'THE LOOP INTERVIEW',
      chapterIntro:
        "Final segment. " +
        "Elena, every growth team I talk to references your frameworks. " +
        "Tonight I want the pattern you've held across four companies and a decade.",
      preFightDialogue: [
        { speakerId: 'lenny', text: "What's the pattern across all the growth systems you've built?" },
        { speakerId: 'elena', text: "Loops compound. Funnels don't. Operators who optimize for loops win the decade." },
      ],
      postFightReaction: { speakerId: 'lenny', text: "Loops compound. The clearest growth thesis on the show." },
      chapterOutro:
        "Some patterns are noticed. Some patterns ARE the playbook. " +
        "Elena's loop pattern is the playbook every growth team I know runs on.",
    },
  ],
  careerEnding: {
    tagline: "LOOPS COMPOUND",
    splashImage: '/story/endings/elena.png',
    epitaph:
      "Elena Verna invented the modern growth role. " +
      "She held the curve through Miro's pandemic surge, " +
      "wrote the PLG playbook the industry runs on, " +
      "and proved that growth is a system, not a cost center. " +
      "Funnels run out. Loops compound. " +
      "The next decade's operators learned it from her.",
  },
}

// ────────────────────────────────────────────────────────────────────
// All eight marquee arcs assembled. Other 56 fighters use tournament default.
// ────────────────────────────────────────────────────────────────────

export const MARQUEE_ARCS: Record<string, StoryArc> = {
  amjad: AMJAD_ARC,
  chesky: CHESKY_ARC,
  boris: BORIS_ARC,
  altman: ALTMAN_ARC,
  benioff: BENIOFF_ARC,
  feifei: FEIFEI_ARC,
  elena: ELENA_ARC,
  reid: REID_ARC,
}

/** Ordered list of marquee fighter IDs (for badges + Character Select highlight). */
export const MARQUEE_ROSTER = Object.keys(MARQUEE_ARCS)
export function isMarquee(fighterId: string): boolean {
  return fighterId in MARQUEE_ARCS
}

/** Lookup the arc for a fighter, or null if they use the tournament default. */
export function getArc(fighterId: string): StoryArc | null {
  return MARQUEE_ARCS[fighterId] ?? null
}
