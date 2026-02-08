-- =============================================
-- PORTFOLIO TRACKER - DATABASE SCHEMA
-- Supabase PostgreSQL
-- Ottimizzato per 2000+ transazioni
-- =============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- 1. WALLETS - STRUTTURA AD ALBERO
-- =============================================
CREATE TABLE wallets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Gerarchia
  name TEXT NOT NULL,
  parent_wallet_id UUID REFERENCES wallets(id) ON DELETE CASCADE,
  level INTEGER DEFAULT 0, -- 0=Portfolio root, 1=Main wallet, 2=Sub-wallet
  sort_order INTEGER DEFAULT 0,
  
  -- Allocazione
  target_allocation_percent DECIMAL(5,2), -- % target (es. 40.00)
  allocation_mode TEXT DEFAULT 'manual', -- 'manual' o 'auto'
  
  -- UI
  color TEXT DEFAULT '#3B82F6',
  icon TEXT DEFAULT '💼',
  
  -- Meta
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indici per performance
CREATE INDEX idx_wallets_user ON wallets(user_id);
CREATE INDEX idx_wallets_parent ON wallets(parent_wallet_id);
CREATE INDEX idx_wallets_level ON wallets(level);

-- =============================================
-- 2. TRANSACTIONS - TUTTI I MOVIMENTI
-- =============================================
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Dati base
  date TIMESTAMP WITH TIME ZONE NOT NULL,
  action TEXT NOT NULL, -- 'BUY', 'SELL', 'DEPOSIT', 'WITHDRAWAL', 'SWAP', 'AIRDROP'
  
  -- Asset principale
  ticker TEXT NOT NULL,
  type TEXT DEFAULT 'CRYPTO', -- 'CRYPTO', 'STOCK'
  quantity DECIMAL(20,10) NOT NULL,
  price DECIMAL(20,10) NOT NULL,
  price_currency TEXT DEFAULT 'USDT',
  
  -- Location
  wallet_id UUID REFERENCES wallets(id) ON DELETE SET NULL,
  exchange TEXT NOT NULL,
  
  -- SWAP specifico (Metodo B)
  from_ticker TEXT, -- Populated solo se action='SWAP'
  to_ticker TEXT,   -- Populated solo se action='SWAP'
  
  -- Fees
  fees DECIMAL(20,10) DEFAULT 0,
  fees_currency TEXT DEFAULT 'USDT',
  
  -- Trading avanzato
  direction TEXT, -- 'LONG', 'SHORT' (per futures)
  leverage DECIMAL(5,2),
  
  -- Import tracking
  import_batch_id UUID,
  exchange_transaction_id TEXT, -- ID originale da CSV exchange
  
  -- Meta
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_action CHECK (action IN ('BUY', 'SELL', 'DEPOSIT', 'WITHDRAWAL', 'SWAP', 'AIRDROP')),
  CONSTRAINT valid_type CHECK (type IN ('CRYPTO', 'STOCK')),
  CONSTRAINT positive_quantity CHECK (quantity > 0),
  CONSTRAINT non_negative_price CHECK (price >= 0),
  CONSTRAINT non_negative_fees CHECK (fees >= 0)
);

-- Indici CRITICI per performance (2000+ transactions)
CREATE INDEX idx_transactions_user ON transactions(user_id);
CREATE INDEX idx_transactions_date ON transactions(date DESC);
CREATE INDEX idx_transactions_ticker ON transactions(ticker);
CREATE INDEX idx_transactions_wallet ON transactions(wallet_id);
CREATE INDEX idx_transactions_action ON transactions(action);
CREATE INDEX idx_transactions_exchange ON transactions(exchange);
-- Indice composto per query comuni
CREATE INDEX idx_transactions_compound ON transactions(user_id, date DESC, ticker);
CREATE INDEX idx_transactions_user_wallet ON transactions(user_id, wallet_id, date DESC);

-- =============================================
-- 3. ASSETS - PREZZI CORRENTI
-- =============================================
CREATE TABLE assets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticker TEXT UNIQUE NOT NULL,
  name TEXT,
  type TEXT DEFAULT 'CRYPTO',
  current_price DECIMAL(20,10),
  last_updated TIMESTAMP WITH TIME ZONE,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_assets_ticker ON assets(ticker);
CREATE INDEX idx_assets_type ON assets(type);

-- =============================================
-- 4. IMPORT BATCHES - TRACKING CSV
-- =============================================
CREATE TABLE import_batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  source TEXT DEFAULT 'csv', -- 'csv', 'manual'
  filename TEXT,
  
  total_rows INTEGER,
  imported_count INTEGER DEFAULT 0,
  skipped_count INTEGER DEFAULT 0,
  
  status TEXT DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
  error_message TEXT,
  errors_detail JSONB, -- Array di errori dettagliati
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_import_batches_user ON import_batches(user_id);
CREATE INDEX idx_import_batches_status ON import_batches(status);

-- =============================================
-- 5. USER PREFERENCES
-- =============================================
CREATE TABLE user_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  
  default_currency TEXT DEFAULT 'USDT',
  default_exchange TEXT,
  theme TEXT DEFAULT 'light', -- 'light', 'dark', 'auto'
  items_per_page INTEGER DEFAULT 50,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================

-- Enable RLS on all tables
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- Wallets policies
CREATE POLICY "Users can view their own wallets"
  ON wallets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own wallets"
  ON wallets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own wallets"
  ON wallets FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own wallets"
  ON wallets FOR DELETE
  USING (auth.uid() = user_id);

-- Transactions policies
CREATE POLICY "Users can view their own transactions"
  ON transactions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own transactions"
  ON transactions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own transactions"
  ON transactions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own transactions"
  ON transactions FOR DELETE
  USING (auth.uid() = user_id);

-- Import batches policies
CREATE POLICY "Users can view their own import batches"
  ON import_batches FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own import batches"
  ON import_batches FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- User preferences policies
CREATE POLICY "Users can view their own preferences"
  ON user_preferences FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own preferences"
  ON user_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own preferences"
  ON user_preferences FOR UPDATE
  USING (auth.uid() = user_id);

-- Assets is public (everyone can read prices)
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view assets"
  ON assets FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Anyone can insert assets"
  ON assets FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Anyone can update assets"
  ON assets FOR UPDATE
  TO authenticated
  USING (true);

-- =============================================
-- FUNCTIONS & TRIGGERS
-- =============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_wallets_updated_at
  BEFORE UPDATE ON wallets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_transactions_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_preferences_updated_at
  BEFORE UPDATE ON user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- SAMPLE DATA (Optional - per testing)
-- =============================================

-- Uncomment to insert sample wallets
/*
INSERT INTO wallets (user_id, name, level, target_allocation_percent, allocation_mode)
VALUES 
  (auth.uid(), 'Portfolio Totale', 0, 100.00, 'manual'),
  (auth.uid(), 'Trading Wallet', 1, 60.00, 'manual'),
  (auth.uid(), 'HODL Wallet', 1, 40.00, 'manual');
*/

-- Uncomment to insert common stablecoin prices
/*
INSERT INTO assets (ticker, name, type, current_price, last_updated)
VALUES 
  ('USDT', 'Tether', 'CRYPTO', 1.00, NOW()),
  ('USDC', 'USD Coin', 'CRYPTO', 1.00, NOW()),
  ('DAI', 'Dai', 'CRYPTO', 1.00, NOW()),
  ('EUR', 'Euro', 'CRYPTO', 1.09, NOW()),
  ('USD', 'US Dollar', 'CRYPTO', 1.00, NOW());
*/

-- =============================================
-- VIEWS (Optional - for easier queries)
-- =============================================

-- View for wallet hierarchy with calculated allocation
CREATE OR REPLACE VIEW wallet_tree AS
WITH RECURSIVE wallet_hierarchy AS (
  -- Base case: root wallets
  SELECT 
    id,
    user_id,
    name,
    parent_wallet_id,
    level,
    sort_order,
    target_allocation_percent,
    allocation_mode,
    color,
    icon,
    ARRAY[id] as path,
    name as full_path
  FROM wallets
  WHERE parent_wallet_id IS NULL
  
  UNION ALL
  
  -- Recursive case: child wallets
  SELECT 
    w.id,
    w.user_id,
    w.name,
    w.parent_wallet_id,
    w.level,
    w.sort_order,
    w.target_allocation_percent,
    w.allocation_mode,
    w.color,
    w.icon,
    wh.path || w.id,
    wh.full_path || ' > ' || w.name
  FROM wallets w
  INNER JOIN wallet_hierarchy wh ON w.parent_wallet_id = wh.id
)
SELECT * FROM wallet_hierarchy
ORDER BY path, sort_order;

-- =============================================
-- PERFORMANCE TIPS
-- =============================================

/*
1. Usa EXPLAIN ANALYZE per query lente:
   EXPLAIN ANALYZE SELECT * FROM transactions WHERE user_id = 'xxx';

2. Monitora dimensione indici:
   SELECT schemaname, tablename, indexname, pg_size_pretty(pg_relation_size(indexrelid))
   FROM pg_indexes
   JOIN pg_class ON indexrelid = pg_class.oid
   ORDER BY pg_relation_size(indexrelid) DESC;

3. Vacuum regolare (Supabase fa automaticamente):
   VACUUM ANALYZE transactions;

4. Per query con molte JOIN, considera materializzare i risultati:
   CREATE MATERIALIZED VIEW portfolio_summary AS
   SELECT ... [query complessa]
   WITH DATA;
   
   REFRESH MATERIALIZED VIEW portfolio_summary;
*/
