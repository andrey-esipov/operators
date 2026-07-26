import { motion } from 'framer-motion'
import type { MoveCardData, MoveDeck as MoveDeckData } from './types'

const KIND_COLOR: Record<MoveCardData['kind'], string> = {
  light: '#8affff',
  heavy: '#ff6a4d',
  setup: '#35f0b0',
  combo: '#ffd23c',
  ultimate: '#ff2fae',
}
const KIND_LABEL: Record<MoveCardData['kind'], string> = {
  light: 'LIGHT',
  heavy: 'HEAVY',
  setup: 'SETUP',
  combo: 'COMBO',
  ultimate: 'ULTIMATE',
}

interface Props {
  deck: MoveDeckData | null
}

export function MoveDeck({ deck }: Props) {
  if (!deck) return null
  return (
    <div className="fh-deck fh-pe">
      {deck.cards.map((card, i) => {
        const color = KIND_COLOR[card.kind]
        const isUlt = card.kind === 'ultimate'
        return (
          <motion.button
            key={card.id}
            className={`fh-card ${card.disabled ? 'disabled' : ''} ${isUlt ? 'ult' : ''} ${
              isUlt && card.ready ? 'ready' : ''
            }`}
            style={{ ['--ck' as string]: color }}
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * i, type: 'spring', stiffness: 320, damping: 26 }}
            whileTap={card.disabled ? undefined : { scale: 0.95, y: -4 }}
            onClick={() => !card.disabled && card.onSelect?.()}
            disabled={card.disabled}
          >
            <div className="stripe" />
            <div className="kind">{KIND_LABEL[card.kind]}</div>
            <div className="title">{card.name}</div>
            <div className="spacer" />
            <div className="stat-row">
              <div>
                <div className="dmg-big">{card.damage}</div>
                <div className="dmg-lbl">DAMAGE</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="cost">
                  {Array.from({ length: Math.max(card.cost, 1) }, (_, k) => (
                    <span key={k} className={`pip ${k < card.cost ? 'on' : ''}`} />
                  ))}
                </div>
                <div className="dmg-lbl" style={{ marginTop: 4 }}>
                  {isUlt ? (card.ready ? 'READY' : 'SUPER') : 'COST'}
                </div>
              </div>
            </div>
            {card.hotkey && (
              <div className="hotkey">
                <span>{card.hotkey}</span>
              </div>
            )}
          </motion.button>
        )
      })}
    </div>
  )
}
