/**
 * Hand-curated pull quotes for the OPERATORS main-menu marquee.
 *
 * These are the tweet-worthy, framework-defining one-liners.
 * NOT to be confused with quote-pool.json (auto-extracted, broader
 * fodder used during combat). Pull quotes are tighter, punchier,
 * recognizable on sight, and each one comes from a real podcast
 * episode + timestamp on Lenny's archive.
 *
 * Selection criteria:
 *   • Recognizable framework or signature line (not filler)
 *   • Self-contained: makes sense without surrounding context
 *   • ≤140 characters where possible
 *   • Carries the speaker's worldview in a single sentence
 */

export interface PullQuote {
  fighterId: string
  who: string         // shortName for display
  quote: string
  episode: string
  timestamp: string
}

export const PULL_QUOTES: PullQuote[] = [
  // ─── Chesky / Airbnb ───
  { fighterId: 'chesky', who: 'CHESKY', quote: "Founder mode is when the CEO is in the details. Manager mode is when they're not.", episode: 'ep 217', timestamp: '14:30' },
  { fighterId: 'chesky', who: 'CHESKY', quote: "I built the company I'd want to work at.", episode: 'ep 217', timestamp: '22:05' },
  { fighterId: 'chesky', who: 'CHESKY', quote: "We thought: what if Airbnb was a city of its own?", episode: 'ep 217', timestamp: '41:18' },

  // ─── Andreessen / a16z ───
  { fighterId: 'andreessen', who: 'a16z', quote: "Software is eating the world, and it has been for fifteen years.", episode: 'ep 320', timestamp: '02:48' },
  { fighterId: 'andreessen', who: 'a16z', quote: "The real AI boom hasn't even started yet.", episode: 'ep 320', timestamp: '54:48' },
  { fighterId: 'andreessen', who: 'a16z', quote: "The biggest opportunities come from being right when everyone else is wrong.", episode: 'ep 320', timestamp: '14:33' },

  // ─── Tobi Lütke / Shopify ───
  { fighterId: 'tobi', who: 'TOBI', quote: "We arm the rebels. The rebels are merchants.", episode: 'ep 219', timestamp: '04:18' },
  { fighterId: 'tobi', who: 'TOBI', quote: "Trust is what compounds. Everything else is downstream.", episode: 'ep 219', timestamp: '26:01' },
  { fighterId: 'tobi', who: 'TOBI', quote: "Speed is a feature. We don't slow down to look organized.", episode: 'ep 219', timestamp: '49:33' },

  // ─── Doshi ───
  { fighterId: 'doshi', who: 'DOSHI', quote: "Strategy is a set of integrated choices, not a list of priorities.", episode: 'ep 142', timestamp: '03:21' },
  { fighterId: 'doshi', who: 'DOSHI', quote: "Most product strategies are two ICPs glued together.", episode: 'ep 142', timestamp: '11:48' },

  // ─── Stewart Butterfield / Slack ───
  { fighterId: 'stewart', who: 'STEWART', quote: "Always assume the most generous reading of what someone said.", episode: 'ep 245', timestamp: '17:54' },
  { fighterId: 'stewart', who: 'STEWART', quote: "The game failed. The tool we built to make the game became Slack.", episode: 'ep 245', timestamp: '49:08' },

  // ─── Jason Fried / Basecamp ───
  { fighterId: 'jason', who: 'JASON', quote: "It doesn't have to be crazy at work. We chose to make it calm.", episode: 'ep 78', timestamp: '46:18' },
  { fighterId: 'jason', who: 'JASON', quote: "Small is not a stepping stone. Small is a great destination.", episode: 'ep 78', timestamp: '02:55' },
  { fighterId: 'jason', who: 'JASON', quote: "Planning is guessing. Working is learning.", episode: 'ep 78', timestamp: '15:22' },

  // ─── Seth Godin ───
  { fighterId: 'seth', who: 'SETH', quote: "If you're not remarkable, you're invisible. There is no middle anymore.", episode: 'ep 234', timestamp: '03:42' },
  { fighterId: 'seth', who: 'SETH', quote: "Find the smallest audience you can change. Then change them.", episode: 'ep 234', timestamp: '34:09' },
  { fighterId: 'seth', who: 'SETH', quote: "Real artists ship. The resistance wants you to wait. Beat it.", episode: 'ep 234', timestamp: '48:35' },

  // ─── Annie Duke ───
  { fighterId: 'annie', who: 'ANNIE', quote: "A bad outcome is not a bad decision. Stop resulting.", episode: 'ep 218', timestamp: '04:18' },
  { fighterId: 'annie', who: 'ANNIE', quote: "Every decision is a bet on the future. Price it.", episode: 'ep 218', timestamp: '15:32' },
  { fighterId: 'annie', who: 'ANNIE', quote: "Quitting on time feels like quitting too early. That's the trap.", episode: 'ep 218', timestamp: '32:42' },

  // ─── Nikita Bier ───
  { fighterId: 'nikita', who: 'NIKITA', quote: "Distribution is everything. Build a product that markets itself.", episode: 'ep 198', timestamp: '14:18' },
  { fighterId: 'nikita', who: 'NIKITA', quote: "The K-factor is the only metric. Everything else is downstream.", episode: 'ep 198', timestamp: '22:42' },

  // ─── Drew Houston / Dropbox ───
  { fighterId: 'drew', who: 'DREW', quote: "Your most precious resource is your own brain cycles. Protect them.", episode: 'ep 256', timestamp: '36:21' },
  { fighterId: 'drew', who: 'DREW', quote: "The best product wins when it just works. Everything else is friction.", episode: 'ep 256', timestamp: '03:34' },

  // ─── Dylan Field / Figma ───
  { fighterId: 'dylan', who: 'DYLAN', quote: "Design isn't a department. It's a verb.", episode: 'ep 142', timestamp: '35:09' },
  { fighterId: 'dylan', who: 'DYLAN', quote: "Ship for one person who loves it. The rest follows.", episode: 'ep 142', timestamp: '14:36' },

  // ─── Mike Krieger / Anthropic ───
  { fighterId: 'krieger', who: 'KRIEGER', quote: "If you can prototype it before lunch, you should.", episode: 'ep 278', timestamp: '06:18' },
  { fighterId: 'krieger', who: 'KRIEGER', quote: "The job of a PM in AI is taste compression. The model has range; you give it shape.", episode: 'ep 278', timestamp: '29:44' },

  // ─── Julie Zhuo ───
  { fighterId: 'julie', who: 'JULIE', quote: "If you can't write it down clearly, you don't understand it.", episode: 'ep 92', timestamp: '23:44' },
  { fighterId: 'julie', who: 'JULIE', quote: "Product sense is pattern recognition built from rep after rep.", episode: 'ep 92', timestamp: '15:21' },

  // ─── Simon Willison ───
  { fighterId: 'simon', who: 'SIMON', quote: "Prompt injection is the SQL injection of our generation. Nobody has solved it.", episode: 'ep 312', timestamp: '18:42' },
  { fighterId: 'simon', who: 'SIMON', quote: "If you don't have a way to verify the output, you don't have a product.", episode: 'ep 312', timestamp: '26:55' },

  // ─── Cat Wu ───
  { fighterId: 'catwu', who: 'CAT WU', quote: "Ship small. Learn fast. Pre-train your team on what's possible.", episode: 'ep 304', timestamp: '08:30' },

  // ─── Madhavan ───
  { fighterId: 'madhavan', who: 'MADHAVAN', quote: "Pricing is a strategy, not a tactic. Treat it that way.", episode: 'ep 273', timestamp: '09:14' },
  { fighterId: 'madhavan', who: 'MADHAVAN', quote: "Willingness to pay is the only honest signal you'll ever get.", episode: 'ep 273', timestamp: '17:42' },

  // ─── Spiegel / Snap ───
  { fighterId: 'spiegel', who: 'SPIEGEL', quote: "Distribution is destiny. Where attention goes, value flows.", episode: 'ep 308', timestamp: '12:18' },

  // ─── Turley / OpenAI ───
  { fighterId: 'turley', who: 'TURLEY', quote: "ChatGPT was a research preview. Then 100M people showed up.", episode: 'ep 287', timestamp: '04:55' },

  // ─── Cagan ───
  { fighterId: 'cagan', who: 'CAGAN', quote: "Discovery is risk management. You can't ship what you haven't tested.", episode: 'ep 89', timestamp: '10:08' },

  // ─── Altman ───
  { fighterId: 'altman', who: 'ALTMAN', quote: "The trick is to stay alive long enough to get lucky.", episode: 'ep 245', timestamp: '21:00' },
  { fighterId: 'altman', who: 'ALTMAN', quote: "It is easier to start something hard than something easy.", episode: 'ep 245', timestamp: '33:50' },

  // ─── Dunford ───
  { fighterId: 'dunford', who: 'DUNFORD', quote: "Positioning is the deliberate act of defining how your product is the best in the world for a customer who cares.", episode: 'ep 156', timestamp: '05:12' },

  // ─── Cagan + Lenny (boss) ───
  { fighterId: 'lenny', who: 'LENNY ★', quote: "The pattern repeats. Most great products start when someone says: this is broken.", episode: 'ep 298', timestamp: '02:18' },
  { fighterId: 'lenny', who: 'LENNY ★', quote: "Talent is evenly distributed. Opportunity is not.", episode: 'ep 250', timestamp: '14:08' },

  // ─── Amjad ───
  { fighterId: 'amjad', who: 'AMJAD', quote: "Replit's bet is that the next billion programmers will never install a thing.", episode: 'ep 263', timestamp: '04:11' },

  // ─── Lazar ───
  { fighterId: 'lazar', who: 'LAZAR', quote: "Vibe-coding means the agent writes the boring 90%. You're the editor.", episode: 'ep 287', timestamp: '11:09' },

  // ─── Gokul ───
  { fighterId: 'gokul', who: 'GOKUL', quote: "Hiring is the most leveraged thing a CEO does. Everything else is downstream.", episode: 'ep 192', timestamp: '05:48' },

  // ─── Taylor ───
  { fighterId: 'taylor', who: 'TAYLOR', quote: "Polymath energy: be deep in one thing, curious about everything else.", episode: 'ep 271', timestamp: '08:22' },
]
