# 微信云托管环境变量配置说明

> 在云托管控制台 → 服务 → 版本配置 → **环境变量** 中填写。  
> 本地开发复制 `.env.example` 为 `.env` 即可，**切勿**把 `.env` 提交到 Git。

---

## 一、必填（上线前必须配置）

| 变量名 | 示例 | 说明 |
|--------|------|------|
| `ADMIN_USERNAME` | `admin` | 平台管理中心 `/platform/` 登录账号 |
| `ADMIN_PASSWORD` | `强密码` | 平台管理中心登录密码 |
| `MYSQL_ADDRESS` | `10.0.0.8:3306` | MySQL 地址（`主机:端口`）。也可用 `MYSQL_HOST` + `MYSQL_PORT` |
| `MYSQL_USERNAME` | `root` | MySQL 用户名（别名：`MYSQL_USER`） |
| `MYSQL_PASSWORD` | `***` | MySQL 密码 |
| `MYSQL_DATABASE` | `reservation_system` | 数据库名，不存在时首次启动会自动建库建表 |
| `WX_APPSECRET` | `***` | 小程序 AppSecret，用于**手机号快速验证** |

### 微信手机号（云托管必读）

官方说明：[错误排查 FAQ](https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloudrun/src/guide/weixin/faq.html)

**502 常见原因**：云托管开启了「开放接口服务」，但 `/wxa/business/getuserphonenumber` 未加入微信令牌白名单；或同时开启开放接口服务又用 `WX_APPSECRET` 换 token（`stable_token` 无 `access_token` 参数会走开放接口链路）。

| 方式 | 配置 | 控制台操作 |
|------|------|------------|
| **A** 仅用 AppSecret | 配置 `WX_APPSECRET`，**不要**设 `WX_USE_OPENAPI=1` | **关闭**「开放接口服务」→ 重新发布 |
| **B** 开放接口服务 | 可不配 `WX_APPSECRET`；或保留 AppSecret 由代码自动回退 | **开启**开放接口服务，白名单添加 `/wxa/business/getuserphonenumber` → 重新发布 |

代码默认 `WX_PHONE_API_MODE=auto`：云托管会先尝试容器内 HTTP 开放接口，再尝试 `cloudbase_access_token`，最后回退 `WX_APPSECRET`。

可选：`WX_PHONE_API_MODE=open|cloudbase|secret` 强制指定一种方式。

---

## 二、强烈建议（生产环境）

| 变量名 | 示例 | 说明 |
|--------|------|------|
| `WX_APPID` | `wxb76bea40dcb2999b` | 小程序 AppID（生成门店小程序码等；未配则用代码内默认值） |
| `MINI_PROGRAM_URL` | `https://wxaurl.cn/xxx` | 短信正文里的小程序短链接 |
| `MYSQL_CONNECTION_LIMIT` | `10` | 连接池大小，默认 `10` |

---

## 三、短信（可选，不配则不发短信、预约仍正常）

| 变量名 | 示例 | 说明 |
|--------|------|------|
| `EMAY_APPID` | `EUCP-EMY-SMS1-xxx` | 亿美软通 AppId |
| `EMAY_SECRETKEY` | `***` | 亿美密钥 |
| `EMAY_TEMPLATE_ID_BOOKING` | `178082243956900419` | 预约成功模板 ID（亿美控制台已审核） |
| `EMAY_TEMPLATE_ID_CANCEL` | `178082243956901419` | 用户取消预约模板 ID |
| `EMAY_TEMPLATE_ID_STYLIST_CANCEL` | `178082243956902419` | 门店/发型师取消模板 ID（未配则回退 `EMAY_TEMPLATE_ID_CANCEL`） |
| `EMAY_TEMPLATE_ID_REMINDER` | | 到店提醒模板 ID（未配则不发送提醒） |
| `EMAY_AUTO_CREATE_TEMPLATES` | `false` | **建议 `false`**：模板已在亿美手动创建，勿自动创建 |
| `EMAY_BASE_URL` | `http://www.btom.cn:8080` | 亿美接口地址，一般不用改 |

短信签名（如 **【育文游】**）在**亿美账号侧**配置，**不需要**环境变量。

---

## 四、门店小程序码（可选）

| 变量名 | 示例 | 说明 |
|--------|------|------|
| `WX_QRCODE_ENV_VERSION` | `release` | 扫码打开版本：`release` / `trial` / `develop` |
| `WX_QRCODE_CHECK_PATH` | `0` | 设为 `1` 时校验页面是否已发布；开发阶段保持不配置 |

---

## 五、云开发同步与对象存储（按需）

| 变量名 | 说明 |
|--------|------|
| `TCB_ENV_ID` | 云托管/云开发环境 ID（如 `reservation-d2gf73dgv8fd17503`）。**发型师头像**上传到对象存储 `avatar/` 目录时也使用此环境 ID |
| `CLOUD_FUNCTION_NAME` | 云函数名，默认 `api` |
| `PLATFORM_SYNC_SECRET` | 平台「同步到云开发」密钥（与云函数环境变量一致） |

### 发型师头像上传（平台 PC）

头像由**云托管 Express 服务**直接调用微信 `tcb/uploadfile` 写入**云托管对象存储**，不经过云函数。

请在云托管控制台 → **微信令牌权限配置** 中开通：

- `/tcb/uploadfile`
- `/tcb/batchdownloadfile`

上传成功后，可在对象存储控制台看到 `avatar/stylist-{id}.jpg`。

门店预约页背景图同样走 `tcb/uploadfile`。平台裁剪比例 **9:19.5**，推荐导出 **750×1624 px**；上传后经 [Tinify API](https://tinypng.com/developers) 压缩并转为 **WebP**，存储路径为 `img/store-{id}-background.webp`。未上传时小程序使用默认 `img/background.webp`。

| 变量名 | 说明 |
|--------|------|
| `TINIFY_API_KEY` | Tinify API 密钥（生产环境必填；未配置时上传背景图会失败） |
| `TINIFY_PROXY` | 可选，HTTP 代理地址 |

---

## 六、首次启动默认门店种子（可选）

数据库里**没有门店**时，用以下变量写入第一家店（之后请在 `/platform/` 维护）：

| 变量名 | 说明 |
|--------|------|
| `STORE_NAME` | 门店名称（最多 6 字） |
| `STORE_CODE` | 门店编码 |
| `STORE_ADDRESS` | 地址 |
| `STORE_PHONE` | 联系电话 |
| `STORE_LATITUDE` / `STORE_LONGITUDE` | 经纬度 |
| `DEFAULT_ANNOUNCEMENT` | 默认公告文案 |

---

## 七、镜像 / Dockerfile 已内置（无需在控制台重复配置）

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `PORT` | `80` | 云托管监听端口 |
| `TZ` | `Asia/Shanghai` | 时区 |
| `NODE_ENV` | `production` | 运行模式 |
| `NODE_EXTRA_CA_CERTS` | `/app/cert/certificate.crt` | 信任云托管微信证书（请求微信 HTTPS 接口） |

本地开发默认 `PORT=3000`，可不配置。

---

## 八、已废弃（请勿再配置）

| 变量名 | 替代方式 |
|--------|----------|
| `STYLISTS_JSON` | 平台 `/platform/` → 发型师管理（MySQL `stylists` 表） |
| `STYLISTS_CONFIG_PATH` / `stylists.json` | 同上 |
| `ADMIN_PHONES` | 平台为发型师填写 `phone`，小程序「我的」→「管理」 |
| `ADMIN_STYLIST_ID` | 同上 |
| `COMPANY_NAME` | 短信签名在亿美账号侧配置 |

---

## 九、云托管控制台粘贴模板

将下面内容复制到环境变量配置，**把占位符改成真实值**：

```env
# --- 必填 ---
ADMIN_USERNAME=admin
ADMIN_PASSWORD=请填写强密码
MYSQL_ADDRESS=你的MySQL地址:3306
MYSQL_USERNAME=你的数据库用户
MYSQL_PASSWORD=你的数据库密码
MYSQL_DATABASE=reservation_system
WX_APPSECRET=你的小程序AppSecret

# --- 建议 ---
WX_APPID=wxb76bea40dcb2999b
MINI_PROGRAM_URL=https://wxaurl.cn/你的短链
MYSQL_CONNECTION_LIMIT=10

# --- 短信（可选）---
EMAY_APPID=
EMAY_SECRETKEY=
EMAY_AUTO_CREATE_TEMPLATES=false
EMAY_TEMPLATE_ID_BOOKING=
EMAY_TEMPLATE_ID_CANCEL=
EMAY_TEMPLATE_ID_STYLIST_CANCEL=
EMAY_TEMPLATE_ID_REMINDER=

# --- 门店小程序码（可选）---
WX_QRCODE_ENV_VERSION=release
```

---

## 十、部署后必做（不在环境变量里）

1. 打开 `https://你的域名/platform/` 登录平台账号  
2. 配置门店（名称 ≤6 字、营业时间、可预约天数 1–3 天）  
3. **为每位发型师填写手机号**（与微信授权号一致，否则无「管理」入口）  
4. 真机测试：预约、取消、发型师管理、扫码入店  

---

## 十一、相关文件

| 文件 | 用途 |
|------|------|
| `.env.example` | 本地开发模板（可提交 Git） |
| `.env` | 本地真实密钥（**禁止提交 Git**） |
| `Dockerfile` | 云托管镜像内置 `PORT` / `TZ` 等 |
