import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'motion/react'
import { CardLanguageProvider } from './i18n/cards'
import { AudioProvider } from './features/settings/Audio'
import { App } from './app/App'
import './app/styles.css'
import './features/match/battlefield.css'
import './ui/cards.css'
import './features/settings/settings.css'
import './features/match/presentation.css'
import './features/match/result.css'
import './features/match/weather.css'
import './features/lobby/invitation.css'
import './features/lobby/opponents.css'
createRoot(document.getElementById('root')!).render(
  <MotionConfig reducedMotion="user">
    <CardLanguageProvider>
      <AudioProvider>
        <App />
      </AudioProvider>
    </CardLanguageProvider>
  </MotionConfig>,
)
