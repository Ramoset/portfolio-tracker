'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Wallet,
  ArrowLeftRight,
  TrendingDown,
  TrendingUp,
  Settings,
  PanelLeft,
  Building2,
} from 'lucide-react';

type Props = {
  open: boolean;
  onToggle: () => void;
};

const nav = [
  { href: '/dashboard',         label: 'Dashboard',         icon: LayoutDashboard },
  { href: '/wallets',           label: 'Wallets',           icon: Wallet },
  { href: '/exchanges',         label: 'Exchanges',         icon: Building2 },
  { href: '/transactions',      label: 'Transactions',      icon: ArrowLeftRight },
  { href: '/open-positions',    label: 'Pos. Aperte',        icon: TrendingUp },
  { href: '/closed-positions',  label: 'Pos. Chiuse',       icon: TrendingDown },
  { href: '/settings',          label: 'Settings',          icon: Settings },
];

export function Sidebar({ open, onToggle }: Props) {
  const pathname = usePathname();

  return (
    <aside
      className={[
        'sticky top-3 h-[calc(100vh-24px)] shrink-0 rounded-2xl border border-neutral-200 bg-white shadow-sm',
        open ? 'w-64' : 'w-14',
      ].join(' ')}
    >
      <div className="flex items-center justify-between px-3 py-3">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-xl bg-neutral-900 text-white">
            P
          </div>
          {open && (
            <div className="leading-tight">
              <div className="text-sm font-semibold">Portfolio</div>
              <div className="text-xs text-neutral-500">Tracker</div>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onToggle}
          className="grid h-9 w-9 place-items-center rounded-xl hover:bg-neutral-100"
          aria-label="Toggle sidebar"
        >
          <PanelLeft className="h-5 w-5" />
        </button>
      </div>

      <nav className="px-2">
        {nav.map((item) => {
          const active =
            pathname === item.href ||
            pathname?.startsWith(item.href + '/');
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                'flex items-center gap-2 rounded-xl px-2 py-2 text-sm hover:bg-neutral-100',
                active ? 'bg-neutral-100 font-medium' : 'text-neutral-700',
              ].join(' ')}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {open && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {open && (
        <div className="mt-3 border-t border-neutral-200 px-3 py-3 text-xs text-neutral-500">
          Tip: clicca una riga per aprire i dettagli a destra (prossimo step).
        </div>
      )}
    </aside>
  );
}
