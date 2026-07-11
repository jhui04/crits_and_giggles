import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { CampaignProvider } from './context/CampaignProvider.tsx'
import { WorldProvider } from './context/WorldProvider.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WorldProvider>
      <CampaignProvider>
        <App />
      </CampaignProvider>
    </WorldProvider>
  </StrictMode>,
)
