-- Move plan allowances still on the previous defaults to the new defaults; admin-customized values are kept.
UPDATE application_settings
SET value = value
  || CASE WHEN value->'eightWeeklyLimitMicros' = '3000000'::jsonb THEN '{"eightWeeklyLimitMicros":2500000}'::jsonb ELSE '{}'::jsonb END
  || CASE WHEN value->'fatWeeklyLimitMicros' = '4000000'::jsonb THEN '{"fatWeeklyLimitMicros":6500000}'::jsonb ELSE '{}'::jsonb END
  || CASE WHEN value->'fatFiveHourLimitMicros' = '1000000'::jsonb THEN '{"fatFiveHourLimitMicros":1500000}'::jsonb ELSE '{}'::jsonb END,
  updated_at = now()
WHERE key = 'billing' AND jsonb_typeof(value) = 'object';
