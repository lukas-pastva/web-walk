import React, { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import WalkList from './pages/WalkList';
import WalkEditor from './pages/WalkEditor';
import WalkDetail from './pages/WalkDetail';
import ApiUsage from './pages/ApiUsage';
import Gallery from './pages/Gallery';
import Help from './pages/Help';
import Settings from './pages/Settings';

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="app-layout">
      <Sidebar open={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />
      <main className={`main-content ${sidebarOpen ? '' : 'sidebar-closed'}`}>
        <Routes>
          <Route path="/" element={<WalkList />} />
          <Route path="/new" element={<WalkEditor />} />
          <Route path="/walk/:id" element={<WalkDetail />} />
          <Route path="/walk/:id/edit" element={<WalkEditor />} />
          <Route path="/gallery" element={<Gallery />} />
          <Route path="/usage" element={<ApiUsage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/help" element={<Help />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
