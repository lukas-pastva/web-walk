import React from 'react';
import { NavLink } from 'react-router-dom';

export default function Sidebar({ open, onToggle }) {
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
        </nav>
      )}
    </aside>
  );
}
