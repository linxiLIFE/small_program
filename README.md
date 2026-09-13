# 四个小姐姐的店预约小程序

原生微信小程序 + CloudBase 云函数 + Vue 3 管理后台的单店美业预约系统。首版包含美甲、脚部美甲、睫毛、眉毛、纹绣项目、作品展示、技师选择、14 天预约、全额预付、到店核销、自动退款、积分和经营概览。

## 当前状态（2026-09-13）

- 最后验证时间：2026-09-13
- 小程序 AppID（当前项目配置）：`wxa9eecac18eb834da`
- CloudBase 环境：`cloud1 微信体验版`
- CloudBase Env ID：`cloud1-d9g5pfect2ece00fa`
- 管理后台地址：<https://cloud1-d9g5pfect2ece00fa-1485433457.tcloudbaseapp.com/cloud-admin/index.html>
- 新环境已部署：MySQL 8.0（19 张表）、`api`、`jobs`、`seed`、`admin-api`、`payment-callback`，并已写入 5 个大类、52 个小项目和 48 个统一占位图款式；4 个叠加项目已标记为可叠加。
- 已完成：顾客端页面、统一 API 封装、服务端事务/状态机/积分、API v3 支付流程、退款回调、后台任务、受控种子函数、Vue 管理后台、CloudBase 用户名密码登录和持久会话、技师每周模板与指定日期排班编辑器、手机号授权失败码诊断和隐私授权耦合。
- 已验证：后台 `vue-tsc`/Vite 构建、Node.js 语法检查、支付回调 HTTPS 入口可达、商户证书与私钥匹配、微信 `/v3/certificates` 凭证请求已到达商户接口；支付商户变量和 `pub_key.pem` 已写入四个云函数服务端环境，并同步更新支付状态页面；退款幂等恢复、查单、异常/关闭通知和未到店补偿逻辑已部署。
- 尚未验证：商户号与 AppID 绑定、真机支付/退款、支付回调真实通知验签、正式发布；完整 `npm test` 当前被既有的 UTC 日期断言阻断，其余小程序/后台领域测试通过。

详细记录见 [`docs/CURRENT_STATUS.md`](docs/CURRENT_STATUS.md)，完整技术方案见 [`docs/预约小程序技术方案.md`](docs/预约小程序技术方案.md)。

## 小程序快速开始

1. 使用微信开发者工具打开本目录，确认 AppID 为上面的 AppID。
2. 确认项目资源管理器中的 `cloudfunctions` 显示“当前环境: cloud1”。
3. 首次预览可直接点击“编译”，前端会在 `api` 云函数不可用时显示带提示的演示数据。
4. 在新环境执行 `npm run db:schema` 应用 [`docs/mysql-schema.sql`](docs/mysql-schema.sql)，并在云函数服务端配置 `DB_*` 环境变量；部署 `seed` 并传入 `confirm=SEED_DEMO_DATA` 初始化目录和演示规则。
5. 分别部署 `cloudfunctions/api`、`cloudfunctions/jobs`、`cloudfunctions/seed`、`cloudfunctions/payment-callback` 和 `cloudfunctions/admin-api`。`jobs`、`payment-callback`、`admin-api`、`seed` 依赖共享业务模块，部署前执行：

   ```bash
   npm run prepare:functions
   ```

6. 右键每个云函数目录，选择“创建并部署：云端安装依赖（不上传 node_modules）”。

后台产物可用 CLI 发布到当前静态托管子路径：

```bash
cd admin
npm run build
tcb hosting deploy dist cloud-admin -e cloud1-d9g5pfect2ece00fa --safe --verify
```

没有微信支付资质时不要填写虚假参数；下单后会保留待付款订单并显示待配置提示。资质完成后的变量和验收步骤见 [`docs/微信支付接入清单.md`](docs/微信支付接入清单.md)。

## 管理后台

```bash
cd admin
npm install
cp .env.example .env.local
# 如需本地运行，确认 VITE_CLOUDBASE_ENV_ID 与当前环境一致
npm run dev
```

后台默认使用 CloudBase Web SDK 的用户名/密码登录、本地持久会话和 `api` 云函数；只有显式设置 `VITE_ADMIN_DEMO=true` 时才启用本地演示数据。首次使用时，在 [CloudBase 身份认证用户管理](https://tcb.cloud.tencent.com/dev?envId=cloud1-d9g5pfect2ece00fa#/identity/user-management) 创建一个用户名密码用户，打开上面的后台登录；当环境还没有 `staff_accounts` 时，登录账号会看到“设为首个店主”，确认后即可完成首个 `OWNER` 授权。之后新增员工必须由受控管理流程写入 `staff_accounts`，不开放公众注册。真实登录请优先使用线上静态地址；浏览器端不保存或显示商户私钥、API v3 密钥、支付平台证书和完整令牌。

## 目录结构

```text
small_program/
├── pages/                 # 首页、项目、详情、预约、订单、积分、工作台
├── components/            # 可复用顾客端组件
├── utils/                 # API、演示数据、金额/时间工具
├── cloudfunctions/
│   ├── api/               # 顾客/工作人员/管理业务路由
│   ├── jobs/              # 关单、未到店、退款补偿
│   ├── payment-callback/  # 微信支付 API v3 回调
│   ├── admin-api/         # 管理后台 HTTPS API 入口
│   ├── seed/              # 需显式确认的演示目录初始化
│   └── hello/             # 原有 CloudBase 示例保留
├── admin/                 # Vue 3 + TypeScript + Vite 管理后台
├── scripts/               # 领域测试、工程校验、函数准备
└── docs/                  # 技术方案、支付清单、当前状态
```

## 本地校验

```bash
npm test
cd admin && npm run build
```

`npm test` 会检查金额/积分/时间规则、页面资源注册和 WXML 插值平衡。它不能替代微信开发者工具编译、真机支付、支付回调验签或 CloudBase 线上持续运行验收。

## 安全边界

- `cloud-config.js` 只保存 Env ID；AppSecret、商户私钥、API v3 密钥、Token、手机号密文密钥和完整 `.env` 禁止进入前端或 Git。
- MySQL 不向小程序客户端开放直连，业务数据只经云函数访问；数据库密码只放在 CloudBase 服务端配置。
- 服务端重新计算价格、积分、预约窗口和技师冲突；不信任客户端传来的 OpenID、角色、价格、积分余额或支付成功提示。
- 任何删除的本地文件都必须放入废纸篓；本次实现没有删除用户文件。

## 文档维护约定

每完成一个可验证的功能，就更新 `docs/CURRENT_STATUS.md` 的“已完成”和“验证记录”；如果启动方式或目录结构变化，同时更新本 README。只记录已经实际验证的状态，并注明尚未验证的部分。
