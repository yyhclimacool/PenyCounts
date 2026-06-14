-- Budgets and savings goals.
--
-- Budgets cap spending for a period. A NULL category_id is a "total" budget
-- across all expenses; otherwise it scopes to a single category. Actual spend
-- is computed on read from the transactions table, never stored.
--
-- Savings goals track progress toward a target amount, optionally with a
-- deadline. current_amount is maintained explicitly by the user.

CREATE TABLE IF NOT EXISTS budgets (
    id          UUID PRIMARY KEY,
    family_id   UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id UUID REFERENCES categories(id) ON DELETE CASCADE,
    amount      NUMERIC(15, 2) NOT NULL CHECK (amount >= 0),
    period      VARCHAR(10) NOT NULL DEFAULT 'monthly'
                CHECK (period IN ('monthly', 'yearly')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one budget per (family, category, period). The partial unique index
-- handles the NULL category_id ("total" budget) case, which a plain UNIQUE
-- constraint cannot enforce.
CREATE UNIQUE INDEX IF NOT EXISTS budgets_family_category_period_uq
    ON budgets (family_id, category_id, period)
    WHERE category_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS budgets_family_total_period_uq
    ON budgets (family_id, period)
    WHERE category_id IS NULL;

CREATE INDEX IF NOT EXISTS budgets_family_idx ON budgets (family_id);

CREATE TABLE IF NOT EXISTS savings_goals (
    id             UUID PRIMARY KEY,
    family_id      UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name           VARCHAR(100) NOT NULL,
    target_amount  NUMERIC(15, 2) NOT NULL CHECK (target_amount > 0),
    current_amount NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (current_amount >= 0),
    deadline       DATE,
    icon           VARCHAR(16) NOT NULL DEFAULT '🎯',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS savings_goals_family_idx ON savings_goals (family_id);
