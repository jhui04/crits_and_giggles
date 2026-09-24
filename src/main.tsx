import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { CampaignProvider } from './context/CampaignProvider.tsx'
import { WorldProvider } from './context/WorldProvider.tsx'
import { AssistantScreenProvider } from './context/AssistantScreenProvider.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WorldProvider>
      <CampaignProvider>
        <AssistantScreenProvider>
          <App />
        </AssistantScreenProvider>
      </CampaignProvider>
    </WorldProvider>
  </StrictMode>,
)
