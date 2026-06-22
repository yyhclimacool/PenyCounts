-- Archived AI financial reports.
--
-- One stored report per (family, period, year, month); regenerating the same
-- period overwrites the previous one. `month` is NULL for yearly reports, so the
-- uniqueness uses COALESCE(month, 0) to treat yearly rows consistently.

CREATE TABLE IF NOT EXISTS ai_reports (
    id          UUID PRIMARY KEY,
    family_id   UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    period      VARCHAR(10) NOT NULL CHECK (period IN ('monthly', 'yearly')),
    year        INT NOT NULL,
    month       INT CHECK (month BETWEEN 1 AND 12),
    content     TEXT NOT NULL,
    model_name  VARCHAR(255),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_reports_family_period_uq
    ON ai_reports (family_id, period, year, COALESCE(month, 0));

CREATE INDEX IF NOT EXISTS ai_reports_family_created_idx
    ON ai_reports (family_id, created_at DESC);
