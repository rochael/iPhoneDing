# 有货查询时段分析 Implementation Plan

> **For agentic workers:** Implement inline in this already authorized workspace; use test-driven-development and verification-before-completion. Do not dispatch agents or require another approval.

**Goal:** 每次规格×门店查询得到有货时加一，以有货次数 / 有效查询次数比较香港时段。

**Architecture:** 新增 query_counts 按规格、门店、15分钟保存有货、无货、未知计数，与轮次状态在同一受租约保护的事务内提交。时段分析在已有覆盖统计上叠加计数，按有货率排序；一分钟/请求明细不额外保存。旧状态事件保留供兼容接口访问，不伪造旧查询计数。

**Tech Stack:** TypeScript, Hono, React, Drizzle, SQLite / D1.

**Spec:** 本次用户要求：06:00–07:00 有效查询120次，其中100次有货，显示100/120与83.3%。

## Global Constraints

- 香港时间；支持15分钟与1小时、日期/机型/颜色/容量/门店筛选。
- 每个规格×门店结果计一次；重复轮次不重复加计，未知不作无货且不进入有货率分母。
- 连续有货、首次有货、恢复有货都计数；通知仍使用原有去重规则。
- 计数保留365天；新旧备份都能导入，两端共用SQL迁移。

### Task 1: 持久化查询计数

Files: migrations/0002_query_counts.sql, src/core/types.ts, src/db/schema.ts, src/db/repository.ts, src/adapters/node-db.ts, tests/repository.test.ts.

- [x] 测试四轮 available/available/unknown/unavailable 的计数为2/1/1，重复提交被拒绝而不加计；重启保留；新表不生成旧状态的计数。
- [x] 运行测试观察缺失计数失败。
- [x] query_counts(id,product_id,store_id,at,available,unavailable,unknown,last_at)，按15分钟分桶；commitRound原子UPSERT并设置queryCountsStartedAt，自动加载所有SQL迁移。
- [x] 验证筛选、跨香港日期、租约回滚及D1绑定参数限制。

### Task 2: 查询统计与导出

Files: src/core/availability.ts, src/api/app.ts, scripts/data.ts, tests/availability.test.ts, tests/api.test.ts, tests/data.test.ts.

Interfaces: aggregateAvailability({from,to,minutes,pairCount,intervals,events,queries}) returns buckets/totals/ranking/stores with availableChecks, unavailableChecks, unknownChecks, validChecks, hitRate; Repository.queryCounts(Filter,page,limit,onlyAvailable) returns paginated QueryCount records.

- [x] 先验证100/120=5/6、未知排除、无样本null、跨日期与多门店相加、跨日排行按总计数而不是平均百分比。
- [x] 增加/api/history/queries；stats返回计数与统计开始时间；export?kind=queries导出15分钟原始计数，保留原事件导出。
- [x] 备份版本2包含新表，版本1导入将新表清空；执行实际备份导入回归测试。

### Task 3: 网页与运行验证

Files: web/main.tsx, web/style.css, README.md, docs/verification.md.

- [x] 历史首页显示有货次数、总体有货率、较高有货率时段；柱状图/热力图0–100%显示，有样本即显示，不依赖连续区间。
- [x] 有货记录展示每个15分钟规格门店的计数；门店对比显示有货/有效/未知与有货率；低覆盖标记而不隐藏排行。
- [x] 说明计数单位、失败排除、旧数据不能还原、跨日使用总计数之比；更新部署迁移说明。
- [x] npm test, npm run typecheck, npm run build, Workers dry-run/local D1验证，ego-browser手机操作验证并重启本地采集使新计数生效。

验证结果：39项测试、类型检查、生产构建、格式检查和Workers dry-run通过；本地D1真实执行计数SQL一致；手机390px视口验证100/120=83.3%、记录、门店和CSV一致。独立采集进程已更新，真实计数从16:20:08开始；当前Apple 541仅记未知。
