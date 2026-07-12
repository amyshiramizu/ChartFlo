-- Sync per-user data that previously lived only in browser localStorage,
-- so chart-related settings follow the user across computers and devices.
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS template_overrides jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '{}';
