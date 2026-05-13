import type { ScenarioId } from '../types'

interface Props {
  scenario: ScenarioId
}

/**
 * Per-stage ambient motion. Designed to be VISIBLY alive — every stage gets
 * multiple animated layers operating at different rates so the eye always
 * has something moving. All pure CSS + inline keyframes, zero runtime cost.
 *
 *   pre-pmf       → big flickering bulb · drifting steam plumes · whiteboard
 *                   scribbles scrolling · takeout containers vibrating
 *   hypergrowth   → monitor wall pulsing · charts climbing · people silhouettes
 *                   walking past · scroll wheel of "+1 user" notifications
 *   plateau       → dense falling leaves · drifting fog · wind gusts
 *   ai-native     → 60 GPU indicator lights · fast scan beam · data-stream
 *                   particles · pulsing neon stripes
 *   monetization  → floating $ · floating contracts · calculator blink ·
 *                   coin shower
 *   crisis        → many embers · billowing smoke · lightning flashes ·
 *                   shadow figures
 *   ipo-prep      → audience clapping · constant camera flashes · spotlight
 *                   sweep · standing ovation wave
 *   distribution  → twinkling stars · 3 spotlight beams · big Hollywood
 *                   marquee · drifting clouds at sunset
 */
export function StageAmbient({ scenario }: Props) {
  switch (scenario) {
    case 'pre-pmf':       return <PrePMF />
    case 'hypergrowth':   return <Hypergrowth />
    case 'plateau':       return <Plateau />
    case 'ai-native':     return <AINative />
    case 'monetization':  return <Monetization />
    case 'crisis':        return <Crisis />
    case 'ipo-prep':      return <IPOPrep />
    case 'distribution':  return <Distribution />
    default: return null
  }
}

// ═══════════════════════════════════════════════════════════════════
// PRE-PMF — scrappy garage
// ═══════════════════════════════════════════════════════════════════
function PrePMF() {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* Big swinging desk bulb with dramatic flicker */}
      <div
        className="absolute"
        style={{
          left: '12%',
          top: '14%',
          width: 220,
          height: 220,
          background: 'radial-gradient(circle, rgba(252,191,73,0.75) 0%, rgba(247,127,0,0.35) 25%, transparent 65%)',
          animation: 'bulbFlicker 2.6s steps(12) infinite, bulbSwing 5s ease-in-out infinite',
          transformOrigin: 'top center',
          mixBlendMode: 'screen',
        }}
      />
      <div
        className="absolute"
        style={{
          left: '14%',
          top: '6%',
          width: 4,
          height: 80,
          background: '#333',
          animation: 'bulbSwing 5s ease-in-out infinite',
          transformOrigin: 'top center',
        }}
      />

      {/* Multiple steam plumes */}
      {[
        { l: '78%', t: '32%', delay: '0s', dur: '4.5s' },
        { l: '82%', t: '30%', delay: '1.8s', dur: '5.2s' },
        { l: '76%', t: '34%', delay: '3.1s', dur: '4.8s' },
      ].map((s, i) => (
        <div
          key={i}
          className="absolute"
          style={{
            left: s.l,
            top: s.t,
            width: 14,
            height: 90,
            background: 'linear-gradient(180deg, rgba(255,255,255,0.55), transparent)',
            animation: `steamRise ${s.dur} linear ${s.delay} infinite`,
            filter: 'blur(3px)',
            mixBlendMode: 'screen',
          }}
        />
      ))}

      {/* Random pixel sparks (debugging "bugs" floating around) */}
      {Array.from({ length: 12 }).map((_, i) => (
        <div
          key={`spark-${i}`}
          className="absolute"
          style={{
            left: `${10 + (i * 11) % 80}%`,
            top: `${30 + (i * 13) % 40}%`,
            width: 2,
            height: 2,
            background: '#FCBF49',
            opacity: 0.7,
            boxShadow: '0 0 4px #FCBF49',
            animation: `spark ${2 + (i % 4)}s ease-in-out ${(i * 0.3) % 3}s infinite`,
          }}
        />
      ))}

      <style>{sharedKeyframes + `
        @keyframes bulbFlicker { 0%,40%,60%,100% { opacity: 0.95 } 50%,55% { opacity: 0.25 } 70%,73% { opacity: 0.5 } 80% { opacity: 1 } }
        @keyframes bulbSwing { 0%,100% { transform: rotate(-4deg) } 50% { transform: rotate(4deg) } }
        @keyframes steamRise { 0% { transform: translateY(40px) scaleX(1); opacity: 0.6 } 100% { transform: translateY(-200px) scaleX(2.2); opacity: 0 } }
        @keyframes spark { 0%,100% { opacity: 0.2 } 50% { opacity: 1 } }
      `}</style>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// HYPERGROWTH — wall of monitors + scrolling notifications
// ═══════════════════════════════════════════════════════════════════
function Hypergrowth() {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* Monitor wall — 16 screens with bright pulsing */}
      <div className="absolute inset-0">
        {Array.from({ length: 16 }).map((_, i) => (
          <div
            key={i}
            className="absolute"
            style={{
              left: `${4 + (i % 8) * 12}%`,
              top: `${16 + Math.floor(i / 8) * 12}%`,
              width: 70,
              height: 44,
              background: i % 3 === 0 ? '#06D6A0' : i % 3 === 1 ? '#00B4D8' : '#FFD60A',
              opacity: 0.35,
              boxShadow: 'inset 0 0 0 2px rgba(0,0,0,0.6), 0 0 12px currentColor',
              animation: `monitor${i % 4} ${1.0 + (i % 5) * 0.3}s linear infinite`,
              color: i % 3 === 0 ? '#06D6A0' : i % 3 === 1 ? '#00B4D8' : '#FFD60A',
            }}
          >
            {/* Climbing chart line inside monitor */}
            <div
              className="absolute left-0 bottom-0 h-full"
              style={{
                width: '100%',
                background: `linear-gradient(135deg, transparent 50%, currentColor 50.5%, transparent 52%)`,
                opacity: 0.6,
                animation: 'chartClimb 3s linear infinite',
              }}
            />
          </div>
        ))}
      </div>

      {/* Scrolling "+1 user" notification ticker */}
      <div className="absolute" style={{ top: '6%', left: 0, right: 0, overflow: 'hidden', height: 22 }}>
        <div
          className="font-display"
          style={{
            color: '#06D6A0',
            fontSize: 11,
            letterSpacing: '4px',
            whiteSpace: 'nowrap',
            animation: 'scrollLeft 20s linear infinite',
            textShadow: '0 0 4px #06D6A0',
          }}
        >
          {'  +247 SIGNUPS  ·  ARR $4.2M ↑  ·  DAU +18%  ·  CHURN ↓ 0.8%  ·  +91 SIGNUPS  ·  SHIPS/WEEK: 47  ·  '.repeat(5)}
        </div>
      </div>

      {/* People silhouettes walking past at floor level */}
      {[0, 1, 2].map((i) => (
        <div
          key={`person-${i}`}
          className="absolute"
          style={{
            bottom: '24%',
            left: '-10%',
            width: 16,
            height: 36,
            background: '#000',
            opacity: 0.55,
            borderRadius: '40% 40% 0 0 / 30% 30% 0 0',
            animation: `personWalk ${12 + i * 3}s linear ${i * 4}s infinite`,
          }}
        />
      ))}

      <style>{sharedKeyframes + `
        @keyframes monitor0 { 0% { opacity: 0.1 } 50% { opacity: 0.4 } 100% { opacity: 0.1 } }
        @keyframes monitor1 { 0% { opacity: 0.35 } 30% { opacity: 0.6 } 100% { opacity: 0.35 } }
        @keyframes monitor2 { 0%,80% { opacity: 0.15 } 90% { opacity: 0.7 } 100% { opacity: 0.15 } }
        @keyframes monitor3 { 0% { opacity: 0.5 } 50% { opacity: 0.2 } 100% { opacity: 0.5 } }
        @keyframes chartClimb { 0% { transform: translateX(-100%) } 100% { transform: translateX(0) } }
        @keyframes personWalk { 0% { left: -10% } 100% { left: 110% } }
      `}</style>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// PLATEAU — falling leaves + drifting fog
// ═══════════════════════════════════════════════════════════════════
function Plateau() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {/* Drifting fog layer */}
      <div
        className="absolute"
        style={{
          left: '-20%',
          top: '40%',
          width: '140%',
          height: 80,
          background: 'radial-gradient(ellipse, rgba(180,160,200,0.35) 0%, transparent 70%)',
          animation: 'fogDrift 28s linear infinite',
          filter: 'blur(8px)',
          mixBlendMode: 'screen',
        }}
      />

      {/* Heavy leaf fall — 30 leaves with variety */}
      {Array.from({ length: 30 }).map((_, i) => {
        const colors = ['#F72585', '#7209B7', '#FCBF49', '#E63946', '#F77F00']
        const size = 6 + (i % 4) * 2
        return (
          <div
            key={i}
            className="absolute"
            style={{
              left: `${(i * 11) % 100}%`,
              top: -20,
              width: size,
              height: size,
              background: colors[i % colors.length],
              opacity: 0.85,
              borderRadius: '40% 60% 40% 60%',
              animation: `leafFall ${7 + (i % 5)}s linear ${(i * 0.4) % 7}s infinite`,
              boxShadow: '0 0 4px rgba(0,0,0,0.4)',
            }}
          />
        )
      })}

      {/* Wind gust horizontal streak */}
      <div
        className="absolute"
        style={{
          top: '50%',
          left: 0,
          right: 0,
          height: 2,
          background: 'linear-gradient(90deg, transparent, rgba(200,180,220,0.4), transparent)',
          animation: 'windGust 7s ease-in-out infinite',
          mixBlendMode: 'screen',
        }}
      />

      <style>{sharedKeyframes + `
        @keyframes leafFall {
          0% { top: -20px; transform: translateX(0) rotate(0deg); opacity: 0 }
          5% { opacity: 0.85 }
          50% { transform: translateX(40px) rotate(180deg) }
          100% { top: 110%; transform: translateX(-30px) rotate(720deg); opacity: 0 }
        }
        @keyframes fogDrift { 0% { transform: translateX(-30%) } 100% { transform: translateX(30%) } }
        @keyframes windGust { 0%,80%,100% { opacity: 0; transform: scaleX(0) } 90% { opacity: 1; transform: scaleX(1) } }
      `}</style>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// AI-NATIVE — datacenter on fire
// ═══════════════════════════════════════════════════════════════════
function AINative() {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* 60 GPU rack lights — 5 rows */}
      {Array.from({ length: 60 }).map((_, i) => {
        const row = Math.floor(i / 12)
        const col = i % 12
        const color = i % 7 === 0 ? '#06D6A0' : i % 7 === 1 ? '#F72585' : '#00B4D8'
        return (
          <div
            key={i}
            className="absolute"
            style={{
              left: `${3 + col * 8}%`,
              top: `${18 + row * 6}%`,
              width: 5,
              height: 5,
              background: color,
              borderRadius: '50%',
              opacity: 0.95,
              boxShadow: `0 0 8px ${color}`,
              animation: `gpuBlink${i % 5} ${0.3 + (i % 7) * 0.15}s linear infinite`,
            }}
          />
        )
      })}

      {/* Vertical neon stripes pulsing on the rack */}
      {[20, 35, 50, 65, 80].map((left, i) => (
        <div
          key={`stripe-${i}`}
          className="absolute"
          style={{
            left: `${left}%`,
            top: '15%',
            width: 3,
            height: '40%',
            background: 'linear-gradient(180deg, transparent, #00B4D8, transparent)',
            opacity: 0.8,
            boxShadow: '0 0 8px #00B4D8',
            animation: `neonPulse ${1.4 + i * 0.2}s ease-in-out infinite`,
          }}
        />
      ))}

      {/* Fast horizontal scan beam */}
      <div
        className="absolute left-0 right-0"
        style={{
          top: '30%',
          height: 2,
          background: '#06D6A0',
          opacity: 0.7,
          boxShadow: '0 0 16px #06D6A0',
          animation: 'scanLine 3.2s linear infinite',
        }}
      />

      {/* Vertical data-stream particles */}
      {Array.from({ length: 24 }).map((_, i) => (
        <div
          key={`stream-${i}`}
          className="absolute"
          style={{
            left: `${(i * 4.3) % 100}%`,
            top: '15%',
            width: 1,
            height: 12,
            background: '#06D6A0',
            opacity: 0.7,
            animation: `dataStream ${1 + (i % 4) * 0.5}s linear ${(i * 0.12) % 2}s infinite`,
          }}
        />
      ))}

      <style>{sharedKeyframes + `
        @keyframes gpuBlink0 { 0%,100% { opacity: 0.95 } 50% { opacity: 0.15 } }
        @keyframes gpuBlink1 { 0% { opacity: 0.3 } 100% { opacity: 0.95 } }
        @keyframes gpuBlink2 { 0%,40% { opacity: 0.95 } 50%,100% { opacity: 0.1 } }
        @keyframes gpuBlink3 { 0%,100% { opacity: 0.5 } 30% { opacity: 1 } 70% { opacity: 0.1 } }
        @keyframes gpuBlink4 { 0%,100% { opacity: 0.95 } 25%,75% { opacity: 0.6 } 50% { opacity: 1 } }
        @keyframes scanLine { 0% { top: 16% } 100% { top: 52% } }
        @keyframes neonPulse { 0%,100% { opacity: 0.3 } 50% { opacity: 0.95 } }
        @keyframes dataStream { 0% { transform: translateY(0); opacity: 0 } 10% { opacity: 0.8 } 100% { transform: translateY(220px); opacity: 0 } }
      `}</style>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// MONETIZATION — money rain + contracts + coin shower
// ═══════════════════════════════════════════════════════════════════
function Monetization() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {/* Floating $ characters */}
      {Array.from({ length: 22 }).map((_, i) => (
        <div
          key={i}
          className="absolute font-display"
          style={{
            left: `${(i * 13 + 5) % 95}%`,
            bottom: -20,
            color: i % 3 === 0 ? '#FFD60A' : '#FCBF49',
            fontSize: 14 + (i % 3) * 4,
            opacity: 0.85,
            textShadow: '0 0 8px #F77F00',
            animation: `dollarRise ${6 + (i % 4)}s linear ${(i * 0.45) % 6}s infinite`,
          }}
        >
          $
        </div>
      ))}

      {/* Falling contract / spreadsheet rectangles */}
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={`contract-${i}`}
          className="absolute"
          style={{
            left: `${(i * 16 + 8) % 90}%`,
            top: -40,
            width: 28,
            height: 36,
            background: 'rgba(255,255,255,0.85)',
            opacity: 0.7,
            boxShadow: '0 0 4px rgba(0,0,0,0.4)',
            animation: `contractFall ${9 + (i % 4)}s linear ${(i * 0.8) % 5}s infinite`,
          }}
        >
          {/* Horizontal text lines */}
          <div style={{ marginTop: 4, height: 2, background: '#333', marginLeft: 3, marginRight: 8 }} />
          <div style={{ marginTop: 3, height: 1, background: '#666', marginLeft: 3, marginRight: 6 }} />
          <div style={{ marginTop: 3, height: 1, background: '#666', marginLeft: 3, marginRight: 12 }} />
          <div style={{ marginTop: 3, height: 1, background: '#666', marginLeft: 3, marginRight: 8 }} />
        </div>
      ))}

      {/* Pulsing big "ARR" indicator at top */}
      <div
        className="absolute top-3 right-6 font-display"
        style={{
          color: '#06D6A0',
          fontSize: 12,
          letterSpacing: '3px',
          textShadow: '0 0 6px #06D6A0',
          animation: 'arrPulse 1.4s ease-in-out infinite',
          opacity: 0.7,
        }}
      >
        ARR $42M
      </div>

      <style>{sharedKeyframes + `
        @keyframes dollarRise {
          0% { bottom: -20px; opacity: 0; transform: translateX(0) rotate(0deg) }
          10% { opacity: 0.9 }
          50% { transform: translateX(20px) rotate(15deg) }
          100% { bottom: 110%; opacity: 0; transform: translateX(-15px) rotate(-15deg) }
        }
        @keyframes contractFall {
          0% { top: -40px; transform: rotate(0deg); opacity: 0 }
          10% { opacity: 0.7 }
          100% { top: 110%; transform: rotate(30deg); opacity: 0 }
        }
        @keyframes arrPulse { 0%,100% { transform: scale(1) } 50% { transform: scale(1.12); text-shadow: 0 0 18px #06D6A0 } }
      `}</style>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// CRISIS — fire, smoke, lightning
// ═══════════════════════════════════════════════════════════════════
function Crisis() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {/* Many embers rising */}
      {Array.from({ length: 40 }).map((_, i) => (
        <div
          key={i}
          className="absolute"
          style={{
            left: `${(i * 7 + 3) % 100}%`,
            bottom: -10,
            width: 3 + (i % 3),
            height: 3 + (i % 3),
            background: i % 4 === 0 ? '#FFD60A' : i % 4 === 1 ? '#F77F00' : '#EF233C',
            opacity: 0.9,
            boxShadow: `0 0 8px ${i % 4 === 0 ? '#FFD60A' : '#EF233C'}`,
            animation: `emberRise ${2.5 + (i % 5) * 0.5}s ease-out ${(i * 0.2) % 5}s infinite`,
          }}
        />
      ))}

      {/* Billowing smoke from bottom */}
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={`smoke-${i}`}
          className="absolute"
          style={{
            left: `${15 + i * 22}%`,
            bottom: -60,
            width: 80,
            height: 80,
            background: 'radial-gradient(circle, rgba(60,30,30,0.65) 0%, transparent 70%)',
            animation: `smokeBillow ${8 + i * 1.5}s ease-out ${i * 1.4}s infinite`,
            filter: 'blur(8px)',
          }}
        />
      ))}

      {/* Lightning flashes — top-down white flash */}
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(180deg, rgba(255,255,255,0.7) 0%, transparent 60%)',
          opacity: 0,
          animation: 'lightning 7s linear infinite',
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(180deg, rgba(255,255,255,0.5) 0%, transparent 50%)',
          opacity: 0,
          animation: 'lightning 11s linear 3s infinite',
        }}
      />

      {/* Shadow figure silhouettes moving slowly */}
      {[0, 1].map((i) => (
        <div
          key={`figure-${i}`}
          className="absolute"
          style={{
            bottom: '22%',
            left: i === 0 ? '-12%' : '110%',
            width: 18,
            height: 42,
            background: '#000',
            opacity: 0.6,
            borderRadius: '50% 50% 0 0',
            animation: `crisisWalk-${i} ${20 + i * 4}s linear infinite`,
          }}
        />
      ))}

      <style>{sharedKeyframes + `
        @keyframes emberRise {
          0% { bottom: -10px; opacity: 0; transform: translateX(0) scale(1) }
          10% { opacity: 0.95 }
          100% { bottom: 80%; opacity: 0; transform: translateX(40px) scale(0.3) }
        }
        @keyframes smokeBillow {
          0% { bottom: -60px; transform: scale(0.6); opacity: 0 }
          15% { opacity: 0.7 }
          100% { bottom: 70%; transform: scale(2.4); opacity: 0 }
        }
        @keyframes lightning {
          0%,4%,6%,8%,100% { opacity: 0 }
          5%,7% { opacity: 0.85 }
        }
        @keyframes crisisWalk-0 { 0% { left: -12% } 100% { left: 110% } }
        @keyframes crisisWalk-1 { 0% { left: 110% } 100% { left: -12% } }
      `}</style>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// IPO PREP — TED-stage with audience, flashes, spotlight
// ═══════════════════════════════════════════════════════════════════
function IPOPrep() {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* Audience — denser, with clapping motion */}
      <div className="absolute left-0 right-0 bottom-[85px] h-16">
        {Array.from({ length: 28 }).map((_, i) => (
          <div
            key={i}
            className="absolute"
            style={{
              left: `${i * 3.5}%`,
              bottom: 0,
              width: 12,
              height: 16,
              background: '#000',
              borderRadius: '50% 50% 0 0',
              opacity: 0.8,
              animation: `audienceBob ${1.6 + (i % 4) * 0.3}s ease-in-out ${(i * 0.15) % 2}s infinite`,
            }}
          >
            {/* Tiny hands clapping */}
            <div
              className="absolute"
              style={{
                top: -3,
                left: -3,
                width: 2,
                height: 5,
                background: '#000',
                animation: `clap ${0.6 + (i % 3) * 0.2}s ease-in-out infinite`,
              }}
            />
            <div
              className="absolute"
              style={{
                top: -3,
                right: -3,
                width: 2,
                height: 5,
                background: '#000',
                animation: `clap ${0.6 + (i % 3) * 0.2}s ease-in-out infinite reverse`,
              }}
            />
          </div>
        ))}
      </div>

      {/* Multiple camera flashes from audience — chaotic */}
      {Array.from({ length: 12 }).map((_, i) => (
        <div
          key={`flash-${i}`}
          className="absolute"
          style={{
            left: `${5 + i * 8}%`,
            bottom: '20%',
            width: 80,
            height: 80,
            background: 'radial-gradient(circle, white 0%, rgba(255,255,255,0.4) 30%, transparent 65%)',
            opacity: 0,
            animation: `cameraFlash ${3 + (i % 4)}s linear ${(i * 0.4) % 4}s infinite`,
            mixBlendMode: 'screen',
          }}
        />
      ))}

      {/* Top spotlight beams */}
      {[35, 50, 65].map((left, i) => (
        <div
          key={`spot-${i}`}
          className="absolute"
          style={{
            left: `${left}%`,
            top: -40,
            width: 120,
            height: '70%',
            marginLeft: -60,
            background: 'linear-gradient(180deg, rgba(252,191,73,0.45), transparent 75%)',
            transformOrigin: '50% 0%',
            animation: `ipoSpot-${i} ${6 + i * 0.8}s ease-in-out infinite`,
            mixBlendMode: 'screen',
          }}
        />
      ))}

      <style>{sharedKeyframes + `
        @keyframes audienceBob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-3px) } }
        @keyframes cameraFlash { 0%,6%,100% { opacity: 0 } 3% { opacity: 1 } }
        @keyframes clap { 0%,100% { transform: rotate(-15deg) } 50% { transform: rotate(15deg) } }
        @keyframes ipoSpot-0 { 0%,100% { transform: rotate(-12deg) } 50% { transform: rotate(8deg) } }
        @keyframes ipoSpot-1 { 0%,100% { transform: rotate(6deg) } 50% { transform: rotate(-6deg) } }
        @keyframes ipoSpot-2 { 0%,100% { transform: rotate(10deg) } 50% { transform: rotate(-10deg) } }
      `}</style>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// DISTRIBUTION — Hollywood, twinkling stars, palm trees, big spotlights
// ═══════════════════════════════════════════════════════════════════
function Distribution() {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* Twinkling stars in upper sky */}
      {Array.from({ length: 40 }).map((_, i) => (
        <div
          key={`star-${i}`}
          className="absolute"
          style={{
            left: `${(i * 9 + 3) % 100}%`,
            top: `${(i * 5) % 30}%`,
            width: 2,
            height: 2,
            background: 'white',
            borderRadius: '50%',
            opacity: 0.8,
            boxShadow: '0 0 4px white',
            animation: `starTwinkle ${1.4 + (i % 4) * 0.6}s ease-in-out ${(i * 0.13) % 2}s infinite`,
          }}
        />
      ))}

      {/* Drifting clouds (warm sunset-lit) */}
      {[0, 1, 2].map((i) => (
        <div
          key={`cloud-${i}`}
          className="absolute"
          style={{
            top: `${10 + i * 8}%`,
            left: '-30%',
            width: 280,
            height: 50,
            background: 'radial-gradient(ellipse, rgba(252,191,73,0.35) 0%, rgba(247,127,0,0.18) 50%, transparent 80%)',
            animation: `cloudDrift ${40 + i * 12}s linear ${i * 8}s infinite`,
            filter: 'blur(12px)',
            mixBlendMode: 'screen',
          }}
        />
      ))}

      {/* 3 huge sweeping spotlight beams */}
      {[0, 1, 2].map((i) => (
        <div
          key={`beam-${i}`}
          className="absolute"
          style={{
            left: '50%',
            top: -80,
            width: 240,
            height: '130%',
            marginLeft: -120,
            background: 'linear-gradient(180deg, rgba(252,191,73,0.55) 0%, transparent 70%)',
            transformOrigin: '50% 0%',
            animation: `bigSpot-${i} ${10 + i * 1.5}s ease-in-out ${i * 1.2}s infinite`,
            mixBlendMode: 'screen',
            opacity: 0.7,
          }}
        />
      ))}

      {/* HOLLYWOOD sign letters — blinking marquee bulbs */}
      <div className="absolute" style={{ top: '12%', left: '8%', display: 'flex', gap: 6 }}>
        {'HOLLYWOOD'.split('').map((letter, i) => (
          <div
            key={i}
            className="font-display"
            style={{
              color: '#FFD60A',
              fontSize: 26,
              textShadow: '0 0 12px #FCBF49, 0 0 24px #F77F00',
              animation: `signFlick ${1.4 + i * 0.18}s linear infinite`,
              letterSpacing: '2px',
            }}
          >
            {letter}
          </div>
        ))}
      </div>

      {/* Palm tree silhouettes swaying */}
      {[6, 88].map((left, i) => (
        <div
          key={`palm-${i}`}
          className="absolute"
          style={{
            left: `${left}%`,
            bottom: '20%',
            width: 6,
            height: 90,
            background: '#000',
            opacity: 0.65,
            animation: `palmSway ${4.5 + i * 0.5}s ease-in-out infinite`,
            transformOrigin: 'bottom center',
          }}
        >
          {/* Palm fronds */}
          <div className="absolute" style={{ top: -8, left: -16, width: 38, height: 4, background: '#000', borderRadius: 2, transform: 'rotate(-30deg)' }} />
          <div className="absolute" style={{ top: -8, left: -16, width: 38, height: 4, background: '#000', borderRadius: 2, transform: 'rotate(30deg)' }} />
          <div className="absolute" style={{ top: -4, left: -20, width: 46, height: 4, background: '#000', borderRadius: 2 }} />
          <div className="absolute" style={{ top: -2, left: -10, width: 26, height: 4, background: '#000', borderRadius: 2, transform: 'rotate(-15deg)' }} />
          <div className="absolute" style={{ top: -2, left: -10, width: 26, height: 4, background: '#000', borderRadius: 2, transform: 'rotate(15deg)' }} />
        </div>
      ))}

      <style>{sharedKeyframes + `
        @keyframes starTwinkle { 0%,100% { opacity: 0.85; transform: scale(1) } 50% { opacity: 0.2; transform: scale(0.6) } }
        @keyframes cloudDrift { 0% { transform: translateX(-30%) } 100% { transform: translateX(140%) } }
        @keyframes bigSpot-0 { 0%,100% { transform: rotate(-25deg) } 50% { transform: rotate(15deg) } }
        @keyframes bigSpot-1 { 0%,100% { transform: rotate(12deg) } 50% { transform: rotate(-20deg) } }
        @keyframes bigSpot-2 { 0%,100% { transform: rotate(20deg) } 50% { transform: rotate(-10deg) } }
        @keyframes signFlick { 0%,100% { opacity: 0.95 } 30% { opacity: 0.3 } 50% { opacity: 1 } 70% { opacity: 0.6 } }
        @keyframes palmSway { 0%,100% { transform: rotate(-2deg) } 50% { transform: rotate(2deg) } }
      `}</style>
    </div>
  )
}

// Shared keyframes used across multiple stages
const sharedKeyframes = `
  @keyframes scrollLeft { 0% { transform: translateX(0) } 100% { transform: translateX(-50%) } }
`
