import { NavLink } from 'react-router-dom';
import { Bug, Database, Settings } from 'lucide-react';
import BridgeStatus from './BridgeStatus';

const links = [
  { to: '/triage',   label: 'Analysis', icon: Bug },
  { to: '/registry', label: 'Products', icon: Database },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function NavBar() {
  return (
    <header className="sticky top-0 z-30 px-3 sm:px-4 py-3 border-b border-white/10 bg-slate-950/70 backdrop-blur-md">
      <div className="container mx-auto max-w-7xl flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center justify-between sm:justify-start gap-4 sm:gap-6 min-w-0">
          <span className="font-extrabold text-base sm:text-lg tracking-tight shrink-0 bg-gradient-to-r from-cyan-300 via-sky-300 to-blue-400 bg-clip-text text-transparent">
            DevAssist
          </span>
          <nav className="flex gap-1 overflow-x-auto no-scrollbar -mx-1 px-1">
            {links.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-3 sm:px-3.5 py-2 rounded-xl text-xs sm:text-sm whitespace-nowrap transition-colors ${
                    isActive
                      ? 'bg-gradient-to-r from-sky-600 to-blue-700 text-white shadow-md shadow-sky-900/40'
                      : 'text-gray-300 hover:text-white hover:bg-white/10'
                  }`
                }
              >
                <Icon size={14} />
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="self-start sm:self-auto">
          <BridgeStatus />
        </div>
      </div>
    </header>
  );
}
