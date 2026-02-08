import type {
  Transaction,
  Asset,
  AssetBalance,
  PortfolioSummary,
  WalletWithAllocation,
  Wallet,
} from '@/lib/types/database.types';
import { CASH_TICKERS } from '@/lib/utils';

// =============================================
// ASSET BALANCE CALCULATION
// =============================================

interface Position {
  ticker: string;
  type: string;
  wallet_id: string | null;
  wallet_name: string | null;
  exchange: string;
  balance: number;
  totalInvested: number;
  totalBought: number;
  totalSold: number;
  totalFees: number;
  buyTransactions: Array<{
    quantity: number;
    price: number;
    date: string;
  }>;
  sellTransactions: Array<{
    quantity: number;
    price: number;
    date: string;
  }>;
}

/**
 * Calculate asset balances from transactions
 * Handles: BUY, SELL, DEPOSIT, WITHDRAWAL, SWAP, AIRDROP
 */
export function calculateAssetBalances(
  transactions: Transaction[],
  assets: Asset[],
  wallets: Wallet[]
): AssetBalance[] {
  // Create price map for quick lookup
  const priceMap = new Map<string, number>();
  assets.forEach(asset => {
    if (asset.current_price) {
      priceMap.set(asset.ticker, asset.current_price);
    }
  });

  // Create wallet map
  const walletMap = new Map<string, string>();
  wallets.forEach(wallet => {
    walletMap.set(wallet.id, wallet.name);
  });

  // Sort transactions by date
  const sortedTx = [...transactions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  // Build positions map
  const positions = new Map<string, Position>();

  sortedTx.forEach(tx => {
    const { ticker, exchange, wallet_id, type } = tx;
    const wallet_name = wallet_id ? walletMap.get(wallet_id) || null : null;
    
    // Create unique key for position
    const key = `${ticker}-${exchange}-${wallet_id || 'null'}`;

    // Initialize position if doesn't exist
    if (!positions.has(key)) {
      positions.set(key, {
        ticker,
        type: type || 'CRYPTO',
        wallet_id,
        wallet_name,
        exchange,
        balance: 0,
        totalInvested: 0,
        totalBought: 0,
        totalSold: 0,
        totalFees: 0,
        buyTransactions: [],
        sellTransactions: [],
      });
    }

    const pos = positions.get(key)!;

    // Track fees for this asset (only if fees paid in same asset)
    if (tx.fees > 0 && tx.fees_currency === ticker) {
      pos.totalFees += tx.fees;
    }

    // Handle each action type
    switch (tx.action) {
      case 'DEPOSIT':
      case 'AIRDROP':
        // Add to balance (no cost basis for deposits/airdrops)
        pos.balance += tx.quantity;
        pos.totalBought += tx.quantity;
        break;

      case 'WITHDRAWAL':
        // Remove from balance
        pos.balance -= tx.quantity;
        pos.totalSold += tx.quantity;
        break;

      case 'BUY':
        // Add asset to balance
        pos.balance += tx.quantity;
        pos.totalBought += tx.quantity;
        
        // Track cost basis
        const buyCost = tx.price * tx.quantity;
        pos.totalInvested += buyCost;
        pos.buyTransactions.push({
          quantity: tx.quantity,
          price: tx.price,
          date: tx.date,
        });

        // Subtract payment from the price_currency asset
        if (tx.price_currency) {
          const paymentKey = `${tx.price_currency}-${exchange}-${wallet_id || 'null'}`;
          if (!positions.has(paymentKey)) {
            positions.set(paymentKey, {
              ticker: tx.price_currency,
              type: CASH_TICKERS.includes(tx.price_currency) ? 'CRYPTO' : type,
              wallet_id,
              wallet_name,
              exchange,
              balance: 0,
              totalInvested: 0,
              totalBought: 0,
              totalSold: 0,
              totalFees: 0,
              buyTransactions: [],
              sellTransactions: [],
            });
          }
          const paymentPos = positions.get(paymentKey)!;
          paymentPos.balance -= buyCost;
        }
        break;

      case 'SELL':
        // Remove asset from balance
        pos.balance -= tx.quantity;
        pos.totalSold += tx.quantity;
        
        // Track sell
        const sellValue = tx.price * tx.quantity;
        pos.sellTransactions.push({
          quantity: tx.quantity,
          price: tx.price,
          date: tx.date,
        });

        // Add proceeds to the price_currency asset
        if (tx.price_currency) {
          const proceedsKey = `${tx.price_currency}-${exchange}-${wallet_id || 'null'}`;
          if (!positions.has(proceedsKey)) {
            positions.set(proceedsKey, {
              ticker: tx.price_currency,
              type: CASH_TICKERS.includes(tx.price_currency) ? 'CRYPTO' : type,
              wallet_id,
              wallet_name,
              exchange,
              balance: 0,
              totalInvested: 0,
              totalBought: 0,
              totalSold: 0,
              totalFees: 0,
              buyTransactions: [],
              sellTransactions: [],
            });
          }
          const proceedsPos = positions.get(proceedsKey)!;
          proceedsPos.balance += sellValue;
        }
        break;

      case 'SWAP':
        // SWAP: from_ticker → to_ticker
        if (tx.from_ticker && tx.to_ticker) {
          // Subtract from_ticker
          const fromKey = `${tx.from_ticker}-${exchange}-${wallet_id || 'null'}`;
          if (!positions.has(fromKey)) {
            positions.set(fromKey, {
              ticker: tx.from_ticker,
              type: type || 'CRYPTO',
              wallet_id,
              wallet_name,
              exchange,
              balance: 0,
              totalInvested: 0,
              totalBought: 0,
              totalSold: 0,
              totalFees: 0,
              buyTransactions: [],
              sellTransactions: [],
            });
          }
          const fromPos = positions.get(fromKey)!;
          
          // Calculate how much from_ticker was spent
          // If ticker (in table) is to_ticker: quantity * price = from_ticker amount
          const fromAmount = tx.quantity * tx.price;
          fromPos.balance -= fromAmount;
          fromPos.totalSold += fromAmount;

          // Add to_ticker (ticker field contains the "to" asset)
          pos.balance += tx.quantity;
          pos.totalBought += tx.quantity;
        }
        break;
    }

    // Handle fees (subtract from the fees currency balance)
    if (tx.fees > 0 && tx.fees_currency) {
      const feesKey = `${tx.fees_currency}-${exchange}-${wallet_id || 'null'}`;
      if (!positions.has(feesKey)) {
        positions.set(feesKey, {
          ticker: tx.fees_currency,
          type: CASH_TICKERS.includes(tx.fees_currency) ? 'CRYPTO' : type,
          wallet_id,
          wallet_name,
          exchange,
          balance: 0,
          totalInvested: 0,
          totalBought: 0,
          totalSold: 0,
          totalFees: 0,
          buyTransactions: [],
          sellTransactions: [],
        });
      }
      const feesPos = positions.get(feesKey)!;
      feesPos.balance -= tx.fees;
    }
  });

  // Convert to array and calculate metrics
  const openPositions: AssetBalance[] = [];

  positions.forEach((pos) => {
    // Only include positions with non-zero balance
    if (Math.abs(pos.balance) < 0.00000001) return;

    const currentPrice = priceMap.get(pos.ticker) || 0;
    const currentValue = pos.balance * currentPrice;

    // Calculate average entry price
    let avgEntryPrice = 0;
    if (pos.totalBought > 0 && pos.totalInvested > 0) {
      avgEntryPrice = pos.totalInvested / pos.totalBought;
    }

    // Calculate unrealized P&L
    const invested = pos.balance * avgEntryPrice;
    const unrealizedPL = currentValue - invested;
    const unrealizedPLPercent = invested > 0 ? (unrealizedPL / invested) * 100 : 0;

    openPositions.push({
      ticker: pos.ticker,
      type: pos.type as 'CRYPTO' | 'STOCK',
      wallet_id: pos.wallet_id,
      wallet_name: pos.wallet_name,
      exchange: pos.exchange,
      balance: pos.balance,
      avg_entry_price: avgEntryPrice,
      current_price: currentPrice,
      current_value: currentValue,
      total_invested: invested,
      unrealized_pl: unrealizedPL,
      unrealized_pl_percent: unrealizedPLPercent,
      total_fees: pos.totalFees,
    });
  });

  return openPositions;
}

/**
 * Calculate total cash (stablecoins + fiat)
 */
export function calculateTotalCash(assetBalances: AssetBalance[]): number {
  return assetBalances
    .filter(asset => CASH_TICKERS.includes(asset.ticker))
    .reduce((sum, asset) => sum + asset.current_value, 0);
}

/**
 * Calculate total portfolio value
 */
export function calculateTotalPortfolioValue(assetBalances: AssetBalance[]): number {
  return assetBalances.reduce((sum, asset) => sum + asset.current_value, 0);
}

/**
 * Calculate total unrealized P&L
 */
export function calculateUnrealizedPL(assetBalances: AssetBalance[]): {
  total: number;
  percent: number;
} {
  const totalInvested = assetBalances.reduce((sum, asset) => sum + asset.total_invested, 0);
  const totalPL = assetBalances.reduce((sum, asset) => sum + asset.unrealized_pl, 0);
  const percent = totalInvested > 0 ? (totalPL / totalInvested) * 100 : 0;

  return { total: totalPL, percent };
}

/**
 * Calculate total fees (split by cash vs token)
 */
export function calculateTotalFees(transactions: Transaction[]): {
  total: number;
  cash: number;
  tokens: Record<string, number>;
} {
  const fees = {
    total: 0,
    cash: 0,
    tokens: {} as Record<string, number>,
  };

  transactions.forEach(tx => {
    if (tx.fees > 0) {
      fees.total += tx.fees;

      const currency = tx.fees_currency || 'USDT';
      
      if (CASH_TICKERS.includes(currency)) {
        fees.cash += tx.fees;
      } else {
        if (!fees.tokens[currency]) {
          fees.tokens[currency] = 0;
        }
        fees.tokens[currency] += tx.fees;
      }
    }
  });

  return fees;
}

/**
 * Calculate portfolio summary
 */
export function calculatePortfolioSummary(
  transactions: Transaction[],
  assetBalances: AssetBalance[]
): PortfolioSummary {
  const totalValue = calculateTotalPortfolioValue(assetBalances);
  const totalCash = calculateTotalCash(assetBalances);
  const { total: unrealizedPL, percent: unrealizedPLPercent } = calculateUnrealizedPL(assetBalances);
  const fees = calculateTotalFees(transactions);

  const totalInvested = assetBalances.reduce((sum, asset) => sum + asset.total_invested, 0);

  const exchanges = new Set(transactions.map(tx => tx.exchange));
  const assetCount = assetBalances.filter(a => !CASH_TICKERS.includes(a.ticker)).length;

  return {
    total_value: totalValue,
    total_cash: totalCash,
    total_invested: totalInvested,
    unrealized_pl: unrealizedPL,
    unrealized_pl_percent: unrealizedPLPercent,
    realized_pl: 0, // TODO: Implement realized P&L calculation with FIFO
    total_fees: fees.total,
    total_fees_cash: fees.cash,
    total_fees_token: fees.tokens,
    asset_count: assetCount,
    exchange_count: exchanges.size,
  };
}

/**
 * Calculate wallet allocations (current vs target)
 */
export function calculateWalletAllocations(
  wallets: Wallet[],
  assetBalances: AssetBalance[]
): WalletWithAllocation[] {
  const totalPortfolioValue = calculateTotalPortfolioValue(assetBalances);
  
  if (totalPortfolioValue === 0) {
    return wallets.map(w => ({
      ...w,
      current_allocation_percent: 0,
      allocation_diff: 0,
      needs_rebalance: false,
      current_value: 0,
    }));
  }

  const result: WalletWithAllocation[] = wallets.map(wallet => {
    // Calculate value of assets in this wallet
    const walletValue = assetBalances
      .filter(a => a.wallet_id === wallet.id)
      .reduce((sum, a) => sum + a.current_value, 0);

    const currentPercent = (walletValue / totalPortfolioValue) * 100;
    const targetPercent = wallet.target_allocation_percent || 0;
    const diff = currentPercent - targetPercent;
    const needsRebalance = Math.abs(diff) > 5; // 5% threshold

    return {
      ...wallet,
      current_allocation_percent: currentPercent,
      allocation_diff: diff,
      needs_rebalance: needsRebalance,
      current_value: walletValue,
    };
  });

  // Build tree structure
  const rootWallets = result.filter(w => w.level === 0);
  const buildTree = (parent: WalletWithAllocation): WalletWithAllocation => {
    const children = result.filter(w => w.parent_wallet_id === parent.id);
    if (children.length > 0) {
      parent.children = children.map(buildTree);
    }
    return parent;
  };

  return rootWallets.map(buildTree);
}

/**
 * Get best and worst performers
 */
export function getTopPerformers(
  assetBalances: AssetBalance[],
  limit: number = 5
): {
  best: AssetBalance[];
  worst: AssetBalance[];
} {
  const sorted = [...assetBalances]
    .filter(a => !CASH_TICKERS.includes(a.ticker))
    .sort((a, b) => b.unrealized_pl_percent - a.unrealized_pl_percent);

  return {
    best: sorted.slice(0, limit),
    worst: sorted.slice(-limit).reverse(),
  };
}

/**
 * Group assets by exchange
 */
export function groupAssetsByExchange(assetBalances: AssetBalance[]): Map<string, AssetBalance[]> {
  const groups = new Map<string, AssetBalance[]>();

  assetBalances.forEach(asset => {
    if (!groups.has(asset.exchange)) {
      groups.set(asset.exchange, []);
    }
    groups.get(asset.exchange)!.push(asset);
  });

  return groups;
}

/**
 * Calculate exchange summary
 */
export function calculateExchangeSummary(exchange: string, assetBalances: AssetBalance[]): {
  totalValue: number;
  cash: number;
  openPositions: number;
  totalFees: number;
  plPercent: number;
} {
  const assets = assetBalances.filter(a => a.exchange === exchange);
  
  const totalValue = assets.reduce((sum, a) => sum + a.current_value, 0);
  const cash = assets
    .filter(a => CASH_TICKERS.includes(a.ticker))
    .reduce((sum, a) => sum + a.current_value, 0);
  const openPositions = assets.filter(a => !CASH_TICKERS.includes(a.ticker)).length;
  const totalFees = assets.reduce((sum, a) => sum + a.total_fees, 0);
  
  const totalInvested = assets.reduce((sum, a) => sum + a.total_invested, 0);
  const totalPL = assets.reduce((sum, a) => sum + a.unrealized_pl, 0);
  const plPercent = totalInvested > 0 ? (totalPL / totalInvested) * 100 : 0;

  return {
    totalValue,
    cash,
    openPositions,
    totalFees,
    plPercent,
  };
}
