import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar.jsx';
import { TopBar } from './TopBar.jsx';
import { MobileNav } from './MobileNav.jsx';

export function AppShell() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('rail') === 'collapsed');

  const toggle = () => {
    setCollapsed((c) => {
      localStorage.setItem('rail', c ? 'open' : 'collapsed');
      return !c;
    });
  };

  return (
    <div className="flex min-h-dvh bg-canvas">
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 px-3 pb-24 pt-4 sm:px-4 sm:pb-8 lg:px-6">
          <div className="mx-auto w-full max-w-[1400px]">
            <Outlet />
          </div>
        </main>
        <MobileNav />
      </div>
    </div>
  );
}
