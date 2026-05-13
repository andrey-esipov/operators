import type { Scenario } from '../types'

export const SCENARIOS: Record<Scenario['id'], Scenario> = {
  'pre-pmf': {
    id: 'pre-pmf',
    name: 'PRE-PMF GARAGE',
    description: 'Early, scrappy, hunting product–market fit.',
    stage: 'stage-garage',
  },
  hypergrowth: {
    id: 'hypergrowth',
    name: 'HYPERGROWTH OFFICE',
    description: 'Scaling fast, breaking things, hiring weekly.',
    stage: 'stage-office',
  },
  plateau: {
    id: 'plateau',
    name: 'THE PLATEAU',
    description: 'Growth slowing. Need a new vector or a rethink.',
    stage: 'stage-plateau',
  },
  'ai-native': {
    id: 'ai-native',
    name: 'THE DATACENTER',
    description: 'AI-native pivot. Speed of light or speed of dead.',
    stage: 'stage-datacenter',
  },
  monetization: {
    id: 'monetization',
    name: 'THE CAP TABLE',
    description: 'Pricing, contracts, and the leverage that turns ideas to money.',
    stage: 'stage-captable',
  },
  crisis: {
    id: 'crisis',
    name: 'THE LAYOFF',
    description: 'Cash is short. People are scared. Decisions are heavy.',
    stage: 'stage-boardroom',
  },
  'ipo-prep': {
    id: 'ipo-prep',
    name: 'THE CONFERENCE STAGE',
    description: 'Pitch perfect. Investors watching. Don\'t blink.',
    stage: 'stage-conference',
  },
  distribution: {
    id: 'distribution',
    name: 'THE HOLLYWOOD SIGN',
    description: 'Distribution is destiny. Where attention goes, value flows.',
    stage: 'stage-hollywood',
  },
}

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
