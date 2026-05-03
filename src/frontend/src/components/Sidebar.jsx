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

export default function Sidebar({ open, onToggle }) {
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || 'auto');

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

  return (
    <aside className={`sidebar ${open ? 'open' : 'closed'}`}>
      <div className="sidebar-header">
        {open && <h1 className="sidebar-logo">Web Walk</h1>}
        <button className="sidebar-toggle" onClick={onToggle}>
          {open ? '\u2039' : '\u203A'}
        </button>
      </div>
      {open && (
        <nav className="sidebar-nav">
          <NavLink to="/" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} end>
            <span className="nav-icon">&#9776;</span>
            <span>My Walks</span>
          </NavLink>
          <NavLink to="/new" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">+</span>
            <span>New Walk</span>
          </NavLink>
          <NavLink to="/usage" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">$</span>
            <span>API Usage</span>
          </NavLink>
        </nav>
      )}
      {open && (
        <button className="theme-toggle" onClick={cycleTheme} style={{ marginTop: 'auto' }}>
          <span>{ICONS[theme]}</span>
          <span>{theme.charAt(0).toUpperCase() + theme.slice(1)}</span>
        </button>
      )}
    </aside>
  );
}
