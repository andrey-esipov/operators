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
  const n = deck.cards.length
  const center = (n - 1) / 2
  return (
    <div className="fh-deck fh-pe">
      {deck.cards.map((card, i) => {
        const color = KIND_COLOR[card.kind]
        const isUlt = card.kind === 'ultimate'
        const offset = i - center
        const fan = card.selected ? 0 : offset * 3.6
        const arcY = card.selected ? -22 : Math.abs(offset) * 7
        return (
          <motion.button
            key={card.id}
            className={`fh-card ${card.disabled ? 'disabled' : ''} ${isUlt ? 'ult' : ''} ${
              isUlt && card.ready ? 'ready' : ''
            } ${card.selected ? 'selected' : ''}`}
            style={{ ['--ck' as string]: color, transformOrigin: 'bottom center' }}
            initial={{ opacity: 0, y: 46 }}
            animate={{ opacity: 1, y: arcY, rotate: fan, scale: card.selected ? 1.08 : 1 }}
            transition={{ delay: 0.05 * i, type: 'spring', stiffness: 320, damping: 26 }}
            whileHover={card.disabled ? undefined : { y: card.selected ? -30 : -16, rotate: 0, scale: card.selected ? 1.11 : 1.07 }}
            whileTap={card.disabled ? undefined : { scale: 0.96, y: -6 }}
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
