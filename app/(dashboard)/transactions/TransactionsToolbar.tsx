'use client';

import { useEffect, useMemo, useState } from 'react';

type Props = {
  search: string;
  setSearch: (v: string) => void;
  searchSuggestions: string[];

  tickerFilter: string;
  setTickerFilter: (v: string) => void;

  exchangeFilter: string;
  setExchangeFilter: (v: string) => void;

  actionFilter: string;
  setActionFilter: (v: string) => void;

  walletFilter: string;
  setWalletFilter: (v: string) => void;

  walletOptions: string[];

  onClear: () => void;
};

function Chip({
  active,
  children,
  onClick,
}: {
  active?: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-xl border px-3 py-2 text-sm transition',
        active
          ? 'border-neutral-900 bg-neutral-900 text-white'
          : 'border-neutral-200 bg-white hover:bg-neutral-50',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

export function TransactionsToolbar({
  search,
  setSearch,
  searchSuggestions,
  tickerFilter,
  setTickerFilter,
  exchangeFilter,
  setExchangeFilter,
  actionFilter,
  setActionFilter,
  walletFilter,
  setWalletFilter,
  walletOptions,
  onClear,
}: Props) {
  const actions = ['ALL', 'BUY', 'SELL', 'SWAP', 'DEPOSIT', 'WITHDRAWAL'];
  const [searchDraft, setSearchDraft] = useState(search);

  useEffect(() => {
    setSearchDraft(search);
  }, [search]);

  const topSuggestions = useMemo(
    () => searchSuggestions.slice(0, 20),
    [searchSuggestions]
  );

  const applySearch = () => {
    setSearch(searchDraft.trim());
  };

  return (
    <div className="mb-4 rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm font-semibold">Filters</div>

          <button
            type="button"
            onClick={onClear}
            className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm hover:bg-neutral-50"
          >
            Clear
          </button>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex w-full gap-2">
            <input
              list="transactions-search-suggestions"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applySearch();
              }}
              placeholder="Search anything (notes, currencies, from/to, type...)"
              className="w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm outline-none focus:border-neutral-400"
            />
            <datalist id="transactions-search-suggestions">
              {topSuggestions.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
            <button
              type="button"
              onClick={applySearch}
              className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm hover:bg-neutral-50"
            >
              Cerca
            </button>
          </div>
          <input
            value={tickerFilter}
            onChange={(e) => setTickerFilter(e.target.value.toUpperCase())}
            placeholder="Ticker (es. BTC)"
            className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400 sm:w-48"
          />
          <input
            value={exchangeFilter}
            onChange={(e) => setExchangeFilter(e.target.value.toUpperCase())}
            placeholder="Exchange (es. BINANCE)"
            className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400 sm:w-56"
          />

          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400 sm:w-56"
          >
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>

          <select
            value={walletFilter}
            onChange={(e) => setWalletFilter(e.target.value)}
            className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400 sm:w-64"
          >
            <option value="ALL">ALL WALLETS</option>
            {walletOptions.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </div>

        {/* quick chips per Action */}
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <Chip
              key={a}
              active={actionFilter === a}
              onClick={() => setActionFilter(a)}
            >
              {a}
            </Chip>
          ))}
        </div>
      </div>
    </div>
  );
}
