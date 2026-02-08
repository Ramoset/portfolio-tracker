// =============================================
// CONSTANTS
// =============================================

export const CASH_TICKERS = ['USD', 'EUR', 'USDT', 'USDC', 'DAI', 'BUSD', 'TUSD'];

export const TRANSACTION_ACTIONS = [
  { value: 'BUY', label: 'Buy', color: 'green' },
  { value: 'SELL', label: 'Sell', color: 'red' },
  { value: 'DEPOSIT', label: 'Deposit', color: 'blue' },
  { value: 'WITHDRAWAL', label: 'Withdrawal', color: 'orange' },
  { value: 'SWAP', label: 'Swap', color: 'purple' },
  { value: 'AIRDROP', label: 'Airdrop', color: 'pink' },
] as const;

export const ASSET_TYPES = [
  { value: 'CRYPTO', label: 'Cryptocurrency' },
  { value: 'STOCK', label: 'Stock' },
] as const;

export const WALLET_ICONS = [
  '💼', '🏦', '💰', '🎯', '📊', '🔒', '🌐', '⚡',
  '🔥', '💎', '🚀', '⭐', '🎨', '🎭', '🎪', '🎲',
];

export const WALLET_COLORS = [
  '#3B82F6', // blue
  '#10B981', // green
  '#F59E0B', // yellow
  '#EF4444', // red
  '#8B5CF6', // purple
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#84CC16', // lime
];

export const CURRENCY_OPTIONS = [
  'USD', 'EUR', 'USDT', 'USDC', 'DAI',
  'BTC', 'ETH', 'BNB', 'SOL', 'ADA',
];

// =============================================
// UTILITY FUNCTIONS
// =============================================

/**
 * Format number as currency
 */
export function formatCurrency(
  value: number,
  currency: string = 'USD',
  decimals: number = 2
): string {
  if (CASH_TICKERS.includes(currency)) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency === 'USDT' || currency === 'USDC' ? 'USD' : currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  }
  
  // For crypto, show more decimals
  return `${value.toFixed(decimals > 2 ? decimals : 8)} ${currency}`;
}

/**
 * Format number as percentage
 */
export function formatPercent(value: number, decimals: number = 2): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}%`;
}

/**
 * Format large numbers (1.2M, 1.5K, etc)
 */
export function formatCompact(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toFixed(2);
}

/**
 * Format date
 */
export function formatDate(date: string | Date, format: 'short' | 'long' = 'short'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  
  if (format === 'long') {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  }
  
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(d);
}

/**
 * Get color for P&L value
 */
export function getPLColor(value: number): string {
  if (value > 0) return 'text-green-600';
  if (value < 0) return 'text-red-600';
  return 'text-gray-600';
}

/**
 * Get background color for P&L value
 */
export function getPLBgColor(value: number): string {
  if (value > 0) return 'bg-green-50 dark:bg-green-900/20';
  if (value < 0) return 'bg-red-50 dark:bg-red-900/20';
  return 'bg-gray-50 dark:bg-gray-900/20';
}

/**
 * Validate ticker format
 */
export function isValidTicker(ticker: string): boolean {
  return /^[A-Z0-9]{1,10}$/.test(ticker);
}

/**
 * Clean ticker (uppercase, remove special chars)
 */
export function cleanTicker(ticker: string): string {
  return ticker.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Check if asset is stablecoin/cash
 */
export function isCashAsset(ticker: string): boolean {
  return CASH_TICKERS.includes(ticker);
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * Deep clone object
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Group array by key
 */
export function groupBy<T>(array: T[], key: keyof T): Record<string, T[]> {
  return array.reduce((result, item) => {
    const group = String(item[key]);
    if (!result[group]) {
      result[group] = [];
    }
    result[group].push(item);
    return result;
  }, {} as Record<string, T[]>);
}

/**
 * Sort array by multiple keys
 */
export function sortBy<T>(array: T[], ...keys: (keyof T)[]): T[] {
  return [...array].sort((a, b) => {
    for (const key of keys) {
      const aVal = a[key];
      const bVal = b[key];
      
      if (aVal < bVal) return -1;
      if (aVal > bVal) return 1;
    }
    return 0;
  });
}

/**
 * Calculate percentage change
 */
export function calculatePercentChange(oldValue: number, newValue: number): number {
  if (oldValue === 0) return 0;
  return ((newValue - oldValue) / oldValue) * 100;
}

/**
 * Clamp number between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Generate unique ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Sleep/delay
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Round to decimals
 */
export function roundTo(value: number, decimals: number): number {
  const multiplier = Math.pow(10, decimals);
  return Math.round(value * multiplier) / multiplier;
}

/**
 * Check if two dates are same day
 */
export function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

/**
 * Get date range for filters
 */
export function getDateRange(period: '7d' | '30d' | '90d' | '1y' | 'all'): { from: Date | null; to: Date } {
  const to = new Date();
  let from: Date | null = null;
  
  switch (period) {
    case '7d':
      from = new Date(to);
      from.setDate(from.getDate() - 7);
      break;
    case '30d':
      from = new Date(to);
      from.setDate(from.getDate() - 30);
      break;
    case '90d':
      from = new Date(to);
      from.setDate(from.getDate() - 90);
      break;
    case '1y':
      from = new Date(to);
      from.setFullYear(from.getFullYear() - 1);
      break;
    case 'all':
      from = null;
      break;
  }
  
  return { from, to };
}
