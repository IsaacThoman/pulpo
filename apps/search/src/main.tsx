import { createRoot } from 'react-dom/client'
import { App } from './App'
import { consumeCallback } from './auth'
import './styles.css'

const callback = consumeCallback()
createRoot(document.getElementById('root')!).render(<App callback={callback} />)
