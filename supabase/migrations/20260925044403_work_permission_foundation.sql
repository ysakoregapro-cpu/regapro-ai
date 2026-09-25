-- Integrated Work Permission / Module Foundation.
-- Seeds Feature Permission keys and platform role templates only.
-- No Shift / Work Record / Weekly Pay / bank / payment transaction tables.
--
-- Existing weekly_pay.submit and weekly_pay.manage keep their meaning.
-- New keys are inserted; collisions are ignored. No destructive UPDATE.
--
-- Do not apply to a linked project without review.

INSERT INTO public.permissions (key, label)
VALUES
  ('weekly_pay.review', '週払いを確認する'),
  ('weekly_pay.pay', '週払いを支払う'),
  ('weekly_pay.policy_manage', '週払い方針を管理する'),
  ('shift.view_own', '自分のシフトを見る'),
  ('shift.request', 'シフト希望を出す'),
  ('shift.manage', 'シフトを管理する'),
  ('documents.use', '書類を使う'),
  ('documents.manage', '書類を管理する')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.roles (org_id, key, label)
SELECT NULL, v.key, v.label
FROM (
  VALUES
    ('platform_weekly_pay_reviewer', '週払い確認'),
    ('platform_weekly_pay_payer', '週払い支払'),
    ('platform_weekly_pay_policy_manager', '週払い方針管理'),
    ('platform_shift_user', 'シフト利用'),
    ('platform_shift_manager', 'シフト管理')
) AS v(key, label)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.roles r
  WHERE r.org_id IS NULL
    AND r.key = v.key
    AND r.deleted_at IS NULL
);

CREATE OR REPLACE FUNCTION public.regapro_seed_platform_role(
  p_role_key text,
  p_permission_keys text[]
)
RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM public.roles r
  JOIN public.permissions p
    ON p.key = ANY (p_permission_keys)
   AND p.deleted_at IS NULL
  WHERE r.org_id IS NULL
    AND r.key = p_role_key
    AND r.deleted_at IS NULL
  ON CONFLICT (role_id, permission_id) DO NOTHING;
$$;

-- Existing templates: submitter = submit only; manager = submit + manage.
-- Review / pay / policy stay on separate roles. Do not collapse them.
SELECT public.regapro_seed_platform_role(
  'platform_weekly_pay_submitter',
  ARRAY['weekly_pay.submit']
);
SELECT public.regapro_seed_platform_role(
  'platform_weekly_pay_manager',
  ARRAY['weekly_pay.submit', 'weekly_pay.manage']
);
SELECT public.regapro_seed_platform_role(
  'platform_weekly_pay_reviewer',
  ARRAY['weekly_pay.review']
);
SELECT public.regapro_seed_platform_role(
  'platform_weekly_pay_payer',
  ARRAY['weekly_pay.pay']
);
SELECT public.regapro_seed_platform_role(
  'platform_weekly_pay_policy_manager',
  ARRAY['weekly_pay.policy_manage']
);
SELECT public.regapro_seed_platform_role(
  'platform_shift_user',
  ARRAY['shift.view_own', 'shift.request']
);
SELECT public.regapro_seed_platform_role(
  'platform_shift_manager',
  ARRAY['shift.manage']
);
SELECT public.regapro_seed_platform_role(
  'platform_admin',
  ARRAY[
    'weekly_pay.submit',
    'weekly_pay.review',
    'weekly_pay.pay',
    'weekly_pay.manage',
    'weekly_pay.policy_manage',
    'shift.view_own',
    'shift.request',
    'shift.manage',
    'documents.use',
    'documents.manage'
  ]
);

DROP FUNCTION public.regapro_seed_platform_role(text, text[]);
