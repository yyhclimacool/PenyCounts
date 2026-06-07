-- Add a system-default subcategory "日常买菜" under 餐饮美食 (user_id/family_id NULL).
-- Idempotent: fixed UUID + ON CONFLICT DO NOTHING so re-running is safe.

INSERT INTO subcategories (id, category_id, user_id, family_id, name, icon, sort_order)
VALUES (
    'b1000000-0000-4000-8000-000000000101'::uuid,
    'a1000000-0000-4000-8000-000000000001'::uuid, -- 餐饮美食
    NULL,
    NULL,
    '日常买菜',
    '🥬',
    7
)
ON CONFLICT (id) DO NOTHING;
