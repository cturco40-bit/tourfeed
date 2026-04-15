-- Browser push subscriptions for admin draft notifications
-- Written by save-push-subscription.js, read by send-push.js
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  subscription TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service manage push_subscriptions" ON push_subscriptions;
CREATE POLICY "Service manage push_subscriptions" ON push_subscriptions
  FOR ALL USING (true) WITH CHECK (true);
