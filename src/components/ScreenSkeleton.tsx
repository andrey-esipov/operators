import type { Phase } from '../types'

/**
 * Suspense fallback shown while a lazy-loaded screen chunk is fetching.
 *
 * Two design goals:
 *   1. Stay on-aesthetic — no generic spinner. We render the cabinet's
 *      CRT scanlines + an animated pixel-art loader bar.
 *   2. Hint at the *layout* of the incoming screen so the transition reads
 *      as the next screen settling in, not as an unrelated loading state.
 *      Combat skeleton mirrors HP bar + move-card slots; menu-like screens
 *      get the standard header + body shape.
 *
 * The fallback fades in with a 120ms delay so chunks that resolve quickly
 * (already-prefetched, near-instant on warm cache) never show it at all.
 */
export function ScreenSkeleton({ phase }: { phase: Phase }) {
  return (
    <div
      className="screen-skeleton w-full h-full relative overflow-hidden"
      style={{ background: '#0F0A1A' }}
    >
      {phase === 'fight' || phase === 'pre-fight' || phase === 'round-end' || phase === 'match-end' ? (
        <CombatSkeleton />
      ) : phase === 'character-select' ? (
        <RosterSkeleton />
      ) : phase === 'framework-encyclopedia' || phase === 'quote-bank' ? (
        <ListSkeleton />
      ) : (
        <GenericSkeleton />
      )}

      {/* Bottom-anchored cabinet-style loader bar */}
      <div className="absolute left-0 right-0 bottom-10 flex flex-col items-center gap-2 pointer-events-none">
        <div
          className="font-display text-[9px] tracking-widest"
          style={{
            color: '#FFD60A',
            textShadow: '2px 2px 0 black, 0 0 8px #F77F00',
            letterSpacing: '0.4em',
          }}
        >
          LOADING
        </div>
        <div
          className="relative"
          style={{
            width: 180,
            height: 10,
            border: '1px solid #FFD60A',
            background: 'rgba(0,0,0,0.6)',
            boxShadow: 'inset -1px -1px 0 rgba(0,0,0,0.5)',
          }}
        >
          <div
            className="absolute inset-y-0 left-0"
            style={{
              background: 'linear-gradient(90deg, #F77F00, #FFD60A)',
              boxShadow: '0 0 10px #FFD60A',
              animation: 'skeletonBar 1.1s linear infinite',
            }}
          />
        </div>
      </div>

      <style>{`
        @keyframes skeletonBar {
          0%   { width: 0%;   opacity: 1 }
          85%  { width: 100%; opacity: 1 }
          100% { width: 100%; opacity: 0 }
        }
        @keyframes skeletonShimmer {
          0%   { background-position: -120% 0 }
          100% { background-position: 220% 0 }
        }
        .skeleton-block {
          background: linear-gradient(
            90deg,
            rgba(255,255,255,0.03) 0%,
            rgba(255,255,255,0.08) 50%,
            rgba(255,255,255,0.03) 100%
          );
          background-size: 200% 100%;
          animation: skeletonShimmer 1.4s ease-in-out infinite;
        }
        .screen-skeleton {
          opacity: 0;
          animation: skeletonFadeIn 0.18s ease-out 0.12s forwards;
        }
        @keyframes skeletonFadeIn {
          to { opacity: 1 }
        }
      `}</style>
    </div>
  )
}

function CombatSkeleton() {
  return (
    <>
      {/* Top HUD shells — HP bars + meters left/right */}
      <div className="absolute left-0 right-0 top-0 px-6 pt-3 flex items-start justify-between gap-6">
        <div className="flex-1 flex flex-col gap-2">
          <div className="skeleton-block" style={{ height: 22, borderLeft: '2px solid #E63946' }} />
          <div className="flex gap-3">
            <div className="skeleton-block" style={{ width: 100, height: 10 }} />
            <div className="skeleton-block" style={{ width: 100, height: 10 }} />
          </div>
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className="skeleton-block" style={{ width: 80, height: 16 }} />
          <div className="skeleton-block" style={{ width: 60, height: 36 }} />
        </div>
        <div className="flex-1 flex flex-col gap-2 items-end">
          <div className="skeleton-block w-full" style={{ height: 22, borderRight: '2px solid #00B4D8' }} />
          <div className="flex gap-3 flex-row-reverse">
            <div className="skeleton-block" style={{ width: 100, height: 10 }} />
            <div className="skeleton-block" style={{ width: 100, height: 10 }} />
          </div>
        </div>
      </div>

      {/* Fighter slot shells centered */}
      <div className="absolute left-0 right-0 flex items-end justify-between px-20" style={{ bottom: 200 }}>
        <div className="skeleton-block" style={{ width: 280, height: 380, borderRadius: 4 }} />
        <div className="skeleton-block" style={{ width: 280, height: 380, borderRadius: 4 }} />
      </div>

      {/* Move-card row shells */}
      <div className="absolute left-0 right-0 bottom-32 px-6 flex justify-center gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton-block" style={{ width: 170, height: 82 }} />
        ))}
      </div>
    </>
  )
}

function RosterSkeleton() {
  return (
    <>
      {/* Header strip */}
      <div className="absolute left-0 right-0 top-0 px-6 py-4 flex items-center justify-between">
        <div className="skeleton-block" style={{ width: 80, height: 14 }} />
        <div className="skeleton-block" style={{ width: 200, height: 26 }} />
        <div className="skeleton-block" style={{ width: 80, height: 14 }} />
      </div>
      {/* Tile grid */}
      <div className="absolute inset-x-6 top-24 bottom-32 grid grid-cols-8 gap-2 auto-rows-min">
        {Array.from({ length: 40 }).map((_, i) => (
          <div key={i} className="skeleton-block" style={{ aspectRatio: '1 / 1.1' }} />
        ))}
      </div>
    </>
  )
}

function ListSkeleton() {
  return (
    <>
      <div className="absolute left-0 right-0 top-0 px-6 py-4 flex items-center justify-between">
        <div className="skeleton-block" style={{ width: 80, height: 14 }} />
        <div className="skeleton-block" style={{ width: 220, height: 26 }} />
        <div className="skeleton-block" style={{ width: 80, height: 14 }} />
      </div>
      <div className="absolute inset-x-6 top-24 bottom-32 flex flex-col gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton-block" style={{ height: 64 }} />
        ))}
      </div>
    </>
  )
}

function GenericSkeleton() {
  return (
    <>
      <div className="absolute left-0 right-0 top-0 px-6 py-4 flex items-center justify-between">
        <div className="skeleton-block" style={{ width: 80, height: 14 }} />
        <div className="skeleton-block" style={{ width: 200, height: 26 }} />
        <div className="skeleton-block" style={{ width: 80, height: 14 }} />
      </div>
      <div className="absolute inset-x-12 top-28 bottom-32 flex flex-col gap-4">
        <div className="skeleton-block" style={{ height: 28, width: '40%' }} />
        <div className="skeleton-block" style={{ height: 18, width: '85%' }} />
        <div className="skeleton-block" style={{ height: 18, width: '75%' }} />
        <div className="skeleton-block" style={{ height: 18, width: '80%' }} />
      </div>
    </>
  )
}
