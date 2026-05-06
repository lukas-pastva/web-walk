import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';

const THEME_KEY = 'web-walk-theme';
const MODES = ['auto', 'dark', 'light'];
const ICONS = { auto: '\u25D0', dark: '\u263D', light: '\u2600' };

function applyTheme(mode) {
  const resolved = mode === 'auto'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : mode;
  document.documentElement.setAttribute('data-theme', resolved);
}

function useIsMobile() {
  const [mobile, setMobile] = useState(window.innerWidth <= 768);
  useEffect(() => {
    const handler = () => setMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return mobile;
}

export default function Sidebar({ open, onToggle }) {
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || 'auto');
  const isMobile = useIsMobile();

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(THEME_KEY, theme);
    if (theme === 'auto') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => applyTheme('auto');
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [theme]);

  const cycleTheme = () => {
    setTheme((prev) => MODES[(MODES.indexOf(prev) + 1) % MODES.length]);
  };

  // On mobile: always show nav as bottom bar
  const showNav = isMobile || open;

  return (
    <aside className={`sidebar ${open ? 'open' : 'closed'}`}>
      <div className="sidebar-header">
        {open && <h1 className="sidebar-logo">Web Walk</h1>}
        <button className="sidebar-toggle" onClick={onToggle}>
          {open ? '\u2039' : '\u203A'}
        </button>
      </div>
      {showNav && (
        <nav className="sidebar-nav">
          <NavLink to="/" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} end>
            <span className="nav-icon">&#9776;</span>
            <span>Walks</span>
          </NavLink>
          <NavLink to="/new" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">+</span>
            <span>New</span>
          </NavLink>
          <NavLink to="/gallery" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">&#9654;</span>
            <span>Gallery</span>
          </NavLink>
          <NavLink to="/cache" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">&#128444;</span>
            <span>Cache</span>
          </NavLink>
          <NavLink to="/usage" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">$</span>
            <span>Usage</span>
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">&#9881;</span>
            <span>Settings</span>
          </NavLink>
          <NavLink to="/help" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">?</span>
            <span>Help</span>
          </NavLink>
          {isMobile && (
            <button className="nav-link" onClick={cycleTheme} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
              <span className="nav-icon">{ICONS[theme]}</span>
              <span>{theme.charAt(0).toUpperCase() + theme.slice(1)}</span>
            </button>
          )}
        </nav>
      )}
      {!isMobile && open && (
        <button className="theme-toggle" onClick={cycleTheme} style={{ marginTop: 'auto' }}>
          <span>{ICONS[theme]}</span>
          <span>{theme.charAt(0).toUpperCase() + theme.slice(1)}</span>
        </button>
      )}
    </aside>
  );
}
