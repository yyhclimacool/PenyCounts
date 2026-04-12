-- Composite indexes for common query patterns

-- Transactions: user_id + date DESC (most common list query)
CREATE INDEX IF NOT EXISTS idx_transactions_user_date
  ON transactions(user_id, date DESC);

-- Transactions: user_id + category_id (filter by category)
CREATE INDEX IF NOT EXISTS idx_transactions_user_category
  ON transactions(user_id, category_id);

-- Transactions: user_id + type + date (filter by income/expense)
CREATE INDEX IF NOT EXISTS idx_transactions_user_type_date
  ON transactions(user_id, type, date DESC);

-- Categories: system categories lookup (user_id IS NULL)
CREATE INDEX IF NOT EXISTS idx_categories_system
  ON categories(user_id) WHERE user_id IS NULL;

-- Subcategories: category_id + sort_order (ordered listing)
CREATE INDEX IF NOT EXISTS idx_subcategories_cat_sort
  ON subcategories(category_id, sort_order);

-- LLM configs: user_id + is_active (active config lookup)
CREATE INDEX IF NOT EXISTS idx_llm_configs_user_active
  ON llm_configs(user_id, is_active) WHERE is_active = true;

-- Chat messages: user_id + created_at DESC (recent messages)
CREATE INDEX IF NOT EXISTS idx_chat_messages_user_created
  ON chat_messages(user_id, created_at DESC);
