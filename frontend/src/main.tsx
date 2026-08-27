import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import './cloud' // 托管版挂件(额度条 + 赞助弹窗);自托管时后端不返回额度上限,这些组件自动不渲染

if ((localStorage.getItem('theme') || 'dark') === 'dark') document.documentElement.classList.add('dark')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
