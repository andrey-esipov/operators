import type { ScenarioId } from '../types'

interface Props {
  scenario: ScenarioId
}

/**
 * Per-stage ambient motion layer. Renders subtle animated elements on top
 * of the stage background to bring each scenario alive:
 *
 *   pre-pmf       → flickering desk lamps (single bulb) + steam from coffee
 *   hypergrowth   → busy monitor wall (rolling lines)
 *   plateau       → falling leaves (slow drift)
 *   ai-native     → GPU rack indicator lights (rapid blink) + neon scanlines
 *   monetization  → floating dollar-sign particles (rising)
 *   crisis        → embers / sparks rising from below
 *   ipo-prep      → camera flash bulbs (random pops) + audience silhouettes
 *   distribution  → spotlight sweeps + Hollywood sign light shimmer
 *
 * All using pure CSS + small inline keyframe overrides — zero runtime cost.
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

// ─── PRE-PMF: flickering bulb + coffee steam ────────────────────────
function PrePMF() {
  return (
    <div className="absolute inset-0 pointer-events-none">
      <div
        className="absolute"
        style={{
          left: '8%',
          top: '20%',
          width: 80,
          height: 80,
          background: 'radial-gradient(circle, rgba(252,191,73,0.55) 0%, transparent 60%)',
          animation: 'bulbFlicker 3.4s steps(8) infinite',
        }}
      />
      <div
        className="absolute"
        style={{
          right: '12%',
          top: '24%',
          width: 8,
          height: 80,
          background: 'linear-gradient(180deg, rgba(255,255,255,0.45), transparent)',
          animation: 'steamRise 5s linear infinite',
          filter: 'blur(2px)',
        }}
      />
      <style>{`
        @keyframes bulbFlicker { 0%,40%,60%,100% { opacity: 0.85 } 50%,55% { opacity: 0.3 } 70% { opacity: 1 } }
        @keyframes steamRise { 0% { transform: translateY(20px) scaleX(1); opacity: 0.5 } 100% { transform: translateY(-160px) scaleX(1.6); opacity: 0 } }
      `}</style>
    </div>
  )
}

// ─── HYPERGROWTH: monitor wall ──────────────────────────────────────
function Hypergrowth() {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="absolute"
          style={{
            left: `${5 + i * 11}%`,
            top: `${18 + (i % 2) * 6}%`,
            width: 48,
            height: 30,
            background: '#06D6A0',
            opacity: 0.25,
            boxShadow: 'inset 0 0 0 2px rgba(0,0,0,0.6)',
            animation: `monitor${i % 3} ${1.4 + (i % 4) * 0.4}s linear infinite`,
          }}
        />
      ))}
      <style>{`
        @keyframes monitor0 { 0% { opacity: 0.10 } 50% { opacity: 0.35 } 100% { opacity: 0.10 } }
        @keyframes monitor1 { 0% { opacity: 0.25 } 50% { opacity: 0.10 } 100% { opacity: 0.25 } }
        @keyframes monitor2 { 0% { opacity: 0.15 } 30% { opacity: 0.40 } 100% { opacity: 0.15 } }
      `}</style>
    </div>
  )
}

// ─── PLATEAU: slow falling leaves ───────────────────────────────────
function Plateau() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {Array.from({ length: 14 }).map((_, i) => (
        <div
          key={i}
          className="absolute"
          style={{
            left: `${(i * 17) % 100}%`,
            top: -10,
            width: 6,
            height: 6,
            background: i % 3 === 0 ? '#F72585' : i % 3 === 1 ? '#7209B7' : '#FCBF49',
            opacity: 0.7,
            animation: `leafFall ${6 + (i % 5)}s linear ${(i * 0.4) % 6}s infinite`,
            transform: 'rotate(45deg)',
          }}
        />
      ))}
      <style>{`
        @keyframes leafFall {
          0% { top: -10px; transform: translateX(0) rotate(0deg); opacity: 0.8 }
          100% { top: 110%; transform: translateX(60px) rotate(360deg); opacity: 0.1 }
        }
      `}</style>
    </div>
  )
}

// ─── AI-NATIVE: GPU rack lights + scan ──────────────────────────────
function AINative() {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {Array.from({ length: 24 }).map((_, i) => (
        <div
          key={i}
          className="absolute"
          style={{
            left: `${4 + (i % 12) * 7.5}%`,
            top: `${22 + Math.floor(i / 12) * 8}%`,
            width: 4,
            height: 4,
            background: i % 5 === 0 ? '#06D6A0' : '#00B4D8',
            borderRadius: '50%',
            opacity: 0.9,
            boxShadow: `0 0 6px ${i % 5 === 0 ? '#06D6A0' : '#00B4D8'}`,
            animation: `gpuBlink${i % 4} ${0.4 + (i % 5) * 0.2}s linear infinite`,
          }}
        />
      ))}
      {/* Horizontal scanline */}
      <div
        className="absolute left-0 right-0"
        style={{
          top: '30%',
          height: 1,
          background: '#06D6A0',
          opacity: 0.4,
          boxShadow: '0 0 12px #06D6A0',
          animation: 'scanLine 4s linear infinite',
        }}
      />
      <style>{`
        @keyframes gpuBlink0 { 0%,100% { opacity: 0.9 } 50% { opacity: 0.2 } }
        @keyframes gpuBlink1 { 0% { opacity: 0.3 } 100% { opacity: 0.9 } }
        @keyframes gpuBlink2 { 0%,40% { opacity: 0.95 } 50%,100% { opacity: 0.15 } }
        @keyframes gpuBlink3 { 0%,100% { opacity: 0.5 } 30% { opacity: 1 } 70% { opacity: 0.1 } }
        @keyframes scanLine { 0% { top: 16% } 100% { top: 50% } }
      `}</style>
    </div>
  )
}

// ─── MONETIZATION: rising $ particles ──────────────────────────────
function Monetization() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {Array.from({ length: 12 }).map((_, i) => (
        <div
          key={i}
          className="absolute font-display"
          style={{
            left: `${(i * 19 + 5) % 95}%`,
            bottom: -16,
            color: '#FFD60A',
            fontSize: 12,
            opacity: 0.7,
            textShadow: '0 0 6px #F77F00',
            animation: `dollarRise ${7 + (i % 4)}s linear ${(i * 0.6) % 8}s infinite`,
          }}
        >
          $
        </div>
      ))}
      <style>{`
        @keyframes dollarRise {
          0% { bottom: -16px; opacity: 0 }
          15% { opacity: 0.8 }
          90% { opacity: 0.4 }
          100% { bottom: 110%; opacity: 0 }
        }
      `}</style>
    </div>
  )
}

// ─── CRISIS: embers rising ─────────────────────────────────────────
function Crisis() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {Array.from({ length: 20 }).map((_, i) => (
        <div
          key={i}
          className="absolute"
          style={{
            left: `${(i * 13 + 3) % 100}%`,
            bottom: -8,
            width: 3,
            height: 3,
            background: i % 3 === 0 ? '#FFD60A' : '#EF233C',
            opacity: 0.85,
            boxShadow: `0 0 6px ${i % 3 === 0 ? '#FFD60A' : '#EF233C'}`,
            animation: `emberRise ${3 + (i % 4)}s ease-out ${(i * 0.3) % 4}s infinite`,
          }}
        />
      ))}
      <style>{`
        @keyframes emberRise {
          0% { bottom: -8px; opacity: 0; transform: translateX(0) scale(1) }
          10% { opacity: 0.9 }
          100% { bottom: 65%; opacity: 0; transform: translateX(30px) scale(0.4) }
        }
      `}</style>
    </div>
  )
}

// ─── IPO-PREP: camera flashes + audience ───────────────────────────
function IPOPrep() {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* Audience silhouettes — small bobbing heads */}
      <div className="absolute left-0 right-0 bottom-[90px] h-12">
        {Array.from({ length: 18 }).map((_, i) => (
          <div
            key={i}
            className="absolute"
            style={{
              left: `${i * 5.5}%`,
              bottom: 0,
              width: 10,
              height: 12,
              background: '#000000',
              borderRadius: '50% 50% 0 0',
              opacity: 0.7,
              animation: `audienceBob ${2 + (i % 3) * 0.4}s ease-in-out ${(i * 0.2) % 2}s infinite`,
            }}
          />
        ))}
      </div>
      {/* Camera flashes */}
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={`flash-${i}`}
          className="absolute"
          style={{
            left: `${10 + i * 18}%`,
            bottom: '24%',
            width: 60,
            height: 60,
            background: 'radial-gradient(circle, white 0%, transparent 60%)',
            opacity: 0,
            animation: `cameraFlash ${4 + (i * 1.3)}s linear ${i * 0.7}s infinite`,
          }}
        />
      ))}
      <style>{`
        @keyframes audienceBob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-2px) } }
        @keyframes cameraFlash { 0%,8%,100% { opacity: 0 } 4% { opacity: 0.9 } }
      `}</style>
    </div>
  )
}

// ─── DISTRIBUTION: spotlight sweep + sign shimmer ──────────────────
function Distribution() {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* Sweeping spotlight beam */}
      <div
        className="absolute"
        style={{
          left: '50%',
          top: -50,
          width: 220,
          height: '120%',
          marginLeft: -110,
          background: 'linear-gradient(180deg, rgba(252,191,73,0.35) 0%, transparent 80%)',
          transformOrigin: '50% 0%',
          animation: 'spotlightSweep 8s ease-in-out infinite',
          mixBlendMode: 'screen',
        }}
      />
      {/* HOLLYWOOD sign letter lights */}
      {Array.from({ length: 9 }).map((_, i) => (
        <div
          key={i}
          className="absolute"
          style={{
            left: `${15 + i * 8}%`,
            top: '15%',
            width: 14,
            height: 18,
            background: '#FFD60A',
            opacity: 0.85,
            boxShadow: '0 0 8px #FCBF49',
            animation: `signFlick ${1.6 + (i * 0.2)}s linear infinite`,
          }}
        />
      ))}
      <style>{`
        @keyframes spotlightSweep { 0%,100% { transform: rotate(-22deg) } 50% { transform: rotate(22deg) } }
        @keyframes signFlick { 0%,100% { opacity: 0.85 } 35% { opacity: 0.4 } 50% { opacity: 0.95 } }
      `}</style>
    </div>
  )
}
