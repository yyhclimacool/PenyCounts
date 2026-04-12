-- Add unique constraint on (user_id, name) to support upsert
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_user_name
  ON members(user_id, name);
