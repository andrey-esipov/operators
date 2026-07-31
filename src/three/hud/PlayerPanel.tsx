import { motion } from 'framer-motion'
import type { FighterVisualState } from '../types'
import type { StatusMeta } from './statusMeta'
import { HealthBar } from './HealthBar'
import { SuperMeter } from './SuperMeter'
import { StatusChips } from './StatusChips'

interface Props {
  fighter: FighterVisualState
  name: string
  portrait?: string
  mirror?: boolean
  statusInfo?: (key: string) => StatusMeta
}

export function PlayerPanel({ fighter, name, portrait, mirror = false, statusInfo }: Props) {
  const { accent, hp01, super01, superReady, statuses } = fighter

  return (
    <motion.div
      className={`fh-side ${mirror ? 'mirror' : ''}`}
      style={{ ['--acc' as string]: accent }}
      initial={{ opacity: 0, x: mirror ? 60 : -60 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: 'spring', stiffness: 220, damping: 26, delay: mirror ? 0.05 : 0 }}
    >
      <div className="fh-idrow">
        <div className="fh-portrait">
          {portrait ? (
            <img src={portrait} alt="" draggable={false} />
          ) : (
            <span className="letter">{name.charAt(0)}</span>
          )}
        </div>
        <div className="fh-nametab">
          <span className="n">{name}</span>
          <span className="tag">{mirror ? 'P2' : 'P1'}</span>
        </div>
      </div>

      <HealthBar hp01={hp01} mirror={mirror} accent={accent} />
      <SuperMeter super01={super01} ready={superReady} />
      <StatusChips statuses={statuses} mirror={mirror} info={statusInfo} />
    </motion.div>
  )
}
