ALTER TABLE `users`
  ADD COLUMN `invite_code` VARCHAR(32) GENERATED ALWAYS AS (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.inviteCode')), '')) VIRTUAL,
  ADD UNIQUE KEY `uq_users_invite_code` (`invite_code`);

ALTER TABLE `points_ledger`
  ADD COLUMN `user_id` VARCHAR(191) GENERATED ALWAYS AS (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.userId')), '')) VIRTUAL,
  ADD KEY `idx_points_ledger_user_created` (`user_id`, `created_at`);

ALTER TABLE `idempotency_keys`
  ADD COLUMN `expires_at` BIGINT GENERATED ALWAYS AS (CAST(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.expiresAt')) AS SIGNED)) VIRTUAL,
  ADD KEY `idx_idempotency_keys_expires` (`expires_at`);

CREATE TABLE IF NOT EXISTS `rate_limits` (
  `id` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `data` JSON NOT NULL,
  `created_at` BIGINT NULL,
  `updated_at` BIGINT NULL,
  `expires_at` BIGINT GENERATED ALWAYS AS (CAST(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.expiresAt')) AS SIGNED)) VIRTUAL,
  PRIMARY KEY (`id`),
  KEY `idx_rate_limits_updated_at` (`updated_at`),
  KEY `idx_rate_limits_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
