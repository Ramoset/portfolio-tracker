// =============================================
// DATABASE TYPES
// =============================================

export interface Database {
  public: {
    Tables: {
      wallets: {
        Row: Wallet;
        Insert: Omit<Wallet, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Wallet, 'id' | 'created_at' | 'updated_at'>>;
      };
      transactions: {
        Row: Transaction;
        Insert: Omit<Transaction, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Transaction, 'id' | 'created_at' | 'updated_at'>>;
      };
      assets: {
        Row: Asset;
        Insert: Omit<Asset, 'id' | 'created_at'>;
        Update: Partial<Omit<Asset, 'id' | 'created_at'>>;
      };
      import_batches: {
        Row: ImportBatch;
        Insert: Omit<ImportBatch, 'id' | 'created_at'>;
        Update: Partial<Omit<ImportBatch, 'id' | 'created_at'>>;
      };
      user_preferences: {
        Row: UserPreferences;
        Insert: Omit<UserPreferences, 'created_at' | 'updated_at'>;
        Update: Partial<Omit<UserPreferences, 'user_id' | 'created_at' | 'updated_at'>>;
      };
    };
  };
}

// =============================================
// ENTITY TYPES
// =============================================

export interface Wallet {
  id: string;
  user_id: string;
  name: string;
  parent_wallet_id: string | null;
  level: number;
  sort_order: number;
  target_allocation_percent: number | null;
  allocation_mode: 'manual' | 'auto';
  color: string;
  icon: string;
  created_at: string;
  updated_at: string;
}

export type TransactionAction = 
  | 'BUY' 
  | 'SELL' 
  | 'DEPOSIT' 
  | 'WITHDRAWAL' 
  | 'SWAP' 
  | 'AIRDROP';

export type AssetType = 'CRYPTO' | 'STOCK';

export interface Transaction {
  id: string;
  user_id: string;
  date: string;
  action: TransactionAction;
  ticker: string;
  type: AssetType;
  quantity: number;
  price: number;
  price_currency: string;
  wallet_id: string | null;
  exchange: string;
  from_ticker: string | null;
  to_ticker: string | null;
  fees: number;
  fees_currency: string;
  direction: 'LONG' | 'SHORT' | null;
  leverage: number | null;
  import_batch_id: string | null;
  exchange_transaction_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Asset {
  id: string;
  ticker: string;
  name: string | null;
  type: AssetType;
  current_price: number | null;
  last_updated: string | null;
  created_at: string;
}

export interface ImportBatch {
  id: string;
  user_id: string;
  source: string;
  filename: string | null;
  total_rows: number | null;
  imported_count: number;
  skipped_count: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error_message: string | null;
  errors_detail: any | null;
  created_at: string;
}

export interface UserPreferences {
  user_id: string;
  default_currency: string;
  default_exchange: string | null;
  theme: 'light' | 'dark' | 'auto';
  items_per_page: number;
  created_at: string;
  updated_at: string;
}

// =============================================
// CALCULATED TYPES (for frontend)
// =============================================

export interface WalletWithAllocation extends Wallet {
  current_allocation_percent: number;
  allocation_diff: number;
  needs_rebalance: boolean;
  current_value: number;
  children?: WalletWithAllocation[];
}

export interface AssetBalance {
  ticker: string;
  type: AssetType;
  wallet_id: string | null;
  wallet_name: string | null;
  exchange: string;
  balance: number;
  avg_entry_price: number;
  current_price: number;
  current_value: number;
  total_invested: number;
  unrealized_pl: number;
  unrealized_pl_percent: number;
  total_fees: number;
}

export interface PortfolioSummary {
  total_value: number;
  total_cash: number;
  total_invested: number;
  unrealized_pl: number;
  unrealized_pl_percent: number;
  realized_pl: number;
  total_fees: number;
  total_fees_cash: number;
  total_fees_token: Record<string, number>;
  asset_count: number;
  exchange_count: number;
}

export interface TransactionWithDetails extends Transaction {
  wallet_name?: string;
  asset_name?: string;
}

// =============================================
// FORM TYPES
// =============================================

export interface TransactionFormData {
  date: string;
  action: TransactionAction;
  ticker: string;
  type: AssetType;
  quantity: number;
  price: number;
  price_currency: string;
  wallet_id: string | null;
  exchange: string;
  from_ticker?: string;
  to_ticker?: string;
  fees: number;
  fees_currency: string;
  direction?: 'LONG' | 'SHORT' | null;
  leverage?: number | null;
  notes?: string;
}

export interface WalletFormData {
  name: string;
  parent_wallet_id: string | null;
  level: number;
  target_allocation_percent: number | null;
  allocation_mode: 'manual' | 'auto';
  color: string;
  icon: string;
}

// =============================================
// CSV IMPORT TYPES
// =============================================

export interface CSVRow {
  date: string;
  action: string;
  ticker: string;
  type?: string;
  wallet?: string;
  exchange: string;
  quantity: string;
  price: string;
  direction?: string;
  leverage?: string;
  currency: string;
  fees?: string;
  notes?: string;
}

export interface ImportResult {
  batch_id: string;
  total: number;
  imported: number;
  skipped: number;
  errors: Array<{
    row: number;
    message: string;
  }>;
}

// =============================================
// CHART DATA TYPES
// =============================================

export interface ChartDataPoint {
  date: string;
  value: number;
  label?: string;
}

export interface AllocationChartData {
  name: string;
  value: number;
  color: string;
  percent: number;
}

export interface PerformanceChartData {
  ticker: string;
  pl_percent: number;
  pl_amount: number;
  color: string;
}
