import { NavLink } from 'react-router-dom';
import { Bug, Database, Settings } from 'lucide-react';
import BridgeStatus from './BridgeStatus';

const links = [
  { to: '/triage',   label: 'Triage',   icon: Bug },
  { to: '/registry', label: 'Products', icon: Database },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function NavBar() {
  return (
    <header className="bg-altera-dark border-b border-gray-800 px-4 py-3">
      <div className="container mx-auto max-w-7xl flex items-center justify-between">
        <div className="flex items-center gap-6">
          <span className="text-altera-teal font-bold text-lg tracking-tight">
            DevAssist
          </span>
          <nav className="flex gap-1">
            {links.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors ${
                    isActive
                      ? 'bg-altera-blue text-white'
                      : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800'
                  }`
                }
              >
                <Icon size={14} />
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
        <BridgeStatus />
      </div>
    </header>
  );
}
