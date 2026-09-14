-- 经营统计与首页热门款式索引迁移（已有数据库执行一次）。
-- 新建环境直接执行 mysql-schema.sql，不需要再执行本文件。

ALTER TABLE `orders`
  ADD COLUMN `work_id` VARCHAR(191) GENERATED ALWAYS AS (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.workSnapshot.id')), '')) VIRTUAL,
  ADD COLUMN `paid_at` BIGINT GENERATED ALWAYS AS (CAST(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.paidAt')) AS SIGNED)) VIRTUAL,
  ADD COLUMN `completed_at` BIGINT GENERATED ALWAYS AS (CAST(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.completedAt')) AS SIGNED)) VIRTUAL,
  ADD COLUMN `paid_fen` BIGINT GENERATED ALWAYS AS (CAST(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.paidFen')) AS SIGNED)) VIRTUAL,
  ADD INDEX `idx_orders_work_popularity` (`status`, `refund_status`, `work_id`),
  ADD INDEX `idx_orders_paid_at` (`paid_at`),
  ADD INDEX `idx_orders_completed_at` (`completed_at`);

ALTER TABLE `refunds`
  ADD COLUMN `success_at` BIGINT GENERATED ALWAYS AS (CAST(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.successAt')) AS SIGNED)) VIRTUAL,
  ADD COLUMN `amount_fen` BIGINT GENERATED ALWAYS AS (CAST(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.amountFen')) AS SIGNED)) VIRTUAL,
  ADD INDEX `idx_refunds_success_at` (`success_at`);
