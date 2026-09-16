-- 卸甲可单独预约；作为美甲/建构加项时仅卸本甲免费，其他卸甲按项目价收费。
UPDATE `services`
SET `data` = JSON_SET(
  `data`,
  '$.priceFen', CASE `id`
    WHEN 'svc-nail-removal-natural' THEN 1000
    WHEN 'svc-nail-removal-thick-builder' THEN 2000
    WHEN 'svc-nail-removal-tips' THEN 2000
    WHEN 'svc-foot-nail-removal-natural' THEN 1000
    WHEN 'svc-foot-nail-removal-tips' THEN 2000
  END,
  '$.freeAsAddon', CASE `id`
    WHEN 'svc-nail-removal-natural' THEN 1
    WHEN 'svc-foot-nail-removal-natural' THEN 1
    ELSE 0
  END,
  '$.description', CASE `id`
    WHEN 'svc-nail-removal-natural' THEN '单独预约 ¥10；预约美甲主项目时免费叠加。'
    WHEN 'svc-nail-removal-thick-builder' THEN '单独预约或作为加项均为 ¥20。'
    WHEN 'svc-nail-removal-tips' THEN '单独预约或作为加项均为 ¥20。'
    WHEN 'svc-foot-nail-removal-natural' THEN '单独预约 ¥10；预约脚部美甲主项目时免费叠加。'
    WHEN 'svc-foot-nail-removal-tips' THEN '单独预约或作为加项均为 ¥20。'
  END,
  '$.updatedAt', UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000
),
`updated_at` = UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000
WHERE `id` IN (
  'svc-nail-removal-natural',
  'svc-nail-removal-thick-builder',
  'svc-nail-removal-tips',
  'svc-foot-nail-removal-natural',
  'svc-foot-nail-removal-tips'
);
