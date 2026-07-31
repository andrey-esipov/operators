import './BootCard.css'

interface Props {
  /**
   * What is loading, in a few words — rendered under the wordmark in the arcade
   * UI face. Kept short (it is uppercased and letter-spaced). Defaults to a
   * neutral "Loading".
   */
  label?: string
}

/**
 * Branded holding card for route/chunk load gaps.
 *
 * `visual-critic` measured the previous fallback — a bare `loading attract…`
 * dev div — as the literal first frame under load (mean luminance 13.0 on a
 * near-black field). This replaces it with a designed hold: the OPERATORS
 * wordmark, a scanning beam, and a status line. Pure DOM/CSS, so it paints on
 * the first frame with zero VRAM and never competes with the renderer it is
 * covering for.
 */
export function BootCard({ label = 'Loading' }: Props) {
  return (
    <div className="boot-card" role="status" aria-live="polite" aria-label={`${label}…`}>
      <div className="boot-card__brand">
        <span className="boot-card__mark">Operators</span>
        <span className="boot-card__beam" aria-hidden />
      </div>
      <div className="boot-card__status">
        <span className="boot-card__dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className="boot-card__label">{label}</span>
      </div>
    </div>
  )
}
