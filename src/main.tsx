import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { CampaignProvider } from './context/CampaignContext.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CampaignProvider>
      <App />
    </CampaignProvider>
  </StrictMode>,
)
