-- 卸甲和建构同时作为预约叠加项及可单独预约的小项目，每个小项目固定一个同名款式。
UPDATE `services`
SET `data` = JSON_SET(
  `data`,
  '$.bookableStandalone', TRUE,
  '$.updatedAt', UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000
),
`updated_at` = UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000
WHERE `id` IN (
  'svc-nail-removal-natural',
  'svc-nail-removal-thick-builder',
  'svc-nail-removal-tips',
  'svc-nail-addon-v-builder',
  'svc-nail-addon-shaping-builder',
  'svc-nail-addon-luxury-shaping-builder',
  'svc-foot-nail-removal-natural',
  'svc-foot-nail-removal-tips',
  'svc-foot-nail-addon-v-builder',
  'svc-foot-nail-addon-shaping-builder'
);

INSERT INTO `works` (`id`, `data`, `created_at`, `updated_at`)
SELECT
  CONCAT('work-', `source_services`.`id`),
  JSON_OBJECT(
    '_id', CONCAT('work-', `source_services`.`id`),
    'id', CONCAT('work-', `source_services`.`id`),
    'categoryId', JSON_UNQUOTE(JSON_EXTRACT(`source_services`.`data`, '$.categoryId')),
    'categoryName', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`source_services`.`data`, '$.categoryName')), ''),
    'title', JSON_UNQUOTE(JSON_EXTRACT(`source_services`.`data`, '$.name')),
    'description', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`source_services`.`data`, '$.description')), ''),
    'imageUrl', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`source_services`.`data`, '$.coverUrl')), ''),
    'serviceId', `source_services`.`id`,
    'published', TRUE,
    'featured', FALSE,
    'featuredSort', 0,
    'sort', COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(`source_services`.`data`, '$.sort')) AS SIGNED), 0),
    'version', 1,
    'createdAt', UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000,
    'updatedAt', UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000
  ),
  UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000,
  UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000
FROM `services` AS `source_services`
WHERE `source_services`.`id` IN (
  'svc-nail-removal-natural',
  'svc-nail-removal-thick-builder',
  'svc-nail-removal-tips',
  'svc-nail-addon-v-builder',
  'svc-nail-addon-shaping-builder',
  'svc-nail-addon-luxury-shaping-builder',
  'svc-foot-nail-removal-natural',
  'svc-foot-nail-removal-tips',
  'svc-foot-nail-addon-v-builder',
  'svc-foot-nail-addon-shaping-builder'
)
ON DUPLICATE KEY UPDATE
  `data` = JSON_SET(
    `works`.`data`,
    '$.title', JSON_UNQUOTE(JSON_EXTRACT(VALUES(`data`), '$.title')),
    '$.serviceId', JSON_UNQUOTE(JSON_EXTRACT(VALUES(`data`), '$.serviceId')),
    '$.categoryId', JSON_UNQUOTE(JSON_EXTRACT(VALUES(`data`), '$.categoryId')),
    '$.categoryName', JSON_UNQUOTE(JSON_EXTRACT(VALUES(`data`), '$.categoryName')),
    '$.published', TRUE,
    '$.featured', FALSE,
    '$.featuredSort', 0,
    '$.updatedAt', UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000
  ),
  `updated_at` = UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000;
