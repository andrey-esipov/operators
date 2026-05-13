import type { Scenario, ScenarioId } from '../types'

/**
 * Rich scenario metadata.
 *
 * `name` — the cinematic display title used in pre-fight banners.
 * `tag` — a short word-or-two label used in fighter "BEST IN" stat lines and chips.
 * `description` — one-line topical flavor for menu cards.
 * `longDescription` — paragraph used in the dedicated Stage Select screen.
 * `flavorQuote` — the operator wisdom this stage embodies.
 * `accent` — color theme for the stage card.
 * `icon` — single emoji shorthand for the card art.
 */
interface RichScenario extends Scenario {
  tag: string
  longDescription: string
  flavorQuote: string
  accent: string
  icon: string
}

export const SCENARIOS: Record<Scenario['id'], RichScenario> = {
  'pre-pmf': {
    id: 'pre-pmf',
    name: 'PRE-PMF GARAGE',
    tag: 'PRE-PMF',
    description: 'Early, scrappy, hunting product–market fit.',
    longDescription: 'Three founders, a whiteboard, takeout boxes. Nobody knows if this works yet. Every conversation is a customer interview. Bonus damage for builders who thrive in the fog before fit.',
    flavorQuote: 'Do things that don\'t scale.',
    accent: '#F77F00',
    icon: '🔧',
    stage: 'stage-garage',
  },
  hypergrowth: {
    id: 'hypergrowth',
    name: 'HYPERGROWTH OFFICE',
    tag: 'HYPERGROWTH',
    description: 'Scaling fast, breaking things, hiring weekly.',
    longDescription: 'Headcount doubles every six months. The chart on the wall is exponential. Every system designed for ten people now serves a thousand. Glass-cannon fighters dominate here — risk-tolerant operators turn chaos into compound interest.',
    flavorQuote: 'The plane is being built mid-flight.',
    accent: '#06D6A0',
    icon: '📈',
    stage: 'stage-office',
  },
  plateau: {
    id: 'plateau',
    name: 'THE PLATEAU',
    tag: 'PLATEAU',
    description: 'Growth slowing. Need a new vector or a rethink.',
    longDescription: 'The dashboard hasn\'t moved in 90 days. Strategy-locked fighters and patient operators win here — finding the next S-curve takes the kind of clarity that flailing teams can\'t access.',
    flavorQuote: 'When growth slows, strategy gets honest.',
    accent: '#7209B7',
    icon: '🧗',
    stage: 'stage-plateau',
  },
  'ai-native': {
    id: 'ai-native',
    name: 'THE DATACENTER',
    tag: 'AI-NATIVE',
    description: 'AI-native pivot. Speed of light or speed of dead.',
    longDescription: 'GPU racks hum. The model that was state-of-the-art six weeks ago is already legacy. AI-native operators move at the cadence of model releases, not quarterly planning — and the rest get left behind.',
    flavorQuote: "We've passed the inflection point.",
    accent: '#00B4D8',
    icon: '⚡',
    stage: 'stage-datacenter',
  },
  monetization: {
    id: 'monetization',
    name: 'THE CAP TABLE',
    tag: 'PRICING',
    description: 'Pricing, contracts, and the leverage that turns ideas to money.',
    longDescription: 'Term sheets, redlined contracts, willingness-to-pay studies. Pricing fighters dominate this stage — every conversation is leverage, and the fighter who frames the deal wins it.',
    flavorQuote: 'Price is a strategy, not a tactic.',
    accent: '#F72585',
    icon: '💰',
    stage: 'stage-captable',
  },
  crisis: {
    id: 'crisis',
    name: 'THE LAYOFF',
    tag: 'CRISIS',
    description: 'Cash is short. People are scared. Decisions are heavy.',
    longDescription: 'Packed boxes, all-hands video, severance docs. Crisis stages punish indecision and reward fighters with founder-mode conviction — the operators who can call hard moves quickly and humanely.',
    flavorQuote: 'In crisis, the founder becomes the company.',
    accent: '#EF233C',
    icon: '🔥',
    stage: 'stage-boardroom',
  },
  'ipo-prep': {
    id: 'ipo-prep',
    name: 'THE CONFERENCE STAGE',
    tag: 'IPO',
    description: "Pitch perfect. Investors watching. Don't blink.",
    longDescription: 'TED-talk lighting, banker faces in row one, S-1 ready. Polymath fighters and seasoned operators dominate here — the people who can hold the long story while answering the precise question.',
    flavorQuote: 'You only IPO once. Get it right.',
    accent: '#FFD60A',
    icon: '🎤',
    stage: 'stage-conference',
  },
  distribution: {
    id: 'distribution',
    name: 'THE HOLLYWOOD SIGN',
    tag: 'DISTRO',
    description: 'Distribution is destiny. Where attention goes, value flows.',
    longDescription: 'Hills lit gold. The product is already great — the question is whether anyone hears about it. Distribution-first fighters demolish here; the ones who treat marketing as an afterthought get drowned.',
    flavorQuote: 'Distribution is the product.',
    accent: '#FCBF49',
    icon: '🎬',
    stage: 'stage-hollywood',
  },
}

/** Ordered list for stage-select grid + arcade fallback iteration */
export const SCENARIO_ORDER: ScenarioId[] = [
  'pre-pmf',
  'hypergrowth',
  'plateau',
  'ai-native',
  'monetization',
  'crisis',
  'ipo-prep',
  'distribution',
]

export const ARCADE_PROGRESSION: Array<{ scenario: Scenario['id']; opponentId: string }> = [
  { scenario: 'pre-pmf', opponentId: 'chesky' },
  { scenario: 'hypergrowth', opponentId: 'turley' },
  { scenario: 'plateau', opponentId: 'doshi' },
  { scenario: 'ai-native', opponentId: 'catwu' },
  { scenario: 'monetization', opponentId: 'madhavan' },
  { scenario: 'distribution', opponentId: 'spiegel' },
  { scenario: 'crisis', opponentId: 'cagan' },
  { scenario: 'ipo-prep', opponentId: 'lenny' }, // final boss
]
