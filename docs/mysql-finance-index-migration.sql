-- 资金与任务表并发索引迁移（已有数据库执行一次）。
-- 新建环境直接执行 mysql-schema.sql 即可，不需要再执行本文件。

ALTER TABLE `orders`
  ADD COLUMN `user_id` VARCHAR(191) GENERATED ALWAYS AS (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.userId')), '')) VIRTUAL,
  ADD COLUMN `status` VARCHAR(32) GENERATED ALWAYS AS (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.status')), '')) VIRTUAL,
  ADD COLUMN `payment_status` VARCHAR(32) GENERATED ALWAYS AS (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.paymentStatus')), '')) VIRTUAL,
  ADD COLUMN `refund_status` VARCHAR(32) GENERATED ALWAYS AS (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.refundStatus')), '')) VIRTUAL,
  ADD COLUMN `technician_id` VARCHAR(191) GENERATED ALWAYS AS (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.technicianId')), '')) VIRTUAL,
  ADD COLUMN `start_at` BIGINT GENERATED ALWAYS AS (CAST(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.startAt')) AS SIGNED)) VIRTUAL,
  ADD INDEX `idx_orders_user_status` (`user_id`, `status`),
  ADD INDEX `idx_orders_technician_start` (`technician_id`, `start_at`),
  ADD INDEX `idx_orders_payment_status` (`payment_status`),
  ADD INDEX `idx_orders_refund_status` (`refund_status`);

ALTER TABLE `payments`
  ADD COLUMN `order_id` VARCHAR(191) GENERATED ALWAYS AS (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.orderId')), '')) VIRTUAL,
  ADD COLUMN `merchant_order_no` VARCHAR(64) GENERATED ALWAYS AS (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.merchantOrderNo')), '')) VIRTUAL,
  ADD COLUMN `transaction_id` VARCHAR(64) GENERATED ALWAYS AS (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.transactionId')), '')) VIRTUAL,
  ADD COLUMN `status` VARCHAR(32) GENERATED ALWAYS AS (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.status')), '')) VIRTUAL,
  ADD UNIQUE INDEX `uq_payments_merchant_order_no` (`merchant_order_no`),
  ADD UNIQUE INDEX `uq_payments_transaction_id` (`transaction_id`),
  ADD INDEX `idx_payments_order_id` (`order_id`),
  ADD INDEX `idx_payments_status` (`status`);

ALTER TABLE `refunds`
  ADD COLUMN `order_id` VARCHAR(191) GENERATED ALWAYS AS (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.orderId')), '')) VIRTUAL,
  ADD COLUMN `refund_no` VARCHAR(64) GENERATED ALWAYS AS (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.refundNo')), '')) VIRTUAL,
  ADD COLUMN `status` VARCHAR(32) GENERATED ALWAYS AS (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.status')), '')) VIRTUAL,
  ADD UNIQUE INDEX `uq_refunds_refund_no` (`refund_no`),
  ADD INDEX `idx_refunds_order_id` (`order_id`),
  ADD INDEX `idx_refunds_status` (`status`);

ALTER TABLE `jobs`
  ADD COLUMN `type` VARCHAR(32) GENERATED ALWAYS AS (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.type')), '')) VIRTUAL,
  ADD COLUMN `status` VARCHAR(32) GENERATED ALWAYS AS (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.status')), '')) VIRTUAL,
  ADD COLUMN `next_run_at` BIGINT GENERATED ALWAYS AS (CAST(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.nextRunAt')) AS SIGNED)) VIRTUAL,
  ADD COLUMN `lease_until` BIGINT GENERATED ALWAYS AS (CAST(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.leaseUntil')) AS SIGNED)) VIRTUAL,
  ADD INDEX `idx_jobs_due` (`status`, `next_run_at`),
  ADD INDEX `idx_jobs_lease` (`status`, `lease_until`),
  ADD INDEX `idx_jobs_type` (`type`);
