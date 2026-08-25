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
    <header className="bg-altera-dark border-b border-gray-800 px-3 sm:px-4 py-3">
      <div className="container mx-auto max-w-7xl flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center justify-between sm:justify-start gap-4 sm:gap-6 min-w-0">
          <span className="text-altera-teal font-bold text-base sm:text-lg tracking-tight shrink-0">
            DevAssist
          </span>
          <nav className="flex gap-1 overflow-x-auto no-scrollbar -mx-1 px-1">
            {links.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded text-xs sm:text-sm whitespace-nowrap transition-colors ${
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
        <div className="self-start sm:self-auto">
          <BridgeStatus />
        </div>
      </div>
    </header>
  );
}
