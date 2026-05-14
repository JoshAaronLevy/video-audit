import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { config, library } from '@fortawesome/fontawesome-svg-core'
import {
  faArrowUpFromBracket,
  faCrop,
  faEye,
} from '@fortawesome/free-solid-svg-icons'
import { PrimeReactProvider } from 'primereact/api'
import '@fortawesome/fontawesome-svg-core/styles.css'
import './index.css'
import App from './App.tsx'

config.autoAddCss = false
library.add(faArrowUpFromBracket, faCrop, faEye)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrimeReactProvider>
      <App />
    </PrimeReactProvider>
  </StrictMode>,
)
