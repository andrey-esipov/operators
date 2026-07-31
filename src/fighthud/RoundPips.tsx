interface Props {
  /** Rounds won per fighter. */
  wins: [number, number]
}

// Best-of-three: first to two rounds. Two pips per side.
const NEED = 2

/** Two diamond pips per fighter — best-of-three win indicators. */
export function RoundPips({ wins }: Props) {
  return (
    <div className="fhud-pips" data-testid="fhud-pips">
      <div className="fhud-pipset a" data-testid="fhud-pips-a">
        {Array.from({ length: NEED }).map((_, i) => (
          <div key={i} className={`fhud-pip ${i < wins[0] ? 'won' : ''}`} />
        ))}
      </div>
      <div className="fhud-pipset b" data-testid="fhud-pips-b">
        {Array.from({ length: NEED }).map((_, i) => (
          <div key={i} className={`fhud-pip ${i < wins[1] ? 'won' : ''}`} />
        ))}
      </div>
    </div>
  )
}
