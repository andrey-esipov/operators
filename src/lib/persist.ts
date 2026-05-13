/**
 * Lightweight localStorage persistence for Quote Bank.
 * Avoids pulling in zustand-persist as a dep.
 */

import { useGame } from '../state/game'

const QB_KEY = 'operators:quoteBank:v1'

export function loadQuoteBank() {
  try {
    const raw = localStorage.getItem(QB_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      useGame.setState({ quoteBank: parsed })
    }
  } catch {
    // ignore
  }
}

export function attachQuoteBankSync() {
  return useGame.subscribe((state, prev) => {
    if (state.quoteBank !== prev.quoteBank) {
      try {
        localStorage.setItem(QB_KEY, JSON.stringify(state.quoteBank))
      } catch {
        // ignore
      }
    }
  })
}
