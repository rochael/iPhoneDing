# iPhone Ding

个人使用的香港 Apple Store 库存监控台：Hono + React、Bark 到货通知，以及每日有货查询时段分析。共用业务层支持 **VPS / Docker** 与 **Cloudflare Workers / D1 / Durable Objects**。

## 本地运行

需要 Node.js 24（最低 22.13）。

```sh
npm ci
cp .env.example .env
# 编辑 .env，设置 ADMIN_PASSWORD（至少12位）和 SESSION_SECRET（至少32位）
# 本地 COOKIE_SECURE=false；密钥可用 openssl rand -hex 32 生成
npm run dev
# 在另一个终端启动采集；网页本身不会启动 Node 采集进程
npm run monitor
```

访问 http://localhost:5173，输入管理员密码。在设置页填入 Bark App 的设备地址并发送测试通知，然后创建关注。网页关闭后后台监控仍运行，但电脑休眠会停止采集。

```sh
npm test
npm run typecheck
npm run build
npm run start
npm run start:monitor
npm run probe                    # 验证本机环境的 Apple 目录、16个规格和6家门店
npm run probe -- https://你的域名 # 登录部署端，再在该环境查询8个规格
```

`/api/probe` 仅已登录管理员可调用，结果不写入库存历史。没有虚构库存、模拟成功推送或预填历史。目录引导数据来自 2026-10-10 实际 Apple 页面；采集启动会重新验证目录，此后每日刷新。目录解析失败不会换成猜测商品编号。

库存页显示本轮异常原因；详细记录在「设置 → 最近采集异常」，包含香港时间及 HTTP 状态、超时、DNS/连接错误或响应结构异常，保留7天。不记录响应正文或密钥。也可查看已登录的 `GET /api/status` 中的 `error` 和 `diagnostics`。手动验证使用 `npm run probe -- http://127.0.0.1:3000`，不会写入历史；`reason` 是当前请求结果。收到失败后进入退避，因此错误提示会保留到下一轮成功，页面刷新不会触发新的 Apple 查询。

## VPS / Docker

1. 将域名 A/AAAA 记录指向服务器，开放 80 / 443。
2. `cp .env.example .env`，填写密码、会话密钥和 `DOMAIN`。生产设置 `COOKIE_SECURE=true`。
3. `docker compose up -d --build`。app、monitor 共用 SQLite 持久化卷；Caddy 自动申请 HTTPS。
4. `docker compose logs --tail=50 monitor` 检查运行；访问设置页检查上次成功、目录时间与查询异常。

HTTPS反向代理会使用HTTP连接Node后端。应用通过公网来源地址校验写入请求，HTTPS部署默认使用 `https://${DOMAIN}`；也可在 `.env` 明确设置 `PUBLIC_ORIGIN=https://iphone.phper.dev`（仅协议、域名和可选端口），与浏览器访问地址保持一致。纯本地开发保持 `COOKIE_SECURE=false` 且留空 `PUBLIC_ORIGIN`，继续按请求地址校验。Workers通常直接接收外部HTTPS地址，可选用同名变量指定固定入口。应用不依赖客户端提交的 `X-Forwarded-*` 头决定允许的来源。

镜像以非 root 用户运行。升级前备份数据，再重新构建。SQLite 的 WAL 文件必须随数据库一起保存；优先使用下述暂停后的 JSON 导出，或 SQLite 在线 backup 命令。不能只复制正在写入的 `.sqlite` 文件。

## Cloudflare

需要自己的 Cloudflare 账号；仓库不会自动创建资源或部署到你的账号。30 秒 Alarm 是目标间隔，实际执行可能延迟，且从该平台访问 Apple 能否稳定成功必须实测。

```sh
npx wrangler login
npx wrangler d1 create iphone-ding
# 将输出的 database_id 填入 wrangler.jsonc（替换全零占位ID）
npx wrangler d1 migrations apply iphone-ding --remote
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
npm run cf:deploy
```

生产默认 Secure cookie；不要把 `.dev.vars` 的 `COOKIE_SECURE=false` 上传到生产。Workers 静态资源承载 React 页面，API 使用 Hono，单个 `hong-kong` Durable Object 串行采集，D1 保存相同 SQL 模型，分钟级 Cron 负责唤醒失效调度。全规格事务涉及较多 D1 查询，建议使用 Workers Paid 并核对 [D1 每次调用查询限制](https://developers.cloudflare.com/d1/platform/limits/)；当前不保证在免费调用额度内运行。Alarm 重复执行由持久化轮次 ID、数据库租约和事务提交约束去重。

本地 Workers 验证：

```sh
cp .dev.vars.example .dev.vars
# 设置开发密码与会话密钥
npx wrangler d1 migrations apply iphone-ding --local
npm run cf:dev
# 访问 http://localhost:8787，打开库存页会初始化目录并唤醒 Alarm
npm run probe -- http://localhost:8787
npm run cf:check
```

部署完成后再对真实 Worker 域名运行 `probe`；本地 workerd 成功不等于 Cloudflare 边缘网络成功。全规格 24小时轮询有持续的 DO / D1 使用量，不能保证免费额度够用。批量请求默认每组8个商品、并发2，服务端限流后自动退避并遵守 Retry-After。若目录、响应格式或网络访问失效，页面显示未知/过期状态，历史留下覆盖缺口。

## 历史统计口径

历史页支持日期范围、机型/颜色/容量/门店筛选：

- **有货记录**：每个规格×门店按15分钟汇总有货、无货、未知次数，分页查看有货时段；CSV导出包含所有计数，包括仅无货或未知的时段。
- **时段分析**：15分钟 / 小时有货率柱状图、日期×时段热力图，近7天/30天或自定义范围，有货率时段排行。
- **门店对比**：有货 / 有效查询次数、有货率、失败/未知次数、累计有货时长及有货天数。

**有货率 = 有货查询次数 / 有效查询次数**，有效查询仅包含官网明确有货或无货的结果。例如06:00–07:00有效查询120次，其中100次有货，即100/120 = 83.3%。每次有货都加计数，持续有货、首次观测和恢复后观测全部计入；无需发生“无货→有货”变化。失败、字段缺失、因限流停止派发而无结果的组合单列为未知，不进入有货率分母。多选组合合并计数，一轮一个规格返回6家门店就是6次组合观测，不是一次HTTP请求。跨日按总有货次数 / 总有效查询次数计算，不平均每日百分比。

没有有效查询的时段留白；一次有效查询即可显示有货率，测得0%与无有效样本不同。柱状图及热力图采用固定0–100%刻度。排行按有货率排序，相同有货率时优先样本更多的时段，覆盖不足不再隐藏结果。建议结合样本量和覆盖查看；少量样本的100%不能证明全天稳定有货。新计数从更新后的监控进程运行时开始，页面显示开始时间；旧状态事件/区间无法还原准确查询次数，不会回填虚构样本。

有效覆盖和有货时长仍按相邻成功查询之间的区间估算，只计不超过90秒的区间，采用上一次成功状态；首个样本本身不产生时长。覆盖率分母是筛选组合的应监控时长，今天只计到当前时刻，覆盖不足50%使用纹理标记。有货天数按出现有货查询的香港日期去重。查询失败不改变最后确认状态；超过90秒未成功更新时实时库存标记过期。每次计数都与轮次在同一事务提交，重复Alarm/轮次与失效租约不会重复加计。

查询计数、事件、状态区间保留365天；请求诊断与轮次/已结束通知保留7天。状态行保留最后成功值；监控开启时每天执行清理。原状态事件仍保留供兼容API使用，但网页的有货分析不依赖补货事件。计数不是库存台数，也无法捕捉轮询之间的全部变化或保证未来同一时段有货。

升级已有部署：Node重启API和独立采集进程时自动应用全部SQL迁移；Docker重新构建并重启两个服务。Workers先运行 `npx wrangler d1 migrations apply iphone-ding --remote` 应用 `0002_query_counts.sql`，再部署新Worker。只刷新前端不会更新已运行的独立采集进程。

## Bark 与关注

关注启停仅控制推送，不改变全天全规格历史采集。设置页“暂停全部采集”才停止采集，并造成历史覆盖缺口。新建/重新开启关注时，当前仍有效的有货组合可立即入队提醒。持续有货不重复提醒；售罄后重新有货再提醒；相同轮次新增项合并成一条消息。

初次发送加最多3次重试；5分钟未送达即过期。状态/事件/通知队列原子保存，发送前先持久化尝试次数与领取状态。网络超时无法区分“手机已收到，但响应丢失”，重试可能重复通知。普通暂停采集期间仍处理已入队通知，直到发送成功或过期；备份／迁移模式会同时停止推送，独立于普通暂停。库存退避不影响通知重试的唤醒时间。

默认只允许 `api.day.app`，自建公网 Bark 服务通过服务器变量 `BARK_ALLOWED_HOSTS` 显式加入。拒绝 HTTP、IP和本机域名，不跟随重定向。Bark 密钥只保存在服务器数据库，API 仅回传脱敏地址。测试推送需要你自己的设备地址。

## 备份与跨平台迁移

先在源与目标设置页暂停**全部采集**，等待当前轮次结束。导出／导入工具会自动进入持久化的备份／迁移模式，同时冻结推送，并检查没有在途采集或发送。若提示等待，请等本轮或发送完成后重试。迁移期间不要编辑配置。目标必须先应用 SQL migration。导出包含设备密钥，应按私密数据保管，勿提交 Git。

```sh
npm run data -- export backup.json
npm run data -- import backup.json
# 本地 D1 / 线上 D1 分别使用：
npm run data -- export backup.json --d1
npm run data -- import backup.json --d1 --remote
# 无法打开目标网页时可先标记暂停：
npm run data -- stop unused --d1 --remote
```

SQLite / D1 使用同一备份格式。新导出为版本2并包含查询计数；也能导入版本1旧备份，旧备份的查询计数为空。工具验证版本和列结构，仅迁移白名单表，不迁移会话密钥、管理员密码、锁或登录失败限制。源与目标暂停、无在途租约才允许操作。导入期间持久化 `importInProgress` 阻止采集；分批导入失败时该标记保留，修复后重新执行完整导入，不要手动恢复采集。源与目标都会保持备份／迁移模式，尚未发送的消息只会在你恢复目标采集后继续处理（过期消息取消）。核对记录、Bark 配置与统计后，在设置页恢复目标采集即可退出此模式；原采集端保持停止。CLI 访问 D1 通过 Wrangler 登录，不在备份中保存 Cloudflare 凭据。

## API 与目录结构

网页使用hash路由：`#/stock`（库存）、`#/watches`（关注）、`#/history`（时段分析）、`#/history/records`（有货记录）、`#/history/stores`（门店对比）、`#/settings`（设置）。可直接分享链接，刷新与浏览器前进/后退保留当前页面；未登录时登录后进入原目标页面，空或未知路径回到 `#/stock`。Hash部分由前端处理，服务器无需为这些页面配置额外路由。

实时库存和历史分析分别记住上次的机型、颜色、容量选择；历史页还记住门店、日期范围及15分钟/小时粒度。选择保存在当前浏览器、当前站点的 localStorage，刷新或再次进入时恢复。今天/近7天/近30天按再次访问时的香港日期计算，自定义日期保留原起止范围。目录加载后会修正已失效选项；本地存储不可用时仍可正常筛选，但不会跨访问保存。

- `src/core`：库存状态转换、香港统计、Apple、Bark、监控编排。
- `src/db`：Drizzle schema及共用仓库，事务批次负责事件/区间/outbox原子提交。
- `src/adapters`：SQLite、D1、Node进程、Workers/DO。
- `src/api`：Hono单管理员 API；`web`：四标签手机页面。
- `migrations`：两个平台共用SQL；`scripts`：访问验证和数据迁移。

API：`POST /api/login`、`POST /api/logout`、`GET /api/session`、`GET /api/catalog`、`GET /api/stock`、`GET/POST/PUT/DELETE /api/watches`（更新/删除带ID）、`GET /api/history/events|queries|stats|export`、`GET /api/status`、`PUT /api/monitor`、`GET/PUT /api/settings`、`POST /api/settings/test`、`POST /api/probe`。历史 `from/to` 为香港日期且两端包含，统计 `minutes=15|60`。`queries?availableOnly=true` 仅列有货时段；`export?kind=queries` 导出全部15分钟查询计数，省略kind保留原事件导出。`/api/health` 为不含业务数据的公开存活检查。

生产使用 HTTPS、HttpOnly/SameSite Cookie、同源写入保护，登录失败10次后全局冷却15分钟。改变 SESSION_SECRET 会撤销既有登录。配置及数据库文件请限制访问权限。

## 验证限制

自动化测试使用真实 SQLite 和脱敏的 Apple 响应夹具，覆盖状态转换、香港跨日分桶、覆盖率、轮次与事务去重、过滤、登录和输入保护。部署前执行本文的真实访问与 Bark 测试；没有 Cloudflare 账号、域名、设备密钥时无法确认远程部署或真实手机接收。
