# 当前项目状态

> 这份文档是项目继续开发时的上下文记录。内容以实际操作和测试结果为准。

## 更新时间

- 2026-09-09

## 项目定位

当前项目已从 HelloWorld 骨架扩展为“拾光美研”单店美业预约首版：顾客端采用原生微信小程序，业务后端采用 CloudBase 云函数，另有 Vue 3 + TypeScript 管理后台。目标仍是“先自用、逐步扩展”，没有接入 Azure 服务器。

## 已确认配置

| 项目 | 当前值 |
| --- | --- |
| 小程序 AppID | `wx334c1641257081ee` |
| CloudBase 环境名称 | `cloud1 免费开发环境` |
| CloudBase Env ID | `cloud1-d5g44sjps7b57763c` |
| 开发工具 | 微信开发者工具 Stable 2.02.2608070 |
| 当前页面 | `pages/index/index` |
| 云函数根目录 | `cloudfunctions/` |
| CloudBase 数据库 | 原生 Serverless MySQL 8.0（19 张业务表） |
| MySQL 实例 | `cynosdbmysql-ins-ivicqx33` / `cynosdbmysql-0mczlyeg` |
| 云函数网络 | `vpc-kshyiilq` / `subnet-csqhts8n` |
| 管理后台静态地址 | `https://cloud1-d5g44sjps7b57763c-1483650605.tcloudbaseapp.com/cloud-admin/index.html`（CloudBase 登录入口已发布） |
| Web SDK 安全来源 | 线上静态托管域名已在白名单；免费套餐拒绝新增 `localhost:4173` / `127.0.0.1:4173` |

## 已完成

- 保留并验证过原有 `hello` 云函数链路。
- 顾客端：首页、服务分类、项目详情、作品详情、预约流程、订单列表/详情、积分明细、个人中心和工作人员台。
- 可复用组件：项目卡、作品卡、状态徽章、空状态、区块标题；统一奶油白/低饱和玫瑰视觉和安全区样式。
- 顾客端统一 API 封装；没有部署 `api` 时使用带明确提示的演示数据，避免页面无法预览。
- `cloudfunctions/api`：目录、服务端报价、技师每日占用事务、订单幂等、积分冻结/消费/解冻/奖励/退款退回和奖励冲回欠额、身份和角色检查、管理操作和统一错误码。
- `cloudfunctions/jobs`：支付超时查单/关单、未到店自动退款、退款补偿；`payment-callback`：支付和退款 API v3 通知验签解密入口；`admin-api`：管理后台 HTTPS API 入口。
- `cloudfunctions/seed`：只有传入 `confirm=SEED_DEMO_DATA` 才写入演示目录。
- 已切换到 CloudBase 原生 Serverless MySQL 8.0：`docs/mysql-schema.sql` 已执行，19 张表已创建；云函数通过参数化 SQL 和 JSON 业务载荷访问，预约冲突使用 MySQL 短事务。
- 已创建服务端业务账号并授予 19 张表的 `SELECT`、`INSERT`、`UPDATE`、`DELETE` 权限；数据库密码只保存在 CloudBase 云函数环境变量中，没有写入仓库。
- `api`、`jobs`、`seed`、`admin-api`、`payment-callback` 已部署到当前环境并绑定 MySQL 所在 VPC；`jobs` 已创建每分钟定时触发器 `shiguang-jobs-every-minute`。
- 已在线执行受控种子初始化：分类 3 条、服务 4 条、技师 3 条、作品 4 条、设置版本 1 条；`api.getHome`、`api.listServices` 和 `jobs` 调用均已返回成功。
- `admin/`：Vue 3 + TypeScript + Vite 管理后台，包含经营概览、订单、项目、技师、预约/积分规则和支付接入状态页面。
- 管理后台已接入 `@cloudbase/js-sdk`：用户名密码登录、本地持久会话、退出登录、真实 `api` 云函数调用；服务端使用 CloudBase Node SDK 读取当前 `uid/openId`，管理操作仍由 SQL `staff_accounts` 角色授权。
- 技师排班编辑器已接入真实管理 API：读取每周营业模板和指定日期的技师安排，支持班次、休息时间、请假/休息状态编辑；服务端写入 `settings_versions`、`schedule_templates` 和 `technician_days`，并在已有有效预约时拒绝冲突排班。
- 已加入首个店主初始化闭环：仅已登录 CloudBase 用户可查看初始化状态；当没有启用中的店员记录时，可把当前账号一次性写入 SQL `staff_accounts` 为 `OWNER`。
- 顾客端手机号绑定已接入真实 `getPhoneNumber` 回调：绑定按钮同时触发隐私授权，回调会区分用户取消、隐私指引未声明、手机号能力无权限和体验版额度耗尽等错误，不再把所有失败都提示为“您已取消登录”。
- 已在微信开发者工具重新编译并上传小程序 1.0.1，工具确认代码上传成功并覆盖当前体验版。
- 技术方案和微信支付待补清单已写入 `docs/`。

## 当前目录

```text
app.js / app.json / app.wxss
components/
pages/
utils/ / types/
cloudfunctions/api/
cloudfunctions/jobs/
cloudfunctions/payment-callback/
cloudfunctions/admin-api/
cloudfunctions/seed/
admin/
scripts/
docs/
```

## 已执行的本地验证

| 命令 | 结果 |
| --- | --- |
| `npm test` | 通过领域规则测试和 10 个页面/15 个 WXML 资源校验 |
| `find . -name '*.js' ... node --check` | 通过 |
| `cd admin && npm run build` | 通过 `vue-tsc` 和 Vite 生产构建 |
| 微信开发者工具模拟器 | 首页编译通过，并切换到项目页看到演示项目、作品和底部导航 |
| 小程序手机号授权代码 | 本地 `node --check`、WXML 资源校验通过；微信开发者工具已上传 1.0.1；真实手机授权结果仍需在已配置隐私指引且具备手机号能力的体验版中验证 |
| 管理后台 | 本地构建通过；CloudBase 静态托管已发布 `/cloud-admin/` 产物并校验登录页、JS/CSS；真实账号登录和首个店主按钮待用实际 CloudBase 用户完成。免费套餐不支持新增本地安全域名 |
| CloudBase MySQL | `information_schema` 确认 19 张表；`orders` 表结构和业务账号权限已核对 |
| CloudBase 云函数 | `seed` 初始化成功；`api.getHome`、`api.listServices` 返回 SQL 数据；`adminSchedule` 线上管理会话读取 7 天模板和 3 位技师当天排班；`adminSaveScheduleDay` 对反向时间实际返回 `INVALID_SCHEDULE` 且未写入，并用线上管理会话原样保存林老师当天排班后回读为 `override`；无任务时 `jobs` 返回 `processed: 0, failed: 0`，SQL 探针任务实际处理为 `processed: 1, failed: 0`；未登录 `getProfile` 正确返回 `UNAUTHENTICATED` |
| CloudBase 定时任务 | `jobs` 已确认存在每分钟触发器 `shiguang-jobs-every-minute` |

这些结果证明当前 SQL 线上读链路和函数运行链路可用，但不代表已经完成微信开发者工具真机、真实支付或支付通知验签验证。

## 继续开发时的操作顺序

1. 按 `docs/数据库初始化与权限.md` 管理 SQL 表结构变更；不要再为业务创建文档数据库集合。
2. 运行 `npm run prepare:functions` 后重新部署函数；部署时保留 CloudBase 中的服务端数据库密码配置。
3. 在 CloudBase 身份认证用户管理中创建首个用户名密码用户，打开 `/cloud-admin/` 登录并确认“设为首个店主”；后台会通过 CloudBase 会话调用 `api` 云函数，后台 API 地址不再由浏览器拼接 Token。
4. 资质完成后按 `docs/微信支付接入清单.md` 填服务端变量，先真机查单，再做真实退款。
5. 用验收矩阵覆盖并发、竞态、越权、故障恢复和报表口径。

## 尚未完成

- 使用真实 CloudBase 用户完成管理后台登录、首个店主授权、刷新后会话恢复及 OWNER/STAFF 权限验收。
- 早期初始化时创建的 8 个文档数据库集合仍保留在环境中，但当前业务代码不再读取它们；按“禁止直接删除文件/数据”的约束暂不清理。
- 个体工商户资质、商户号与 AppID 绑定、服务端支付密钥和平台证书。
- 真机支付、支付回调、查单、关单、用户取消退款、未到店退款和退款到账回调。
- MySQL 备份/恢复演练、10/30/100 并发与安全验收。
- 作品图片的正式云存储上传、每周模板成功发布后的真实账号回读、通知模板的实际申请与发送验证。
- Azure HTTPS API 接入方案和正式发布。
- 小程序隐私保护指引中的“手机号”声明、主体认证/手机号能力，以及真实手机体验版授权闭环尚未完成验收。

## 重要注意事项

- 不要把 AppSecret、私钥、Token、密码或完整 `.env` 内容提交到项目或文档。
- 小程序前端不应执行 SSH，也不应直接暴露服务器凭据。
- “代码上传成功”不等于“功能可用”；修改后必须在模拟器或真机实际调用关键链路。
- 微信支付当前明确处于“功能已预留、资质未验证、真实交易未验证”状态，不能据此对外收款。
