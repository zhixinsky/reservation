# 最高管理员 PC 端与多门店扩展 — 开发规划

> 文档版本：v1.9  
> 更新日期：2026-06-06  
> 状态：Phase 1–4 核心已实施；发型师管理统一为小程序「我的」→「管理」

本文档基于当前预约系统（欧诺造型）已有能力，规划 **平台最高管理员 PC 后台** 与 **多门店管理** 的演进路线，供后续迭代参考。

---

## 1. 现状摘要

### 1.1 已有能力

| 模块 | 现状 |
|------|------|
| 用户预约 | 小程序首页：剪发 / 烫染，可约今天 / 明天 / 后天 |
| 发型师管理 | 小程序 `pages/admin-dashboard`（「我的」→「管理」）；平台 `/platform/` 维护账号与手机号 |
| 时段生成 | `slot-config.js` 读门店 `workStart` / `workEnd` / `slotIntervalMinutes` |
| 默认锁定 | 门店 `defaultBlockedSlots`；发型师可 `_UNLOCKED` 临时解锁 |
| 手动锁定 | 表 `blocked_slots`（按 `stylistId` + 日期） |
| 休假 | 表 `stylist_vacations` / 云集合 `stylist_vacations` |
| 公告 | 全局单条（云开发或后端） |
| 短信 | 亿美软通，模板 ID 在 `.env` 全局配置 |
| 发型师管理入口 | 平台为发型师填写 `phone`；微信授权同号后「我的」页显示「管理」，进入本人预约后台 |

### 1.2 仍待完善

| 能力 | 说明 |
|------|------|
| 平台管理员入库 | 仍用 `.env` 的 `ADMIN_USERNAME` / `ADMIN_PASSWORD`，未迁到 `platform_admins` 表 |
| 门店管理员角色 | `store_admin` 未实现 |
| 短信按店独立模板 | 共用一套亿美模板 ID；门店级 `smsCompanyName` / 链接已支持 |
| 小程序黑名单提示 | `/api/appointments/query` 已返回 `blacklistNotice`，小程序未展示 |
| PC `admin-stylist.html` | 遗留页面，无登录入口；日常运营以小程序管理为准 |

### 1.3 相关代码位置

| 功能 | 主要文件 |
|------|----------|
| 时段生成与默认午休 | `server.js`（`/api/slots/:stylistId`）、`cloudfunctions/api/index.js`（`getSlots`） |
| 发型师鉴权 | 微信手机号 → `stylists.phone` 匹配 → session `role: stylist`（`server.js` `/api/wechat/phone-number`） |
| 管理端 API | `server.js`（`/api/admin/*`），鉴权 `role === 'stylist'` |
| 数据表 | `database.js`（`stores`、`stylists`、`appointments`、`blocked_slots`、`phone_blacklist`、`platform_audit_logs` 等） |
| 平台 PC | `public/platform/`（`/api/platform/*`） |
| 小程序管理 UI | `miniprogram/pages/my` → `admin-dashboard` |

---

## 2. 目标架构

### 2.1 角色与入口

```
┌─────────────────────────────────────────────────────────────┐
│  PC 端                                                       │
│  └─ 平台最高管理员  /platform/          role: platform_admin │
│     （门店、发型师账号+手机号、黑名单、报表、审计）            │
├─────────────────────────────────────────────────────────────┤
│  小程序                                                      │
│  ├─ 用户端   pages/index、pages/my                           │
│  └─ 发型师   pages/my →「管理」→ admin-dashboard             │
│              role: stylist（按 stylists.phone 鉴权）          │
└─────────────────────────────────────────────────────────────┘
```

| 角色 | 入口 | 职责 |
|------|------|------|
| **平台最高管理员** | PC `/platform/` | 全部门店、规则、黑名单、发型师账号（含手机号）、数据总览 |
| **门店管理员**（可选，未做） | — | 仅本店发型师、公告、预约 |
| **发型师** | 小程序「我的」→「管理」 | 本人预约、锁/解锁时段、休假、公告 |

**原则**：发型师端负责**日常运营**；平台 PC 负责**规则配置与账号治理**，二者职责分离。

### 2.2 多门店数据关系（目标）

```
platform_admin
    └── stores（门店）
            ├── 门店预约规则（营业时间、默认锁定、可预约天数…）
            ├── 门店公告 / 门店信息（地址、电话、短信品牌名）
            ├── stylists（发型师，+ storeId）
            │       ├── appointments
            │       ├── blocked_slots（按日临时锁定）
            │       └── stylist_vacations
            └── phone_blacklist（可按 storeId 或全平台）
```

现有 `appointments`、`blocked_slots` 可通过 `stylistId → storeId` 归属门店，**第一期不必改 appointments 表结构**。

---

## 3. 数据模型扩展（草案）

### 3.1 新表：`stores`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK | 门店 ID |
| name | VARCHAR | 门店名称，如「欧诺造型」 |
| code | VARCHAR | 门店编码，便于小程序参数 |
| status | ENUM | `active` / `disabled` |
| address | VARCHAR | 地址 |
| phone | VARCHAR | 联系电话 |
| latitude / longitude | DECIMAL | 地图坐标 |
| workStart | TIME | 营业开始，默认 `11:00` |
| workEnd | TIME | 营业结束，默认 `22:30` |
| slotIntervalMinutes | INT | 时段粒度，默认 `30` |
| bookAheadDays | INT | 可预约天数，默认 `3`（今天起） |
| defaultBlockedSlots | JSON | 默认锁定，如 `["12:00-12:30","18:00-18:30"]` |
| dyeSlotCount | INT | 烫染连续占格数，默认 `4` |
| announcementText | TEXT | 首页公告 |
| smsCompanyName | VARCHAR | 短信签名公司名 |
| miniProgramUrl | VARCHAR | 短信中小程序链接 |
| createdAt / updatedAt | DATETIME | |

### 3.2 改造：`stylists`

- `storeId INT NOT NULL`（归属门店）
- `phone VARCHAR(32)`：小程序管理入口鉴权，平台 PC 维护，全库唯一
- `username` / `password`：保留（PC 遗留 `admin-stylist.html` 等）；新建发型师在平台配置
- 空库启动时写入占位账号，正式数据均在 MySQL，**不再使用** `STYLISTS_JSON` / `stylists.json`

### 3.3 新表：`phone_blacklist`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK | |
| storeId | INT NULL | `NULL` 表示全平台封禁；有值则仅该店 |
| phone | VARCHAR(32) | 规范化手机号 |
| reason | VARCHAR | 封禁原因 |
| createdBy | VARCHAR | 操作人 |
| expiresAt | DATETIME NULL | 可选，临时封禁 |
| createdAt | DATETIME | |

唯一索引建议：`(storeId, phone)`（`storeId` 为 NULL 时单独处理全平台唯一）。

### 3.4 新表：`platform_admins`（或复用 `.env` + sessions）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK | |
| username | VARCHAR UNIQUE | |
| passwordHash | VARCHAR |  bcrypt 等 |
| createdAt | DATETIME | |

Session 增加 `role: 'platform_admin'`，与现有 `role: 'stylist'` 区分。

### 3.5 可选：`store_admins`（Phase 2+）

| 字段 | 说明 |
|------|------|
| storeId | 所属门店 |
| username / passwordHash | 门店级管理员 |

---

## 4. 最高管理员 PC 功能清单

### Phase 1 — MVP（单店可跑通，为多店铺路）

**P0 — 必须先做**

| # | 功能 | 说明 |
|---|------|------|
| 1 | 平台管理员登录 | 恢复/新建 `platform_admin` 鉴权；PC 登录页 |
| 2 | `stores` 表 + 迁移 | 即使只有一家店，也先入库；现有硬编码规则写入 `storeId=1` |
| 3 | 门店预约规则配置 | 营业时间、时段粒度、可预约天数、默认锁定时段、烫染占格数 |
| 4 | 规则配置化改造 | `getSlots`、`bookAppointment` 读门店配置，删除代码内 11:00 / 12:00 等硬编码 |
| 5 | 用户黑名单 | CRUD + `bookAppointment` 拦截（支持单店 / 全平台） |
| 6 | 预约总览（只读+治理） | 按门店 / 日期 / 手机号 / 状态筛选；平台代取消 |

**PC 信息架构（Phase 1）**

```
/admin-platform/login.html          最高管理员登录
/admin-platform/index.html          仪表盘（今日预约概览）
/admin-platform/stores.html         门店列表（首期可仅 1 条）
/admin-platform/store-edit.html     门店规则与基本信息
/admin-platform/appointments.html   全平台预约查询
/admin-platform/blacklist.html      黑名单管理
```

UI 风格延续 `admin-stylist.html`（sage 绿、圆角卡片），保持 Web 管理端一致。

---

### Phase 2 — 门店运营增强

| # | 功能 | 说明 |
|---|------|------|
| 7 | 发型师账号管理（PC） | 按门店创建/编辑：姓名、职级、登录名、重置密码、启用停用 |
| 8 | 公告管理 | 公告按 `storeId` 存储与展示 |
| 9 | 门店信息维护 | 地址、电话、坐标（「我的」页、短信变量） |
| 10 | 预约治理增强 | 代标记完成、查看某手机号历史（客诉 / 拉黑依据） |
| 11 | 门店管理员角色（可选） | `store_admin` 仅本店数据 |

---

### Phase 3 — 真·多门店

| # | 功能 | 说明 |
|---|------|------|
| 12 | 小程序选店 | 列表 / 最近 / 扫码带 `storeId`；API 全链路带 `storeId` |
| 13 | 跨店统计报表 | 各店预约量、取消率、剪发/烫染占比、高峰时段 |
| 14 | 数据导出 | CSV，便于对账 |
| 15 | 短信按门店/品牌 | 每店 `smsCompanyName`、模板 ID 或变量；PC 查看亿美审核状态 |

---

### Phase 4 — 进阶（可选）

| # | 功能 | 说明 |
|---|------|------|
| 16 | 操作审计日志 | 规则变更、黑名单、代取消等留痕 |
| 17 | 爽约 / 多次取消 → 拉黑建议 | 规则引擎或人工确认 |
| 18 | 门店配置复制 | 新店一键复制时段与默认锁定模板 |
| 19 | 云开发对齐 | `stores` 云集合 + 云函数按 `storeId` 路由（与 MySQL 同步策略需单独设计） |

---

## 5. 与现有模块的改造映射

| 模块 | Phase 1 改动 |
|------|----------------|
| `database.js` | 新增 `stores`、`phone_blacklist`、`platform_admins`；`stylists` 加 `storeId` |
| `server.js` | 新增 `/api/platform/*`；`getSlots` / `bookAppointment` 读门店配置；黑名单校验 |
| `cloudfunctions/api/index.js` | 与 `server.js` 同步规则配置化（小程序走云函数时） |
| `public/` | 新建 `admin-platform-*.html` |
| 小程序 | Phase 1 可默认 `storeId=1`；Phase 3 增加选店 |
| `.env` | `ADMIN_USERNAME` / `ADMIN_PASSWORD` 重新接入或迁到 DB；门店信息逐步从 env 迁入 `stores` |

### 5.1 默认锁定时段机制（保持兼容）

现有逻辑：

- 代码内判定 `12:00-12:30`、`18:00-18:30` 为默认锁定
- 发型师「解锁」时在 `blocked_slots` 写入 `{time}_UNLOCKED`
- 发型师「锁定」写入普通 `time`

**目标**：默认锁定列表来自 `stores.defaultBlockedSlots`（JSON），`_UNLOCKED` 机制保持不变，发型师端无需改交互。

### 5.2 黑名单拦截点

至少在以下接口校验（`storeId` + `phone`）：

- `POST /api/book`（`bookAppointment`）
- 可选：`POST /api/appointments/query` 返回提示（不阻断查询）

---

## 6. API 规划（Phase 1 草案）

### 6.1 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/platform/auth/login` | 平台管理员登录 |
| GET | `/api/platform/auth/verify` | 验证 session |

请求头：`x-session-id`（与现有管理端一致）。

### 6.2 门店

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/platform/stores` | 门店列表 |
| GET | `/api/platform/stores/:id` | 门店详情 |
| POST | `/api/platform/stores` | 新建门店 |
| PUT | `/api/platform/stores/:id` | 更新门店（含预约规则） |
| PATCH | `/api/platform/stores/:id/status` | 启用 / 停用 |

### 6.3 黑名单

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/platform/blacklist` | 列表（支持 storeId、phone 筛选） |
| POST | `/api/platform/blacklist` | 添加 |
| DELETE | `/api/platform/blacklist/:id` | 移除 |

### 6.4 预约总览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/platform/appointments` | 跨店预约列表 |
| POST | `/api/platform/appointments/:id/cancel` | 平台代取消 |

### 6.5 仪表盘

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/platform/dashboard/summary` | 今日各店预约数、待服务、取消等 |

### 6.6 用户端 / 发型师端（改造）

| 方法 | 路径 | 改动 |
|------|------|------|
| GET | `/api/slots/:stylistId` | 读所属门店规则生成时段 |
| POST | `/api/book` | 黑名单校验 + 门店规则校验 |
| GET | `/api/announcement` | 可选加 `storeId` 参数（Phase 2） |

---

## 7. 实施优先级

| 优先级 | 任务 | 理由 |
|--------|------|------|
| **P0** | `stores` 表 + 时段规则配置化 | 多门店与 PC 管理的根基 |
| **P0** | 平台管理员登录 + PC 壳子 | 独立入口，不动发型师端体验 |
| **P0** | 黑名单 + 预约拦截 | 明确业务需求 |
| **P1** | 门店 CRUD + 默认锁定 UI | 可视化配置，替代改代码 |
| **P1** | 全平台预约列表 | 运营刚需 |
| **P2** | PC 发型师账号管理 | ✅ 已完成（含手机号） |
| **P2** | 小程序 `storeId` 选店 | 真正多店 |
| **P3** | 报表、门店管理员、审计 | 规模扩大后 |

---

## 8. 第一期交付范围（建议 MVP 验收标准）

1. PC 最高管理员可登录（`platform_admin` session）
2. 至少 **1 家门店**可在 PC 配置：营业时间、时段间隔、默认锁定时段、可预约天数、烫染占格数
3. 用户**黑名单**可增删查，预约时被拦截并返回友好提示
4. PC 可查看**全店预约列表**并代取消
5. `getSlots` / `bookAppointment` **不再硬编码** 11:00–22:30 与 12:00 / 18:00 午休
6. 发型师小程序 / Web 管理端**交互不变**，仅底层读门店配置

---

## 9. 风险与注意事项

| 项 | 说明 |
|----|------|
| 双端逻辑一致 | `server.js` 与 `cloudfunctions/api/index.js` 需共用规则模块（建议抽 `slot-config.js`） |
| 内存缓存 | `database.js` 当前单实例内存缓存；多实例部署前需考虑缓存失效或直读 MySQL |
| 云托管环境变量 | 删除已废弃的 `STYLISTS_JSON`、`ADMIN_PHONES`、`ADMIN_STYLIST_ID` |
| 发型师手机号 | 平台为每位发型师填写 `phone`，否则无法进入小程序「管理」 |
| 安全 | 平台管理员密码存哈希；PC 页仅 HTTPS；session 过期策略与发型师一致或更短 |

---

## 10. 后续文档

实施各 Phase 时可补充：

- `docs/platform-admin-api.md` — 接口详细请求/响应示例
- `docs/stores-migration.md` — 单店 → 多店数据迁移步骤
- `docs/blacklist-policy.md` — 黑名单业务规则（全平台 vs 单店、过期策略）

---

## 11. Phase 1 实施说明（已完成）

### 访问地址

- 云托管 / 本地同一端口：`http(s)://你的域名/platform/`
- 与小程序 API 共用 `server.js` 同一端口（云托管默认 `PORT=80`，本地默认 `3000`）

### 登录账号

- 环境变量：`ADMIN_USERNAME`、`ADMIN_PASSWORD`（见 `.env.example`）
- Session 角色：`platform_admin`（与发型师 `stylist` 分离）

### 已实现页面

| 模块 | 路径 / 入口 |
|------|-------------|
| 登录 | `/platform/` |
| 概览仪表盘 | 侧栏「概览」 |
| 门店 CRUD + 预约规则 | 侧栏「门店」 |
| 预约总览 + 代取消 | 侧栏「预约」 |
| 用户黑名单 | 侧栏「黑名单」 |

### 已实现后端

| 文件 | 说明 |
|------|------|
| `database.js` | 表 `stores`、`phone_blacklist`；默认门店种子 |
| `slot-config.js` | 时段生成与校验（读门店配置） |
| `platform-routes.js` | `/api/platform/*` |
| `server.js` | 挂载平台路由；预约黑名单；时段配置化 |
| `public/platform/*` | Apple 风格 PC SPA |

### 待 Phase 2+

- 小程序选店、`storeId` 全链路（**需改小程序界面，待确认**）
- 短信按门店/品牌同步
- 云函数按门店 `stores` 集合读规则（当前云函数已接入 `slot-config` 默认规则）

---

## 12. Phase 2 实施说明（已完成）

### 已完成（2026-06-07）

| 模块 | 说明 |
|------|------|
| 发型师入库 | `stylists` 表；空库时写入占位账号，其余在平台维护 |
| 平台「发型师」 | PC 端按门店新建/编辑：姓名、手机号、登录名、密码、启用停用 |
| 公告按门店 | `/api/announcement` 读 `stores.announcementText`；发型师管理端保存同步到门店 |
| 预约治理 | 平台代标记完成、手机号历史查询 |
| 云函数规则 | `cloudfunctions/api/slot-config.js` 与 `server.js` 共用逻辑 |

### 待确认后实施

- ~~小程序首页选店、公告/预约带 `storeId`~~ → 见 Phase 3

---

## 13. Phase 3 实施说明（已完成核心）

### 小程序（最小改动）

| 项 | 说明 |
|----|------|
| 预约页左上角胶囊 | 多店时显示门店下拉；**仅 1 家店时自动隐藏** |
| 默认门店 | 多店时首次按用户定位选**最近门店**；用户手动选择后写入本地缓存 |
| 持久选店 | `selected_store_id` / `selected_store_info` 本地存储，后续预约/公告均对应该店 |
| 发型师 | `/api/stylists?storeId=` 过滤，预约仍走该店发型师 |
| 我的页导航 | 读取缓存门店经纬度 `wx.openLocation`（未选店时回退默认坐标） |

### 后端

| API | 说明 |
|-----|------|
| `GET /api/stores` | 营业中门店列表（id、name、phone、latitude、longitude） |
| `GET /api/stylists?storeId=` | 按门店过滤发型师 |
| `GET /api/announcement?storeId=` | 已有，小程序已传参 |

### 平台 PC

- 门店编辑增加**纬度/经度（导航必填）**，地址改为可选

### Phase 3+（2026-06-07 已完成）

| 模块 | 说明 |
|------|------|
| 跨店报表 | 平台侧栏「报表」：各店预约量、取消率、剪烫染占比、高峰时段 |
| CSV 导出 | 预约总览页「导出 CSV」 |
| 门店复制 | 门店列表「复制」一键克隆规则（新店默认停用） |
| 短信链接 | 预约/取消短信使用所属门店 `miniProgramUrl` |
| 门店状态 | `PATCH /api/platform/stores/:id/status` |

### 扫码入店（2026-06-07 已完成）

| 模块 | 说明 |
|------|------|
| 一店一码 | 平台「编辑门店」底部生成该店专属小程序码，可下载打印 |
| 扫码定店 | 码内 `scene=s={storeId}`，打开预约页后**优先**进入该店并写入本地缓存 |
| 仍可切换 | 多店时左上角胶囊保留，用户可改选其他门店 |
| 配置 | `.env` 需 `WX_APPSECRET`；体验版扫码可设 `WX_QRCODE_ENV_VERSION=trial` |

### Phase 4（2026-06-07 部分完成）

| 模块 | 说明 |
|------|------|
| 操作审计 | 侧栏「审计」：门店/发型师/预约/黑名单/登录等操作留痕，可按时间/门店/类型筛选 |
| 拉黑建议 | 黑名单页顶部：近 90 天多次取消或疑似爽约推荐，一键填入表单后人工确认 |
| 门店复制 | 已在 Phase 3+ 完成 |

### 云开发对齐（2026-06-07 已完成）

| 模块 | 说明 |
|------|------|
| 云集合 | `stores`、`phone_blacklist`（由平台一键同步写入） |
| 云函数 | `getStores`、`getStylists?storeId`、`getAnnouncement`、`getSlots`、`bookAppointment` 按店读规则与黑名单 |
| 平台同步 | 门店管理「同步到云开发」；`POST /api/platform/cloud/sync-stores` |
| 文档 | `docs/stores-cloud-sync.md` |

### 云托管增强（2026-06-07）

| 模块 | 说明 |
|------|------|
| 短信按店变量 | 预约/取消短信携带门店名、电话、链接、`smsCompanyName`（不含地址） |
| 短信状态 | 平台概览展示亿美模板就绪情况 |
| 查询提示 | `/api/appointments/query` 返回 `blacklistNotice`（不阻断查询） |
| 疑似爽约 | 预约总览筛选「疑似爽约」（过期仍为待服务） |

### 账号与入口精简（2026-06-06 已完成）

| 模块 | 说明 |
|------|------|
| 移除 PC 登录页 | 已删除 `public/admin-login.html` |
| 移除小程序登录页 | 已删除 `pages/admin-login` |
| 发型师唯一入口 | 小程序「我的」→ 管理员手机号授权 →「管理」→ `admin-dashboard` |
| 发型师手机号 | 平台「发型师管理」维护 `phone`；后端按号匹配 `stylistId` |
| 环境变量清理 | 废弃 `STYLISTS_JSON`、`STYLISTS_CONFIG_PATH`、`ADMIN_PHONES`、`ADMIN_STYLIST_ID`；见 `.env.example` |
| 门店名称 | 最多 6 字（平台校验 + 小程序展示截断） |
| 可预约天数 | 每店 1–3 天可配置 |

### 待后续

- 短信签名按店独立模板（需亿美多模板审核，当前共用一套模板 ID）
- 门店保存后自动同步云开发（仅云函数用户可选）
- `store_admin` 门店管理员角色
- 平台管理员密码入库（哈希）
- 小程序展示 `blacklistNotice`

---

## 14. 环境变量（当前有效）

云托管环境变量见 **[cloud-hosting-env.md](cloud-hosting-env.md)**；本地模板见 `.env.example`。

| 分类 | 变量 |
|------|------|
| 平台登录 | `ADMIN_USERNAME`, `ADMIN_PASSWORD` |
| MySQL | `MYSQL_ADDRESS` 或 `MYSQL_HOST`+`MYSQL_PORT`, `MYSQL_USERNAME`/`MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` |
| 微信 | `WX_APPID`, `WX_APPSECRET`, `WX_USE_OPENAPI` |
| 云开发（可选） | `TCB_ENV_ID`, `CLOUD_FUNCTION_NAME`, `PLATFORM_SYNC_SECRET`, `WX_QRCODE_*` |
| 短信（可选） | `EMAY_*`, `MINI_PROGRAM_URL`（签名在亿美账号侧，非环境变量） |
| 门店种子（可选） | `STORE_*`, `DEFAULT_ANNOUNCEMENT` |

发型师账号与手机号在 **平台后台** 维护，不通过环境变量配置。

---

## 15. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.9 | 2026-06-06 | 移除 admin-login；发型师按 `stylists.phone` 进管理；清理废弃环境变量；门店名 6 字、可预约 1–3 天 |
| v1.8 | 2026-06-07 | 云托管：短信按店变量、模板状态、黑名单查询提示、爽约筛选 |
| v1.7 | 2026-06-07 | 云开发对齐：stores 集合、云函数按店、平台一键同步 |
| v1.6 | 2026-06-07 | Phase 4：操作审计日志、拉黑建议（取消/爽约） |
| v1.5 | 2026-06-07 | 扫码入店：每店小程序码、启动参数解析、平台生成/下载 |
| v1.4 | 2026-06-07 | Phase 3+：跨店报表、CSV 导出、门店复制、短信按店链接 |
| v1.3 | 2026-06-07 | Phase 3：小程序胶囊选店、门店 API、经纬度导航、选店持久化 |
| v1.2 | 2026-06-07 | Phase 2 部分：发型师 DB、平台发型师管理、公告按门店、预约完成/历史、云函数 slot-config |
| v1.1 | 2026-06-06 | Phase 1 实施：平台 PC 端、门店规则、黑名单、slot-config |
| v1.0 | 2026-06-06 | 初稿：基于现有代码梳理，规划 PC 最高管理员与多门店路线 |
