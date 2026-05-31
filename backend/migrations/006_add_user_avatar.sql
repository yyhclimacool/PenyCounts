-- Add avatar_url column to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
