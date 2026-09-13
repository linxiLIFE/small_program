-- 四个小姐姐的店 CloudBase MySQL schema
--
-- 每个业务对象使用一张 InnoDB 表，data 保存该对象的 JSON 结构，id、created_at、updated_at
-- 作为 SQL 层的主键和基础索引。这样既使用 MySQL 事务，又保留服务端订单快照、排班数组等
-- 嵌套结构；所有读写仍只能从云函数进入，客户端不直连数据库。

CREATE TABLE IF NOT EXISTS `users` (
  `id` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `data` JSON NOT NULL,
  `created_at` BIGINT NULL,
  `updated_at` BIGINT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_users_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `staff_accounts` (
  `id` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `data` JSON NOT NULL,
  `created_at` BIGINT NULL,
  `updated_at` BIGINT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_staff_accounts_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `categories` (
  `id` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `data` JSON NOT NULL,
  `created_at` BIGINT NULL,
  `updated_at` BIGINT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_categories_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `services` (
  `id` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `data` JSON NOT NULL,
  `created_at` BIGINT NULL,
  `updated_at` BIGINT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_services_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `works` (
  `id` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `data` JSON NOT NULL,
  `created_at` BIGINT NULL,
  `updated_at` BIGINT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_works_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `technicians` (
  `id` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `data` JSON NOT NULL,
  `created_at` BIGINT NULL,
  `updated_at` BIGINT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_technicians_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `schedule_templates` (
  `id` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `data` JSON NOT NULL,
  `created_at` BIGINT NULL,
  `updated_at` BIGINT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_schedule_templates_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `technician_days` (
  `id` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `data` JSON NOT NULL,
  `created_at` BIGINT NULL,
  `updated_at` BIGINT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_technician_days_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `orders` (
  `id` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `data` JSON NOT NULL,
  `created_at` BIGINT NULL,
  `updated_at` BIGINT NULL,
  `user_id` VARCHAR(191) GENERATED ALWAYS AS (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.userId')), '')) VIRTUAL,
  `status` VARCHAR(32) GENERATED ALWAYS AS (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.status')), '')) VIRTUAL,
  `payment_status` VARCHAR(32) GENERATED ALWAYS AS (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.paymentStatus')), '')) VIRTUAL,
  `refund_status` VARCHAR(32) GENERATED ALWAYS AS (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.refundStatus')), '')) VIRTUAL,
  `technician_id` VARCHAR(191) GENERATED ALWAYS AS (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.technicianId')), '')) VIRTUAL,
  `booking_date` VARCHAR(10) GENERATED ALWAYS AS (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.date')), '')) VIRTUAL,
  `start_at` BIGINT GENERATED ALWAYS AS (CAST(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.startAt')) AS SIGNED)) VIRTUAL,
  PRIMARY KEY (`id`),
  KEY `idx_orders_created_at` (`created_at`),
  KEY `idx_orders_user_status` (`user_id`, `status`),
  KEY `idx_orders_technician_start` (`technician_id`, `start_at`),
  KEY `idx_orders_technician_date` (`technician_id`, `booking_date`, `start_at`),
  KEY `idx_orders_payment_status` (`payment_status`),
  KEY `idx_orders_refund_status` (`refund_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `payments` (
  `id` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `data` JSON NOT NULL,
  `created_at` BIGINT NULL,
  `updated_at` BIGINT NULL,
  `order_id` VARCHAR(191) GENERATED ALWAYS AS (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.orderId')), '')) VIRTUAL,
  `merchant_order_no` VARCHAR(64) GENERATED ALWAYS AS (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.merchantOrderNo')), '')) VIRTUAL,
  `transaction_id` VARCHAR(64) GENERATED ALWAYS AS (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.transactionId')), '')) VIRTUAL,
  `status` VARCHAR(32) GENERATED ALWAYS AS (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.status')), '')) VIRTUAL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_payments_merchant_order_no` (`merchant_order_no`),
  UNIQUE KEY `uq_payments_transaction_id` (`transaction_id`),
  KEY `idx_payments_order_id` (`order_id`),
  KEY `idx_payments_status` (`status`),
  KEY `idx_payments_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `refunds` (
  `id` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `data` JSON NOT NULL,
  `created_at` BIGINT NULL,
  `updated_at` BIGINT NULL,
  `order_id` VARCHAR(191) GENERATED ALWAYS AS (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.orderId')), '')) VIRTUAL,
  `refund_no` VARCHAR(64) GENERATED ALWAYS AS (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.refundNo')), '')) VIRTUAL,
  `status` VARCHAR(32) GENERATED ALWAYS AS (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.status')), '')) VIRTUAL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_refunds_refund_no` (`refund_no`),
  KEY `idx_refunds_order_id` (`order_id`),
  KEY `idx_refunds_status` (`status`),
  KEY `idx_refunds_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `points_accounts` (
  `id` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `data` JSON NOT NULL,
  `created_at` BIGINT NULL,
  `updated_at` BIGINT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_points_accounts_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `points_ledger` (
  `id` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `data` JSON NOT NULL,
  `created_at` BIGINT NULL,
  `updated_at` BIGINT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_points_ledger_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `jobs` (
  `id` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `data` JSON NOT NULL,
  `created_at` BIGINT NULL,
  `updated_at` BIGINT NULL,
  `type` VARCHAR(32) GENERATED ALWAYS AS (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.type')), '')) VIRTUAL,
  `status` VARCHAR(32) GENERATED ALWAYS AS (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.status')), '')) VIRTUAL,
  `next_run_at` BIGINT GENERATED ALWAYS AS (CAST(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.nextRunAt')) AS SIGNED)) VIRTUAL,
  `lease_until` BIGINT GENERATED ALWAYS AS (CAST(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.leaseUntil')) AS SIGNED)) VIRTUAL,
  PRIMARY KEY (`id`),
  KEY `idx_jobs_due` (`status`, `next_run_at`),
  KEY `idx_jobs_lease` (`status`, `lease_until`),
  KEY `idx_jobs_type` (`type`),
  KEY `idx_jobs_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `notification_records` (
  `id` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `data` JSON NOT NULL,
  `created_at` BIGINT NULL,
  `updated_at` BIGINT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_notification_records_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `data` JSON NOT NULL,
  `created_at` BIGINT NULL,
  `updated_at` BIGINT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_audit_logs_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `daily_metrics` (
  `id` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `data` JSON NOT NULL,
  `created_at` BIGINT NULL,
  `updated_at` BIGINT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_daily_metrics_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `settings_versions` (
  `id` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `data` JSON NOT NULL,
  `created_at` BIGINT NULL,
  `updated_at` BIGINT NULL,
  `version_num` BIGINT GENERATED ALWAYS AS (CAST(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.version')) AS SIGNED)) VIRTUAL,
  PRIMARY KEY (`id`),
  KEY `idx_settings_versions_version` (`version_num`),
  KEY `idx_settings_versions_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `idempotency_keys` (
  `id` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `data` JSON NOT NULL,
  `created_at` BIGINT NULL,
  `updated_at` BIGINT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_idempotency_keys_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
