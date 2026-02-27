-- Migration 028: Remove unused rate limiting system (migration 007, never wired up)

DROP TABLE IF EXISTS platform_api_keys CASCADE;
DROP TABLE IF EXISTS user_daily_usage CASCADE;
DROP TABLE IF EXISTS tier_limits CASCADE;
DROP FUNCTION IF EXISTS get_or_create_daily_usage(TEXT, TEXT);
DROP FUNCTION IF EXISTS can_send_message(TEXT, TEXT);
DROP FUNCTION IF EXISTS increment_usage(TEXT, TEXT, INTEGER);
DROP FUNCTION IF EXISTS get_platform_key(TEXT);
DROP FUNCTION IF EXISTS record_platform_key_usage(TEXT);
DROP FUNCTION IF EXISTS reset_daily_platform_keys();
