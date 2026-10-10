import { createRoot } from 'react-dom/client'
import { Pet } from './pet/Pet'
import { usePet } from './store'
import './styles.css'

window.nexo.getSettings().then((settings) => {
  usePet.getState().set({ settings })
  createRoot(document.getElementById('root')!).render(<Pet initial={settings} />)
})
