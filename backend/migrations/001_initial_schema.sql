-- PenyCounts initial schema (consolidated).
-- Represents the final multi-family schema in a single migration.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users -----------------------------------------------------------------
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    nickname VARCHAR(100) NOT NULL,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    verification_token VARCHAR(255),
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Families (multi-tenancy) ----------------------------------------------
CREATE TABLE families (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    invite_code VARCHAR(20) NOT NULL UNIQUE,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE family_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (family_id, user_id)
);

-- users.default_family_id needs families to exist first (circular FK).
ALTER TABLE users ADD COLUMN default_family_id UUID REFERENCES families(id);

-- Categories (一级) / Subcategories (二级) ------------------------------
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    family_id UUID REFERENCES families(id),
    name VARCHAR(100) NOT NULL,
    type VARCHAR(10) NOT NULL CHECK (type IN ('income', 'expense')),
    icon VARCHAR(50) NOT NULL DEFAULT '📦',
    sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE subcategories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    family_id UUID REFERENCES families(id),
    name VARCHAR(100) NOT NULL,
    icon VARCHAR(50) NOT NULL DEFAULT '📎',
    sort_order INT NOT NULL DEFAULT 0
);

-- Transactions ----------------------------------------------------------
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    family_id UUID REFERENCES families(id),
    category_id UUID NOT NULL REFERENCES categories(id),
    subcategory_id UUID REFERENCES subcategories(id),
    type VARCHAR(10) NOT NULL CHECK (type IN ('income', 'expense')),
    amount NUMERIC(15, 2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'CNY',
    date DATE NOT NULL,
    time TIME NOT NULL DEFAULT '00:00:00',
    location VARCHAR(255),
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE transaction_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    member_name VARCHAR(100) NOT NULL,
    share_amount NUMERIC(15, 2) NOT NULL
);

-- Members (常用成员) ----------------------------------------------------
CREATE TABLE members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    family_id UUID REFERENCES families(id),
    name VARCHAR(100) NOT NULL
);

-- Social gifts (人情往来) -----------------------------------------------
CREATE TABLE social_gifts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    family_id UUID REFERENCES families(id),
    type VARCHAR(10) NOT NULL CHECK (type IN ('give', 'receive')),
    person_name VARCHAR(100) NOT NULL,
    relation VARCHAR(100),
    occasion VARCHAR(255) NOT NULL,
    amount NUMERIC(15, 2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'CNY',
    date DATE NOT NULL,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- LLM configs / Chat messages -------------------------------------------
CREATE TABLE llm_configs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    family_id UUID REFERENCES families(id),
    provider VARCHAR(50) NOT NULL,
    api_url VARCHAR(500) NOT NULL,
    api_key VARCHAR(500),
    model_name VARCHAR(100) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE chat_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    family_id UUID REFERENCES families(id),
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes ---------------------------------------------------------------
-- Families
CREATE INDEX idx_families_invite_code ON families(invite_code);
CREATE INDEX idx_family_members_family_id ON family_members(family_id);
CREATE INDEX idx_family_members_user_id ON family_members(user_id);

-- Categories / subcategories
CREATE INDEX idx_categories_user_id ON categories(user_id);
CREATE INDEX idx_categories_system ON categories(user_id) WHERE user_id IS NULL;
CREATE INDEX idx_subcategories_category_id ON subcategories(category_id);
CREATE INDEX idx_subcategories_cat_sort ON subcategories(category_id, sort_order);

-- Transactions (composite indexes cover the common single-column lookups)
CREATE INDEX idx_transactions_user_date ON transactions(user_id, date DESC);
CREATE INDEX idx_transactions_user_category ON transactions(user_id, category_id);
CREATE INDEX idx_transactions_user_type_date ON transactions(user_id, type, date DESC);
CREATE INDEX idx_transactions_date ON transactions(date);
CREATE INDEX idx_transaction_members_transaction_id ON transaction_members(transaction_id);

-- Members (family-scoped uniqueness for upserts)
CREATE INDEX idx_members_user_id ON members(user_id);
CREATE UNIQUE INDEX idx_members_family_name ON members(family_id, name);

-- Social gifts
CREATE INDEX idx_social_gifts_user_id ON social_gifts(user_id);
CREATE INDEX idx_social_gifts_date ON social_gifts(date);

-- LLM configs / chat
CREATE INDEX idx_llm_configs_user_active ON llm_configs(user_id, is_active) WHERE is_active = TRUE;
CREATE INDEX idx_chat_messages_user_created ON chat_messages(user_id, created_at DESC);
