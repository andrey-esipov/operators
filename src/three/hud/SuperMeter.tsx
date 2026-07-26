interface Props {
  super01: number
  ready: boolean
  segments?: number
}

/** One continuous energy gauge with overlaid notch dividers. Mirroring is
 *  handled by the parent `.fh-side.mirror` container in CSS. */
export function SuperMeter({ super01, ready, segments = 4 }: Props) {
  const v = Math.max(0, Math.min(1, super01))
  const fillScale = ready ? 1 : v
  const notches = Array.from({ length: segments - 1 }, (_, i) => ((i + 1) / segments) * 100)

  return (
    <div className="fh-sm-wrap">
      <div className={`fh-sm-tag ${ready ? 'ready' : ''}`}>{ready ? 'MAX' : 'SUPER'}</div>
      <div className={`fh-sm ${ready ? 'ready' : ''}`}>
        <div className="sm-fill" style={{ transform: `scaleX(${fillScale})` }} />
        {notches.map((left, i) => (
          <div key={i} className="sm-notch" style={{ left: `${left}%` }} />
        ))}
      </div>
    </div>
  )
}
