import { useGame } from '../../state/game'

// DEV-only: expose the zustand store on window so screenshot/E2E harnesses can
// drive the ceremony screens (round-end, match-end, arcade-victory) into their
// terminal states without simulating a full real-time fight. Tree-shaken out of
// production builds via the import.meta.env.DEV guard.
if (import.meta.env.DEV) {
  ;(window as unknown as { __game?: typeof useGame }).__game = useGame
}
