-- Fix members unique constraint to match family-scoped upserts.
-- The code uses ON CONFLICT (family_id, name); the old (user_id, name) index
-- no longer matches the multi-family design, causing import/insert failures.
DROP INDEX IF EXISTS idx_members_user_name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_members_family_name
  ON members(family_id, name);
