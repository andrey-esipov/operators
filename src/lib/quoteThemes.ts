/**
 * Lightweight keyword-driven theme classifier for quotes.
 *
 * Operators-game-specific theme taxonomy aligned with podcast topics:
 *   pricing · distribution · leadership · ai-native · growth · positioning
 *   · product-sense · execution · culture · strategy
 *
 * Each quote can carry 0..N themes. The classifier is intentionally lossy
 * — when a quote doesn't match, it lands in "misc". Themes power the
 * Quote Bank filter chips and the Framework Encyclopedia grouping.
 */

export type ThemeId =
  | 'pricing'
  | 'distribution'
  | 'leadership'
  | 'ai-native'
  | 'growth'
  | 'positioning'
  | 'product-sense'
  | 'execution'
  | 'culture'
  | 'strategy'
  | 'misc'

export interface ThemeDef {
  id: ThemeId
  label: string
  icon: string
  accent: string
  keywords: RegExp
}

export const THEMES: ThemeDef[] = [
  {
    id: 'pricing',
    label: 'Pricing & Monetization',
    icon: '💰',
    accent: '#F72585',
    keywords: /\b(price|pricing|monetiz|willingness to pay|tier|outcome|revenue|subscrib|paid|free.tier|wtp|charge|charging|cost|margin)\b/i,
  },
  {
    id: 'distribution',
    label: 'Distribution & Growth',
    icon: '📡',
    accent: '#FCBF49',
    keywords: /\b(distribution|distribut|channel|go.to.market|gtm|moat|viral|k.factor|loop|acquisition|attention|audience)\b/i,
  },
  {
    id: 'leadership',
    label: 'Leadership & Org',
    icon: '🧭',
    accent: '#7209B7',
    keywords: /\b(founder|ceo|manager|hire|hiring|fire|team|org|leader|leadership|culture|delegate|empowered)\b/i,
  },
  {
    id: 'ai-native',
    label: 'AI-Native',
    icon: '⚡',
    accent: '#00B4D8',
    keywords: /\b(ai|llm|model|gpt|claude|agent|prompt|inference|embedding|fine.tune|hallucin|copilot|automation|dark factory|claude code|replit agent)\b/i,
  },
  {
    id: 'growth',
    label: 'Growth & Hypergrowth',
    icon: '📈',
    accent: '#06D6A0',
    keywords: /\b(growth|scal|hypergrowth|user|10x|compound|exponential|retention|activation|onboard|north star|rate limit|fastest growing)\b/i,
  },
  {
    id: 'positioning',
    label: 'Positioning & Strategy',
    icon: '🎯',
    accent: '#EF233C',
    keywords: /\b(position|strategy|integrated choices|category|icp|customer.profile|differentiat|niche|wedge|critical few|lno|why.now)\b/i,
  },
  {
    id: 'product-sense',
    label: 'Product Sense',
    icon: '✦',
    accent: '#FFD60A',
    keywords: /\b(taste|product sense|intuition|prototype|ship.small|preview|research preview|discovery|empower|insight|user.research|customer interview|build it)\b/i,
  },
  {
    id: 'execution',
    label: 'Execution & Velocity',
    icon: '⚙',
    accent: '#FCBF49',
    keywords: /\b(ship|speed|velocity|cadence|sprint|deadline|six.week|momentum|deploy|merge|pr|pull request|forcing function|outcome|review)\b/i,
  },
  {
    id: 'culture',
    label: 'Culture & Mindset',
    icon: '🔥',
    accent: '#E63946',
    keywords: /\b(calm|burnout|crazy|kindness|charity|generous|trust|mindset|resilience|grit|patience|honesty|honest)\b/i,
  },
  {
    id: 'strategy',
    label: 'Strategy & Decision-Making',
    icon: '♛',
    accent: '#0077B6',
    keywords: /\b(decision|bet|odds|process|outcome|pattern|first principles|tradeoff|pivot|quit|sunk cost|focus|priorit|opportunity cost)\b/i,
  },
]

export function classifyQuote(text: string): ThemeId[] {
  const matched = THEMES.filter((t) => t.keywords.test(text)).map((t) => t.id)
  return matched.length > 0 ? matched : ['misc']
}

export function getTheme(id: ThemeId): ThemeDef | undefined {
  return THEMES.find((t) => t.id === id)
}
