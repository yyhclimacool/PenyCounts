-- Create families table
CREATE TABLE IF NOT EXISTS families (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    invite_code VARCHAR(20) NOT NULL UNIQUE,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_families_invite_code ON families(invite_code);

-- Create family_members table
CREATE TABLE IF NOT EXISTS family_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(family_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_family_members_family_id ON family_members(family_id);
CREATE INDEX IF NOT EXISTS idx_family_members_user_id ON family_members(user_id);

-- Add default_family_id to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_family_id UUID REFERENCES families(id);

-- Add family_id to data tables
ALTER TABLE categories ADD COLUMN IF NOT EXISTS family_id UUID REFERENCES families(id);
ALTER TABLE subcategories ADD COLUMN IF NOT EXISTS family_id UUID REFERENCES families(id);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS family_id UUID REFERENCES families(id);
ALTER TABLE members ADD COLUMN IF NOT EXISTS family_id UUID REFERENCES families(id);
ALTER TABLE social_gifts ADD COLUMN IF NOT EXISTS family_id UUID REFERENCES families(id);
ALTER TABLE llm_configs ADD COLUMN IF NOT EXISTS family_id UUID REFERENCES families(id);
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS family_id UUID REFERENCES families(id);

-- Create a default family for each existing user and migrate their data
DO $$
DECLARE
    u RECORD;
    fam_id UUID;
    code TEXT;
BEGIN
    FOR u IN SELECT id FROM users LOOP
        code := substr(md5(random()::text), 1, 8);
        INSERT INTO families (id, name, invite_code, created_by)
        VALUES (uuid_generate_v4(), '我的家庭', code, u.id)
        RETURNING id INTO fam_id;

        INSERT INTO family_members (family_id, user_id, role)
        VALUES (fam_id, u.id, 'owner');

        UPDATE users SET default_family_id = fam_id WHERE id = u.id;

        UPDATE categories SET family_id = fam_id WHERE user_id = u.id AND family_id IS NULL;
        UPDATE subcategories SET family_id = fam_id WHERE user_id = u.id AND family_id IS NULL;
        UPDATE transactions SET family_id = fam_id WHERE user_id = u.id AND family_id IS NULL;
        UPDATE members SET family_id = fam_id WHERE user_id = u.id AND family_id IS NULL;
        UPDATE social_gifts SET family_id = fam_id WHERE user_id = u.id AND family_id IS NULL;
        UPDATE llm_configs SET family_id = fam_id WHERE user_id = u.id AND family_id IS NULL;
        UPDATE chat_messages SET family_id = fam_id WHERE user_id = u.id AND family_id IS NULL;
    END LOOP;
END $$;
