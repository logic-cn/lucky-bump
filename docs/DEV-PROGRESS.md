# 开发进度（DEV-PROGRESS）

> 本文件是自动巡检任务与开发过程的协调锚点：每次推进后必须更新并 git commit。
> 目标：完成 uni-app-x + uniCloud 全部编码并端到端测试，达到可上线级别。技术决策见 docs/06。

## 状态总览

- 当前阶段：**编码工作全部完成** —— 后端 100%、前端 36 页全部真实实现（零骨架残留）、端到端测试 13/13 通过
- 最近更新：2026-10-27（巡检轮次 2：质量修复）
- 测试：`npm test` → 17 pass / 0 fail（含端到端全生命周期测试、防爆破限速、部署自检、静态一致性回归网）

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
- [x] 阿里云空间 lucky-bump（<旧阿里云空间ID>）已关联工程（spacex.json 已回填）
- [x] 9 云对象 + 3 公共模块经 HBuilderX CLI 上传成功；24 张 schema 上传；--initdatabase 完成
- [x] 生产 tokenSecret 生成并随 uni-config-center 兼容层部署（真实值 gitignore，模板入库）
- [ ] 剩余人工：真机运行/云打包（HBuilderX 一键）、§6 回归清单（真机项）
- 已知 CLI 限制：`--run cloudobject` 阿里云下仅本地调试，云端冒烟由首屏登录自然覆盖

## 遗留说明（不阻塞上线评审）

1. AI 报告识别（V1.1 会员功能，路线图见 docs/05）；前端已预留入口位。
2. 媒体上传（报告照片/日记图片）需 uniCloud 存储空间，前端已留 fileID 占位逻辑。
4. lbc 组件库为最小集（card/redline/disclaimer），按钮与表单组件在页面内联实现，后续可增量抽取。
5. 应用锁的端上强制执行（隐私页开关已落本地存储）：触发时机为 App onShow，需接入原生生物识别能力（HBuilderX 环境配置，见 docs/08 §7 依赖用户环境）。

## 中断恢复指引

编码已完成。后续运行只涉及：1) `npm test` 保持 10/10；2) 按用户在 docs/08 的介入项推进部署；3) 如用户提出功能修改，按 docs/03 规范实现并回归测试。
