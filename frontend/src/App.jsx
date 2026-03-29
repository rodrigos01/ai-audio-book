import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import TitleDetail from './pages/TitleDetail';
import Player from './pages/Player';

function App() {
  return (
    <BrowserRouter>
      <div className="flex-col min-h-screen">
        {/* Material Header */}
        <header style={{ 
          padding: '1rem 2rem', 
          backgroundColor: 'var(--md-sys-color-surface)', 
          borderBottom: '1px solid var(--md-sys-color-outline-variant)',
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          position: 'sticky',
          top: 0,
          zIndex: 10
        }}>
          <md-icon style={{ color: 'var(--md-sys-color-primary)', fontSize: '28px' }}>
            <span className="material-symbols-outlined">auto_stories</span>
          </md-icon>
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 500, letterSpacing: '0.5px' }}>AI Audio Book</h1>
        </header>

        {/* Main Content */}
        <main className="app-container animate-fade-in flex-1">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/title/:id" element={<TitleDetail />} />
            <Route path="/player/:chapterId" element={<Player />} />
          </Routes>
        </main>
        
        <div style={{ height: '4rem' }} />
      </div>
    </BrowserRouter>
  );
}

export default App;
