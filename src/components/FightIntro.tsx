import { useEffect, useState } from 'react'
import { Sfx } from '../lib/audio'

interface Props {
  round: 1 | 2 | 3
  /** Bumped externally to re-play (e.g. each round start) */
  triggerKey: string | number
}

/**
 * SF II–style ROUND N · FIGHT! intro overlay.
 *
 * Beat 0 (0-700ms):     "ROUND N" crashes down + holds
 * Beat 1 (700-1400ms):  Slides out left
 * Beat 2 (1400-2100ms): "FIGHT!" zooms in from off-screen w/ shockwave
 * Beat 3 (2100+):       Fades out
 */
export function FightIntro({ round, triggerKey }: Props) {
  const [beat, setBeat] = useState(0)
  const [show, setShow] = useState(true)

  useEffect(() => {
    setShow(true)
    setBeat(0)
    const t1 = setTimeout(() => setBeat(1), 700)
    const t2 = setTimeout(() => {
      setBeat(2)
      Sfx.fight()
    }, 1400)
    const t3 = setTimeout(() => setBeat(3), 2100)
    const t4 = setTimeout(() => setShow(false), 2500)
    return () => {
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4)
    }
  }, [triggerKey])

  if (!show) return null

  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center overflow-hidden">
      {/* ROUND banner */}
      {beat < 2 && (
        <div
          className="absolute"
          style={{
            animation: beat === 0 ? 'roundCrash 0.5s cubic-bezier(0.2, 0.9, 0.3, 1)' : 'roundSlideOut 0.6s ease-in forwards',
          }}
        >
          <div
            className="px-10 py-5"
            style={{
              background: 'linear-gradient(135deg, #7209B7 0%, #F72585 50%, #7209B7 100%)',
              border: '4px solid black',
              boxShadow: '10px 10px 0 rgba(0,0,0,0.75), 0 0 36px #F72585',
              transform: 'skewX(-10deg)',
            }}
          >
            <div style={{ transform: 'skewX(10deg)' }}>
              <div
                className="font-display text-center"
                style={{
                  color: 'white',
                  fontSize: 18,
                  letterSpacing: '0.45em',
                  textShadow: '2px 2px 0 black',
                  marginBottom: 4,
                }}
              >
                ROUND
              </div>
              <div
                className="font-display text-center"
                style={{
                  color: 'white',
                  fontSize: 92,
                  letterSpacing: '0.1em',
                  textShadow: '6px 6px 0 black, 0 0 24px black',
                  lineHeight: 1,
                }}
              >
                {round}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FIGHT! banner */}
      {beat >= 2 && (
        <>
          {/* Shockwave ring */}
          <div
            className="absolute"
            style={{
              width: 400, height: 400,
              border: '6px solid #FFD60A',
              borderRadius: '50%',
              animation: 'fightShockwave 0.7s ease-out forwards',
              boxShadow: '0 0 36px #FFD60A',
            }}
          />
          <div
            className="absolute"
            style={{
              animation: beat === 2
                ? 'fightCrash 0.45s cubic-bezier(0.1, 0.9, 0.2, 1.1)'
                : 'fightFadeOut 0.5s ease-out forwards',
            }}
          >
            <div
              className="font-display"
              style={{
                color: '#FFD60A',
                fontSize: 140,
                letterSpacing: '0.12em',
                textShadow: '8px 8px 0 black, 0 0 36px #F77F00, 0 0 64px #E63946',
                transform: 'skewX(-8deg)',
                fontWeight: 900,
              }}
            >
              FIGHT!
            </div>
          </div>
        </>
      )}

      <style>{`
        @keyframes roundCrash {
          0% { transform: translateY(-200px) scale(1.4) rotate(-8deg); opacity: 0 }
          60% { transform: translateY(0) scale(1.12) rotate(0deg); opacity: 1 }
          100% { transform: translateY(0) scale(1) rotate(0deg); opacity: 1 }
        }
        @keyframes roundSlideOut {
          0% { transform: translateX(0); opacity: 1 }
          100% { transform: translateX(-160%); opacity: 0 }
        }
        @keyframes fightCrash {
          0% { transform: scale(3.5) skewX(-8deg); opacity: 0 }
          60% { transform: scale(0.92) skewX(-8deg); opacity: 1 }
          100% { transform: scale(1) skewX(-8deg); opacity: 1 }
        }
        @keyframes fightFadeOut {
          0% { transform: scale(1) skewX(-8deg); opacity: 1 }
          100% { transform: scale(1.2) skewX(-8deg); opacity: 0 }
        }
        @keyframes fightShockwave {
          0% { transform: scale(0.2); opacity: 1 }
          100% { transform: scale(3); opacity: 0 }
        }
      `}</style>
    </div>
  )
}
