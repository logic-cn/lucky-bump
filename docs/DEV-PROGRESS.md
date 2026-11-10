# 开发进度（DEV-PROGRESS）

> 本文件是自动巡检任务与开发过程的协调锚点：每次推进后必须更新并 git commit。
> 目标：完成 uni-app-x + uniCloud 全部编码并端到端测试，达到可上线级别。技术决策见 docs/06。

## 状态总览

- 当前阶段：**Web 端生产可用已达** —— 白屏根因修复完毕（4 层），浏览器端到端全链路验证通过（注册→引导→首页→记录→预测→时间线→退出→复登），生产 uniCloud 空间联调可用
- 最近更新：2026-11-06（安全加固：token 会话绑定 uid、生产密钥 fail-closed、匿名入口限流、调试对象禁用）
- 测试：`npm test` → 160 pass / 0 fail（另在无本地密钥的干净目录验证通过）

## 安全加固（2026-11-06）✅

- [x] `requireUser` 校验 token uid 与 `lb-token` 会话 uid 一致，会话不能跨账号复用
- [x] tokenSecret 读取兼容 HBuilderX 打包路径；生产环境读不到配置或仍是示例占位符时 fail-closed，禁止回落公开开发密钥
- [x] 注册按 IP（10 次/小时）、短信发送按手机号（5 次/小时）+ IP（20 次/小时）限流；登录/找回密码/撤回注销共享密码尝试预算（10 次/10 分钟）
- [x] 家庭组「产检/报告/情绪/日记」授权矩阵在服务端执行，关闭后家庭成员无法经列表、时间线、待办读取对应数据
- [x] 修正 vendor 公共模块读取 `uni-config-center` 的相对路径（原 `./` 指向不存在的子目录，短信与运营配置会静默丢失）
- [x] 禁用调试云对象 `lucky-probe`；`lucky-seed` 移除运行时诊断字段
- [x] 云端复测：`verifySeed` ok、`probe` 返回 FORBIDDEN、开发密钥签发的 token 被拒绝、未登录业务调用被拒绝

## 任务清单

### Phase 1 文档与设计 ✅
- [x] 产品文档 01-05 / 技术架构 06 / UI 设计系统 07 / 部署指南 08

### Phase 2 工程骨架 ✅
- [x] manifest.json / pages.json（36 页全注册）/ uni.scss / App.uvue / main.uts / index.html / store / 图标 / uniCloud 空间占位

### Phase 3 uniCloud 后端 ✅
- [x] 24 张表 schema（含 lb-diaries；clientDB 全锁死）
- [x] lucky-auth-common（HMAC token uni-id 兼容 / scrypt / 限速 / resolveJourneyAccess）
- [x] lucky-id / lucky-journey / lucky-record（含日记）/ lucky-baby / lucky-care / lucky-family / lucky-reminder / lucky-data / lucky-seed / lucky-templates

### Phase 4 前端 ✅（36 页全部完整实现）
- [x] 账户与引导：login / register / onboarding
- [x] Tab 五页：index（阶段化首页）/ record / data / learn / me
- [x] A 组记录表单 10 页：weight / blood-pressure / blood-glucose / symptom / diary / cycle / ovulation-test / pregnancy-test（好孕确认仪式）/ fetal-movement（两模式计数）/ lochia / epds（EPDS 十题）
- [x] B 组计时器 2 页：contraction-timer（5-1-1）/ nursing-timer（换边提醒）
- [x] C 组产检 2 页：schedule（排程时间线+一键生成）/ visit（录入+历史）
- [x] D 组宝宝 7 页：birth-register / baby-home / feeding / diaper / sleep / growth（WHO 百分位）/ vaccines
- [x] E 组数据 3 页 + 知识：data（入口+导出）/ charts（趋势图+明细）/ timeline（生命时间线）/ learn
- [x] F 组我的 5 页：me / family（邀请+授权矩阵）/ privacy / settings（提醒规则 CRUD）/ about
- [x] lbc 组件：lbc-card / lbc-redline / lbc-disclaimer（easycom 规范；页面当前以内联样式为主，组件供增量使用）

### Phase 5 测试 ✅
- [x] test/harness/unicloud-mock.js（内存版 uniCloud 运行时 + 固定时钟）
- [x] 单元测试：smoke + domain（账户/孕周恒等式/产检排程/疫苗/EPDS/5-1-1/百分位/授权矩阵/红线/周期预测）
- [x] E2E 全生命周期：lifecycle.test.js（备孕→验孕→好孕确认→孕期→产检→分娩→产褥→育儿→家庭共享→提醒→数据导出→权限边界→二宝回流→登出）
- [x] 页面一致性：pages.json 36 项 ↔ 36 个 .uvue，零占位残留

### Phase 6 上线收尾
- [x] docs/08 部署与上线指南（含需用户介入全清单）
- [x] README 更新（工程说明与运行指引）
- [ ] **需用户介入**：HBuilderX 打开工程生成 appid、关联 uniCloud 空间、配置正式 tokenSecret、云打包真机回归（见 docs/08 §2/§4/§6）

### 巡检轮次 4（2026-10-27）✅
- [x] 静态一致性回归网固化为测试（test/unit/static.test.js）：pages.json↔文件双向校验、tabBar 图标齐全、前端云调用↔后端方法逐一存在、云对象导出方法均有定义（防 RPC 运行时 404）——此前人工审计全部自动化，后续改动即跑即查

### 巡检轮次 3 补齐（2026-10-27）✅
- [x] 产检报告照片上传归档（docs/03 M3.2 / 页面清单 P0 报告图集）：care/visit 接入 chooseImage + uniCloud.uploadFile，fileID 落库 reportFileIds（此为对照产品文档最后一处 P0 缺口）

### 巡检轮次 2 质量修复（2026-10-27）✅
- [x] 家庭组移除成员闭环：getFamily 返回 member user_id，前端移除按钮接真调用（此前为占位 toast）
- [x] 登录防爆破限速改为按「账号+IP」锁定（原按出口 IP 会误伤同 IP 多用户，且在全量测试中互扰），新增限速行为测试
- [x] lucky-seed.verifySeed 部署门禁纳入单元测试（模板完整性 + tokenSecret 上线告警）
- [x] 公共模块补 package.json（uniCloud 上传识别规范）

### 编译反馈重构·第二批（2026-10-29）✅
- [x] 27 页批量迁移 <script setup>（record/baby/care/data/learn/me 大部分）；无 this. 残留（逐文件扫描）；npm test 17/17
- [x] 第二批 6 页迁移完成（login/register/onboarding/baby-home/birth-register/about）
- [x] 第三批：全部 36 页 script 标注统一 lang=uts → lang=ts（编译器不接受 .uvue 页面内 uts 标注）；settings.uvue 顺带迁移，Options API 清零

### 编译反馈重构（2026-10-29）✅
- [x] App.uvue / pages/index 迁移至 <script setup> 组合式 API（Options API 在当前 uni-app-x 编译器下报错，用户侧重构）；request.uts 移除 UTS 不支持的交叉类型与 as 断言；daysToPeriod 补上真实计算
- [x] npm test 17/17；无移除符号遗留引用

### 运行反馈修复（2026-10-27，web/真机联调中）✅
- [x] index.html web 入口修正：/main.uts → /main（带扩展名被当静态资源返回致白屏）+ 管线注入注释 + viewport coverSupport（用户 web 运行修正）
- [x] .vapor 蒸汽模式标记入库（web 运行生成，功能性文件）

### 真机运行反馈修复（2026-10-27）✅
- [x] App.uvue 启动调用修复：appState.init() → appInit()（store 实际导出为函数，原写法在 app 端会启动崩溃；用户真机运行发现并修复，已全库扫描确认无同类引用）
- [x] 全量回归 17/17

### 部署阶段（2026-10-27，用户提供 HBuilderX + uniCloud 空间后）✅
- [x] DCloud appid 已生成（__UNI__1BC2635，用户在 HBuilderX 中完成）
- [x] 阿里云空间已关联工程（spacex.json 本地回填，文件已 gitignore）
- [x] **2026-11-03 切换支付宝云**：空间 `<你的服务空间ID>`，云目录 `uniCloud-alipay`；12 云函数 + 31 schema 全量上传，Web 全链路实测通过；阿里云空间保留可回切
- [x] 9 云对象 + 3 公共模块经 HBuilderX CLI 上传成功；24 张 schema 上传；--initdatabase 完成
- [x] 生产 tokenSecret 生成并随 uni-config-center 兼容层部署（真实值 gitignore，模板入库）
- [ ] 剩余人工：真机运行/云打包（HBuilderX 一键）、§6 回归清单（真机项）
- 已知 CLI 限制：`--run cloudobject` 阿里云下仅本地调试，云端冒烟由首屏登录自然覆盖

## 遗留说明（不阻塞上线评审）

1. AI 报告识别（后续版本能力）；前端已预留入口位。
2. 媒体上传（报告照片/日记图片）需 uniCloud 存储空间，前端已留 fileID 占位逻辑。
4. lbc 组件库为最小集（card/redline/disclaimer），按钮与表单组件在页面内联实现，后续可增量抽取。
5. 应用锁的端上强制执行（隐私页开关已落本地存储）：触发时机为 App onShow，需接入原生生物识别能力（HBuilderX 环境配置，见 docs/08 §7 依赖用户环境）。

### Web 端修复轮（2026-10-28）✅

- [x] 白屏四层根因：App.uvue 调用不存在的 appState.init()；缺 `.vapor` 标记（web 不进 uni-app x 管线）；index.html 入口应为无扩展名 `/main`；全部页面 Options API → `<script setup lang="ts">`（web 蒸汽运行时 data/computed 不挂实例）
- [x] 运行时缺陷规避：uni.showModal 回调不触发（4 页自绘弹窗）、number.toInt 缺失（main.uts WEB 补丁）、单 input asset 组件（main.uts 全局注册）、digit→number（6 页）、reLaunch 前写全局状态竞态（登录/引导改由首页 onShow 统一加载）、tabBar 页补 onShow 重载
- [x] 云端修复：公共模块 vendor 进云对象（CLI 不解析 file: 依赖）+ `scripts/sync_commons.sh`；callFunction 云对象 params 数组约定；云端 this 语义对齐（全局 uniCloud、模块级内部函数）
- [x] 全部 36 页 + App.uvue 编译通过（vapor 管线）；浏览器端到端全链路验证通过（docs/08 §9）；`npm test` 17/17

### 安全加固轮（2026-10-29）✅

- [x] token 吊销全局生效：鉴权下沉 `auth.requireUser`，9 个云对象统一校验 `lb-token.revoked`
- [x] strict 红线：`timeline`/`exportAll` 按 `record.user_id === 调用者 uid` 过滤；`role` 与 `dataScope` 拆分，`admin` 不再借用 owner 的数据可见性
- [x] 越权修复：`listMetrics`/`latestMetrics`/`listCycleEvents`/`listTrackers`/`contractionAdvice`/`reminder.listRules`/`updateRule` 全部收敛到 `accessibleJourney`
- [x] 哀伤门禁：`listDue`/`today` 在 `MOURNING` 下返回空待办
- [x] 密钥 fail-closed：配置中心存在但缺 `tokenSecret` 时抛错
- [x] 静态回归网：`auth.verifyToken` 禁止直调（logout 白名单）、journeyId 读方法必须做归属校验（test/unit/static.test.js）

### 功能补齐轮（2026-10-30）✅

- [x] 注销账号：`requestDeletion` 密码二次确认 → `pending_deletion` + 30 天冷静期 + 立即吊销全部 token + 登录拦截（返回 daysLeft）；`cancelDeletion` 凭密码撤回；privacy 页入口 + 自绘密码弹窗，login 页识别冷静期并给撤回入口；**未做**定时 purge（见 docs/08 §8.10）
- [x] 计时器后台恢复：宫缩/亲喂页 onShow 拉取 `activeOnly` 未结束会话，以服务端 `started_at` 接续；超 24h 遗留会话不自动接续，自绘提示条交用户「结束并保存/放弃」（docs/03 M5）
- [x] 暗色模式：`theme.scss`（.t-light/.t-dark 的 --lb-* 变量，t-light 与 uni.scss 令牌同源）+ `themeStore`（持久化 light/dark）+ 38 页全部令牌化（根节点 themeClass 绑定 + 样式 var() 化）+ settings 真实开关；渐变/图表数据色/按钮白字保留字面量（两主题通用）
- [x] 应用锁：`pages/account/lock` 启动遮罩页 + `App.uvue` onShow 检测（`isLockRequired`：开关开启且会话未解锁）+ privacy 页真实能力提示；生物识别 Soter 调用待 HBuilderX 验证后接入（biometric.uts 预留接口，当前降级为解锁按钮直进，见 docs/08 §8.9）
- [x] UI 全面重设计收尾：批次 D/E 审计、全仓旧色一致性扫描、record 页芯片宫格补齐（详见 docs/07 设计系统）
- [x] 回归：`npm test` 52/52（新增 account/tracker/ui 三套测试 + 静态鉴权网 2 条）

### 缺口补齐轮（2026-10-30，代码 14 项）✅

- [x] P0 注销定时 purge：新增 `lucky-maintenance` 云函数（每日 03:00 触发器），按旅程级联删除业务数据/家庭关系/token/账号，单账号失败隔离、重复执行幂等（`test/unit/maintenance.test.js`）
- [x] P0 分娩后产褥期日程：`registerDelivery` 将未完成产检置 skipped，按分娩日生成「产后 42 天复查」+ EPDS 2/4/6 周随访（同名幂等，`test/unit/postpartum.test.js`）
- [x] P0 提醒落地：`utils/quiet.uts` 免打扰时段（默认 22:00-07:00，可配置）+ 首页每天一次到期提醒弹层（紧急提醒可突破免打扰）
- [x] P0 应用锁真校验：新增 `lucky-id.verifyPassword`（仅校验不发 token），锁页改为服务端密码校验；生物识别可用时保留快捷入口
- [x] 日记照片：选图 → `uniCloud.uploadFile` → `mediaIds` 落库（最多 9 张，复用产检报告上传范式）
- [x] 出生卡：分娩登记成功后展示（日期/小名/体重身长）+ 复制分享文案
- [x] 导出：新增 `lucky-data.exportSummary`（仅主人、strict 只取本人）人类可读摘要，数据页展示并一键复制
- [x] 修改密码入口：设置页「账号安全 → 修改密码」自绘弹窗（找回密码仍需短信服务）
- [x] 体重推荐区间：设置页「身体档案」（身高/孕前体重）→ 体重页按孕前 BMI 选择 IOM 四档区间
- [x] 产后首页「妈妈今天」卡：`lucky-data.today` 增返 momCard（当日喂养/尿布/宝宝睡眠）；并修正日差口径（UTC 正午锚定导致当天上午登记被判成 T3）
- [x] 隐私留痕：新增 `lb-audit-logs`（clientDB 锁死），家庭成员访问首页按「人+动作+天」去重记录；主人隐私页可查近 30 条，成员无权读取
- [x] 隐私文案对齐真实能力：去掉未实现的「云备份/完整导出」承诺，通知脱敏开关标注为推送接入后生效
- [x] lbc 组件令牌化：card/redline/disclaimer 全部改用 `var(--lb-*)`，新增静态断言禁止组件颜色字面量
- [x] learn 知识页扩充：按阶段补产检节点、营养作息、情绪支持、内容来源，保留红线与医疗边界
- [x] 回归：`npm test` 70/70
- [ ] 仍需人工：上传 `lucky-maintenance` 云函数与 `lb-audit-logs` schema 到云端（HBuilderX）；推送/生物识别/导航栏动态改色待平台能力验证（见 docs/08 §8/§6）

### 端到端验证（2026-10-30，Web dev + 生产 uniCloud 空间）⛔ 部分阻塞

- [x] 云端可用性：登录/注册云对象调用正常返回（`lucky-id` ACCOUNT_NOT_EXISTS / 注册 token）
- [x] UI 流程（Playwright，390×844）：登录页 → 注册页 → 注册成功 → 引导页（备孕）→ 日期选择 → 建档 → 首页渲染
- [ ] **阻塞：页面生命周期钩子不触发**——HBuilderX 5.34 vapor 运行时下 `onLoad` / `onPageShow` 均未执行（页面 vm 的 `$onShow` 为空、首页无 `lucky-journey`/`lucky-data` 调用、token 为空时不跳登录页）。因此依赖生命周期加载数据的记录/数据/设置/计时器恢复等流程无法在 UI 层验证（详见 docs/08 §8.13）
- [x] API 级全生命周期：`test/e2e/lifecycle.test.js` 通过（注册→备孕→验孕→孕期→产检→分娩→产褥→育儿→家庭→数据→提醒→二宝→登出）
- [x] `npm test` 70/70；UI 布局 37 页 × 320/390/414/960 宽度无横向溢出
- [ ] 临时账号：`e2e3338914`、`e2e3339183`（密码 `e2ePass123`，未清理；可在冷静期入口注销，或等 purge 上线后清除）

## 中断恢复指引

Web 端已可用。后续运行只涉及：1) `npm test` 保持 70/70；2) 上传云函数前先跑 `scripts/sync_commons.sh`；3) 新增云函数 `lucky-maintenance` 与 `lb-audit-logs` 表需在 HBuilderX 上传/初始化；4) 真机运行/云打包按 docs/08 §5（需 HBuilderX 用户操作）；5) 如用户提出功能修改，按 docs/03 规范实现并回归测试（web 端限制见 docs/08 §8）。

## 体验迭代三波（2026-10-31）

按体验评审梳理的三波路线完成 18 项开发；`npm test` 101 → 108 全绿。

### 波一 · 体验修复
- [x] 喂养重做：奶量数字直输 + 6 档预设芯片 + 时间补记（默认现在）+ 方式/奶量记忆（`pages/baby/feeding.uvue`）
- [x] 图表 Y 轴基线自适应（胎动类保持 0 基线）+ 最新值高亮 + 明细倒序分批加载（`pages/data/charts.uvue`）
- [x] 时间线时区修复：日期列改本地时区，早 8 点前记录不再显示为前一天
- [x] lbc-error 接入首页/经期页/喂养页（约定测试门禁从 6 页扩到 9 页）
- [x] 经期「开始」展开补记卡带滚动与按钮态反馈，「结束」补防抖；双入口统一防重复提交
- [x] 键盘适配：weight/血压/血糖/BBT/引导页 confirm-type/@confirm；保存成功 toast 统一
- [x] 日期选择器封顶今天：weight/血压/血糖/验孕 LMP/引导页（`:end="todayDateStr()"`）

### 波二 · 留存三大件
- [x] 周期预测 v2：近 6 周期加权（旧1新3）、标准差→不确定度区间、置信度输出、BBT 双相参与排卵定位、试纸强阳优先；日历预测区间着色 + 「±N 天」图例 + 置信度文案（`lucky-record.predictCycle` + 3 个新单测）
- [x] 周报卡升级：`lucky-data.today.weekStats` 增 streakWeeks/todayDone/nextVisit（+单测）；首页本周小结透出连续周数徽标
- [x] App 端系统本地通知：`utils/notify.uts`（未来 14 天待办注册、每日+签名去重、完成待办清除；createPushMessage/clearPushMessage 运行时探测，旧基座静默降级）；manifest 已含 POST_NOTIFICATIONS

### 波三 · 差异化
- [x] 生命故事流：时间线按「备孕时光→孕期(孕周标签)→宝宝出生后(天数)」分章 + 生命故事卡（`pages/data/timeline.uvue`）
- [x] 爸爸端/家人视角：修复成员被误导向建档引导的流程断点——`lucky-family.myFamily`（+单测）、`journeyStore` 成员回退路径、join 回写角色、`today` 旅程视图补齐 weeks/postpartumDays、首页家人视角卡（角色说明+行动指引+下一项日程）
- [x] 英雄卡可点：进入生命故事时间线
- [x] 白带记录：schema 枚举 + 服务端校验 + 经期页日期可选芯片卡（+单测）
- [x] 排卵试纸拍照：chooseImage → uniCloud.uploadFile → photoUrl 随事件落库（服务端限长，+单测）
- [x] 用药提醒：设置页常用用药模板一键创建每日重复提醒（叶酸/铁剂/钙片/维D/DHA）
- [x] 引导页承诺屏：敏感仅本人 / 零广告零营销 / 数据可导出

- [ ] 仍需人工：HBuilderX 真机回归（本地通知、拍照上传、暗色 tabBar）；上传 `lucky-record`/`lucky-data`/`lucky-family` 云函数与 `lb-cycle-events` schema 变更到 uniCloud；`uni.createPushMessage` 基座可用性验证（运行时已做探测兜底）

## 上线前最后一轮验证（2026-10-31）

- [x] 云端部署：`scripts/sync_commons.sh` 后经 HBuilderX CLI 上传 `lucky-record` / `lucky-data` / `lucky-family` 三个云对象（逐个 "上传云对象…OK"）
- [x] 编译级验证：Android 云打包全量编译通过（44 页 + 组件，uni-app x 5.34 蒸汽模式）——过程中发现并修复 3 个存量选项式 `<script>` 组件（lbc-redline/lbc-card/lbc-disclaimer），并新增门禁测试防回流（109/109）
- [x] 真机回归载体：自定义调试基座 APK 已产出 `unpackage/debug/android_debug_vapor.apk`（22MB）
- [ ] schema 增量（lb-cycle-events 加 mucus 枚举）：CLI 对已存在 schema 一律"跳过上传"（HBuilderX CLI 限制）；已验证**非运行时阻断**——云对象以管理上下文写入、绕过 schema 校验，mucus 枚举由 lucky-record 服务端代码强校验（含单测）。补齐方式：HBuilderX 里右键该 schema → 上传（约 30 秒）
- [ ] 真机回归（无 USB 设备连接，无法自动执行）：安装上述 APK 后验证 ①本地通知锁屏弹达 ②试纸拍照上传 ③暗色模式切换 ④喂养/图表/故事流/爸爸端渲染 ⑤键盘与保存反馈
- [x] 已知低危项（2026-11-02 v4 已适配）：uvue CSS `animation-fill-mode` 仅支持 `forwards`，全仓已改为 forwards + 起始帧基态，不再产生编译告警
- [x] 提交入库：分波次 7 个 commit（docs 对标 / 波一 / 波二 / 波三 / 试纸拍照 / 组件修复 / 守护日志），`npm test` 109/109

### 真机回归补充（2026-10-31 第二轮自动化探测）

- adb（HBuilderX 自带 1.0.36）`devices list` 确认无设备连接（USB/无线均无）→ 真机回归物理阻塞，无法在本会话执行
- 新增 `scripts/device-regression.sh`：手机插入并允许 USB 调试后一键执行「安装 APK → 启动 → 分步截图 → dumpsys 通知证据 → logcat 快照」，回归结果自动落盘 `.screenshots/device-regression/`
- schema mucus 枚举：HBuilderX CLI 全量帮助确认无删除/强制更新 schema 的命令（仅 hosting delete），GUI 右键上传为唯一路径；已再次确认云对象走管理上下文写入，mucus 服务端强校验在产线即时生效，schema 属文档层差异

## 设计升级 v3「幸运小山丘」（2026-10-31，回应"毛坯房"反馈）

- [x] 品牌：新 logo（日出渐变圆角方 + bump 山丘弧线 + 幸运金 sparkle），重绘 app 图标/tabBar 图标/512 品牌标；`scripts/gen_icons.py` 重写（4× 超采样），品牌曲线语言贯穿 logo→tab→英雄卡
- [x] 首页英雄卡品牌化、宫格渐变芯片（首页+记录页）、卡题玫瑰短条、引导页品牌位、全仓渐变统一、同房入口锁形语义
- [x] 可读性：text-3 对比度 #B6AABB→#9E8DA5（4.5:1 基线），暗色同步
- [x] 门禁：109/109 测试全绿 + 云打包 44 页编译通过（新 APK 已含新品牌）
- [x] emoji 字形替换为自绘图标（`static/icons/*.png`，46 枚，零依赖生成；v4）、插画级空态（`empty-scene.png` + `lbc-empty` 四段式）、动画 fill-mode 适配（278 处 both→forwards + 延迟类基态）

## 精装二期（2026-10-31 下午，"所有页面友好、所有交互精心设计"）

- [x] 组件收口：lbc-dialog（统一弹窗，四页四种规格 → 一个组件）、lbc-empty（品牌空态+CTA）；主题新增 --lb-grad-1/2、--lb-white 令牌
- [x] 数据页首屏概览卡（本周记录/最近体重/下一项日程）+ 导出防双击；图表/时间线空态带 CTA；经期删除/退出登录换统一弹窗；经期日历热区 68→80rpx
- [x] 登录/注册 🤰 emoji 占位 logo → mark.png 品牌标（"太 low"的真正源头）
- [x] 首页：英雄卡加载骨架、宫格稳定取色（url 哈希）、goRecord 防污染、最近记录补血糖、产后宫格 8 项两整行
- [x] 门禁：109/109 测试 + 云打包编译通过（新 APK 已含全部精装）
- [x] learn 页 header 品牌化（mark.png 品牌条 + 知识库副标）；图标字体替代 emoji 已完成（v4 自绘图标集）；care/baby 子页标题条已补齐（feeding/diaper/sleep/growth/vaccines/album 共 6 页 9 处内容卡）；剩余可选：暗色导航栏（平台能力）

## 精装三期：子页推广（2026-10-31）

- [x] v3 标题条推广：learn(6)/family(4)/settings(6)/baby-home(3)/visit(1) 共 20 个卡题机械换装（脚本化，样式随页注入）
- [x] 账号链路品牌闭环：锁屏页/找回密码 emoji 徽章 → mark.png
- [x] 宝宝页『添加宝宝档案』常驻入口
- [x] 门禁：109/109 + 云打包编译通过
- [x] 至此 v3 覆盖：5 tab 页 + account 全链路 + care/baby/me 高频子页；仅剩低频页（agreement/about/privacy-policy 等静态文本页）为通用样式，无需强改

## Web 端 picker 平台缺陷排查与绕过（2026-10-31）

- 实测（浏览器自动化 + dev server）确认 HBuilderX 5.34 vapor Web 运行时三项缺陷：
  ①原生 picker 点击不创建弹层（从未工作）；②easycom 自定义组件模板不渲染（lbc-* 全体失效）；
  ③事件水合存在随机不稳定性
- 绕过：独立选择器页 pages/util/date-picker（月历/时+分芯片）+ utils/pickDate.uts
  （navigateTo + 本地存储轮询回传，跨页面实例可靠）；12 页 19 处全部接入；
  App 端保留组件原生 picker 路径
- 验证矩阵：跳转 ✓ / 日历渲染 ✓ / 选值 ✓ / 取消返回 ✓ / 确认回写在部分会话可复现、
  部分会话受③影响不稳定 → Web 渠道在此 HBuilderX 版本下不建议作为生产渠道
- 待办：真机回归（APK 走原生 picker 路径）+ HBuilderX 升级后 Web 复验 + schema 右键上传

## picker 收尾（2026-10-31 晚）

- [x] 选择器页交互最终形态：点日即回传 / 点分钟即完成（关键路径只依赖实测最可靠的格子点击，
      头部按钮退出关键路径）；109/109 + 云打包编译通过（b1675c9）
- [ ] Web 完整流程复验：需重启 HBuilderX 运行后再测——长跑 7h+ 数百次 HMR 的 dev 会话
      事件可靠性退化（缺陷③同源），新标签页实测仍随机
- [ ] 真机回归：adb 复测仍无设备（外部阻塞）；APK 原生 picker 路径不受 Web 缺陷影响
- [ ] schema mucus 枚举：云端复核仍未上传（外部阻塞，CLI 无更新通道）

## Web 复验前置（2026-10-31 深夜）

- 尝试脱离 HBuilderX 自启 h5 dev（uni.js -p h5 直启）：/main 入口解析依赖 HBuilderX
  私有编译管线，直启实例白屏且崩溃 → 已清理残留进程、释放 5173 端口
- 结论：Web 复验必须由 HBuilderX 重新「运行到浏览器」触发（同时即完成"重启运行"要求）
- 实验探针已清理（weight 页 disclaimer/date-input probe 与显式导入），109/109 全绿

## 精装 v4：图标化 · 插画空态 · 动效适配（2026-11-02）

- [x] 自绘图标集：`scripts/gen_icons.py` 扩展为 46 枚 `static/icons/*.png`（宫格/导航/选项/心情/试纸结果/红线/语义图标），与 tab/品牌标同一圆头笔触；`warn-danger` 用红线专用红
- [x] emoji 替换：首页 + 记录页宫格（44 处数据）、data/me/baby-home 导航与按钮、日记心情、排卵/验孕结果、睡眠/胎动/尿布/喂养选项、settings 用药、privacy 敏感组、6 页内联红线 + `lbc-redline` 组件、产检准备事项等；保留 ✓ ✕ ★ ☆ › 单色印刷符号
- [x] 插画级空态：`static/empty-scene.png`（山丘+太阳+幸运星+辉光）接入 `lbc-empty`，四段式「插画→标题→提示→CTA」
- [x] learn header 品牌化：mark.png 76rpx + 「幸孕记 · 知识库」+ 副标
- [x] 动画 fill-mode 适配：全仓 278 处 `both→forwards`，`lb-rise-1/2/3`、`lb-pop`、`lb-fade` 补起始帧基态
- [x] 门禁：`ui.test.js` 新增 3 条（fill-mode forwards+基态 / 功能性 emoji 禁用 / 图标资产引用存在），`npm test` 114/114 全绿
- [ ] 仍需真机验证：进场动画首帧在低端机上的观感（fill-mode 适配后未真机复测）

## 后续规划功能补齐（2026-11-02，V1.1–V1.3 可代码落地项）

- [x] 成长里程碑：`pages/baby/milestones`（四维目录/达成日期/备注/儿保沟通提示）+ 达成纪念卡与分享文案；后端 `lucky-baby.listMilestones` 补 monthFrom/monthTo
- [x] 辅食记录与 3 天观察：`pages/tools/solid-food-log`（新食物首记、待观察/待复试标记、反应回写）+ 辅食科普页入口；复用 `addFood/logFoodReaction/foodDashboard`
- [x] 用药记录：`pages/record/medication`（本人/宝宝两种对象、药名剂量备注、历史列表）+ 后端 `lucky-baby.listMedications`；时间线聚合用药事件（含药名剂量）
- [x] 饮水记录：`pages/record/water`（杯量预设、自定义、今日总量与目标进度、离线队列兜底）+ 提醒模板新增「喝水」；复用 `water` 指标白名单，不新增存储
- [x] 儿保体检：`lb-child-health` schema + `lucky-care.addChildHealth/listChildHealth` + `pages/care/child-health`（身高体重头围、医生结论与建议、下次体检；同步成长样本进入趋势页）；全量导出纳入该表
- [x] 报告体系：`lucky-data.report`（周期报告/阶段报告/年度报告，仅旅程主人）+ `pages/data/report`（三 Tab、数据一览、文案复制、打印入口）；数据页与周报卡形成完整回望链路
- [x] 宝宝发育科普卡：首页孕期限定「本周要点」卡，点按直达知识库
- [x] 二胎/新旅程闭环：设置页产后阶段显示「开始新的旅程」，确认后 `startNewJourney` + 刷新旅程状态；旧旅程数据完整保留
- [x] 门禁：新增 `test/unit/features-v15.test.js`（页面注册/后端方法/入口接线/饮水白名单/新旅程阶段），`npm test` 119/119 全绿
- [ ] 外部依赖（非代码可完成）：服务端远程推送需 uni-push 控制台配置与证书；AI 产检报告解读/试纸判读/儿保单识别需外部 AI 服务与合规评审；蓝牙硬件需平台 SDK；记录能力永久免费，不做付费墙
- [ ] 部署提醒：新增 `lb-child-health` schema 与 `lucky-care`/`lucky-baby`/`lucky-data` 方法需在 HBuilderX 重新上传云端后才生效

## 30 天清单与定版（2026-11-02）

- [x] 手机号验证码登录（默认入口，未配置短信自动降级账号密码）；短信账号注销/撤回闭环
- [x] 我的旅程：当前标记/切换/重命名/归档，服务端 currentJourneyId 持久化
- [x] 埋点下沉：所有记录写入由云对象统一上报 record_create；新增 report_view/share、reminder_due/open、family_join、journey_switch、feedback_submit；客户端重复事件清理
- [x] 运营看板：管理员只读聚合（用户/旅程/宝宝、7/30 天活跃、记录类型、激活漏斗、待处理反馈）
- [x] 合规：敏感个人信息单独同意（引导强制 + 首页补同意 + 隐私页补同意）、协议版本化、注销级联清理 lb-feedback/lb-events/lb-sms-codes、移除未用 HealthKit 权限
- [x] 反馈入口：应用内反馈 + 关于页联系方式说明 + 隐私政策联系方式对齐
- [x] 门禁：新增 account-journey-ops 测试（短信登录/注销撤回/同意/反馈/旅程/服务端埋点/看板权限），npm test 129/129 全绿
- [x] 定版：v1.0.0 功能冻结，发布清单见 docs/12；后续只做缺陷修复、体验优化与上线准备
- [ ] 外部阻塞：短信控制台配置、运营管理员 uid、云端上传（schema 与云对象）、服务端推送证书、法律复核、真机/云打包回归
