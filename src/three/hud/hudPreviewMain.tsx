import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HudPreview } from './HudPreview'

const el = document.getElementById('root')!
createRoot(el).render(
  <StrictMode>
    <HudPreview />
  </StrictMode>,
)
