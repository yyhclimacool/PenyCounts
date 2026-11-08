-- Link a 人情 record to the ledger transaction it was booked as.
--
-- The 人情 statistics (人情分析 tab, 人情往来 page summary) are computed from
-- transactions in the 人情往来 / 人情收入 categories, with the counterpart stored
-- as a transaction member. social_gifts keeps the structured details (occasion,
-- relation). When a gift is booked through the AI it creates both rows; this
-- column ties them together so edits/deletes stay in sync.
--
-- Deleting the ledger entry removes its 人情 record as well: the transaction is
-- the source of truth for amounts. Gifts entered manually on the 人情往来 page
-- keep transaction_id NULL and are unaffected.

ALTER TABLE social_gifts
    ADD COLUMN IF NOT EXISTS transaction_id UUID REFERENCES transactions(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS social_gifts_transaction_uq
    ON social_gifts (transaction_id)
    WHERE transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_social_gifts_family_date
    ON social_gifts (family_id, date DESC);
