import type { ScenarioId } from '../types'

/**
 * Hand-curated dream matchups for "Marquee Matchups" mode.
 *
 * Each entry pre-picks both fighters + the optimal scenario + framing.
 * Designed so a casual viewer (or buildathon judge) who doesn't know
 * every guest can still get hyped by the title alone.
 *
 * Pulled from the full 40-character pool (current roster + Wave 3).
 */

export interface Matchup {
  id: string
  title: string
  fighterA: string
  fighterB: string
  scenarioId: ScenarioId
  flavor: string
  accent: string  // hex
}

export const MARQUEE_MATCHUPS: Matchup[] = [
  {
    id: 'a16z-partnership',
    title: 'THE a16z PARTNERSHIP',
    fighterA: 'andreessen',
    fighterB: 'horowitz',
    scenarioId: 'ipo-prep',
    flavor: 'The two halves of tech\'s most consequential VC firm finally disagree out loud.',
    accent: '#5A2EE0',
  },
  {
    id: 'pricing-war',
    title: 'THE PRICING WAR',
    fighterA: 'madhavan',
    fighterB: 'benioff',
    scenarioId: 'monetization',
    flavor: 'Outcome pricing vs. enterprise contracts. Which framing wins the cap table?',
    accent: '#F72585',
  },
  {
    id: 'inbound-civil-war',
    title: 'INBOUND vs. PERMISSION',
    fighterA: 'dharmesh',
    fighterB: 'seth',
    scenarioId: 'distribution',
    flavor: 'The HubSpot CTO faces the marketer who taught a generation to be remarkable.',
    accent: '#FF7A59',
  },
  {
    id: 'ai-godmother',
    title: 'THE AI GODMOTHER',
    fighterA: 'feifei',
    fighterB: 'krieger',
    scenarioId: 'ai-native',
    flavor: 'Stanford\'s research mountain vs. Anthropic\'s shipping discipline. Spatial vs. Language.',
    accent: '#4A148C',
  },
  {
    id: 'design-duel',
    title: 'THE DESIGN DUEL',
    fighterA: 'dylan',
    fighterB: 'melanie',
    scenarioId: 'pre-pmf',
    flavor: 'Multiplayer canvas vs. democratized design. Whose taste scales?',
    accent: '#00C4CC',
  },
  {
    id: 'pattern-breakers',
    title: 'PATTERN BREAKERS',
    fighterA: 'maples',
    fighterB: 'lenny',
    scenarioId: 'distribution',
    flavor: 'The author of Pattern Breakers faces the pattern-matching final boss.',
    accent: '#8B4513',
  },
  {
    id: 'build-measure-learn',
    title: 'BUILD MEASURE LEARN',
    fighterA: 'ries',
    fighterB: 'cagan',
    scenarioId: 'plateau',
    flavor: 'Lean Startup vs. Continuous Discovery. Which compounds when growth stalls?',
    accent: '#2C5F2D',
  },
  {
    id: 'growth-legend',
    title: 'GROWTH LEGENDS',
    fighterA: 'elena',
    fighterB: 'spiegel',
    scenarioId: 'distribution',
    flavor: 'PLG flywheel vs. distribution moat. Self-serve vs. tank.',
    accent: '#E91E63',
  },
  {
    id: 'startup-school',
    title: 'STARTUP SCHOOL',
    fighterA: 'jessica',
    fighterB: 'chesky',
    scenarioId: 'pre-pmf',
    flavor: 'The YC co-founder vs. her most famous batch alum. The teacher tests the student.',
    accent: '#F26625',
  },
  {
    id: 'polymath-proving',
    title: 'POLYMATH PROVING GROUND',
    fighterA: 'taylor',
    fighterB: 'aparna',
    scenarioId: 'hypergrowth',
    flavor: 'Two career-pivot legends. Sierra vs. Microsoft. Which polymath compounds harder?',
    accent: '#0078D4',
  },
  {
    id: 'enterprise-merchant',
    title: 'ENTERPRISE vs. MERCHANT',
    fighterA: 'benioff',
    fighterB: 'tobi',
    scenarioId: 'monetization',
    flavor: 'Salesforce vs. Shopify. Top-down platform vs. bottom-up rebellion.',
    accent: '#00A1E0',
  },
  {
    id: 'pmf-philosophers',
    title: 'PMF PHILOSOPHERS',
    fighterA: 'rahul',
    fighterB: 'ries',
    scenarioId: 'pre-pmf',
    flavor: 'The 40% test vs. Build-Measure-Learn. Two operators argue about what PMF really means.',
    accent: '#7D33FF',
  },
  {
    id: 'agent-era',
    title: 'AGENT ERA SHOWDOWN',
    fighterA: 'boris',
    fighterB: 'amjad',
    scenarioId: 'ai-native',
    flavor: 'Anthropic\'s Claude Code engineer vs. Replit\'s founder. Two visions of agent-built software.',
    accent: '#D77A5F',
  },
  {
    id: 'wartime-doctrine',
    title: 'WARTIME DOCTRINE',
    fighterA: 'horowitz',
    fighterB: 'jason',
    scenarioId: 'crisis',
    flavor: 'Wartime CEO playbook vs. the calm-company contrarian. Two ways to survive.',
    accent: '#1F1F1F',
  },
  {
    id: 'design-vp-dialectic',
    title: 'THE DESIGN VP DIALECTIC',
    fighterA: 'julie',
    fighterB: 'aparna',
    scenarioId: 'hypergrowth',
    flavor: 'Two former design VPs, both turned company-builders. The making of the maker.',
    accent: '#B53389',
  },
  {
    id: 'odds-arbiters',
    title: 'ODDS ARBITERS',
    fighterA: 'annie',
    fighterB: 'tavel',
    scenarioId: 'ipo-prep',
    flavor: 'The poker champion vs. the Benchmark partner. Both bet against the room and win.',
    accent: '#C70039',
  },
  {
    id: 'boss-fight',
    title: 'THE FINAL BOSS',
    fighterA: 'chesky',
    fighterB: 'lenny',
    scenarioId: 'ipo-prep',
    flavor: 'Founder Mode meets the Pattern-Matcher. The signature Arcade-Mode endgame.',
    accent: '#FFD60A',
  },
]
