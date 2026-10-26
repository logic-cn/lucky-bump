# 开发进度（DEV-PROGRESS）

> 本文件是自动巡检任务与开发过程的协调锚点：每次推进后必须更新并 git commit。
> 目标：完成 uni-app-x + uniCloud 全部编码并端到端测试，达到可上线级别。技术决策见 docs/06。

## 状态总览

- 当前阶段：**后端 100% 完成（E2E 10/10 通过）；前端骨架与核心页面完成，约 30 个页面待完整实现（骨架已就位，工程可打开可编译）**
- 最近更新：2026-10-26（第 1 轮开发）
- 测试：`npm test` → 10 pass / 0 fail（含端到端全生命周期测试）

## 已完成

### Phase 1 文档与设计 ✅
- 产品文档 01-05、技术架构 06（决策 A1-A7）、UI 设计系统 07、部署指南 08、本进度文件

### Phase 2 工程骨架 ✅
- manifest.json / pages.json（36 页全部注册且文件齐备）/ uni.scss 设计令牌 / App.uvue / main.uts / index.html / store / 36 个 .uvue / tabBar 图标（脚本生成）/ uniCloud 空间占位

### Phase 3 uniCloud 后端 ✅（全部零依赖 Node，本地全量验证）
- common/lucky-auth-common：HMAC token（uni-id 兼容语义 TOKEN_INVALID/EXPIRED）+ scrypt 密码 + 限速 + resolveJourneyAccess（owner/recorder/viewer）
- common/lucky-templates：产检模板 / 免疫规划疫苗程序表 / EPDS / IOM 增重 / 症状库（含红线码）/ 里程碑
- lucky-id：注册/登录/登出/资料/改密（uni-id-users 对齐）
- lucky-journey：建档/预产期计算（LMP/排卵/IVF D3-D5/B超校正锁定）/阶段推导/好孕确认/哀伤模式(30 天撤销)/分娩登记(多胎)/多旅程/归档/再备孕
- lucky-record：指标白名单（体重/血压/血糖/hCG/孕酮/症状/情绪/恶露/凯格尔/饮水/用药/胎动）+ 红线判定（血压/GDM 切点/症状词/恶露）+ 周期事件与排卵预测（试纸强阳覆盖日历）+ 计时器 + 5-1-1 宫缩判定 + EPDS（第 10 题特殊处理）
- lucky-baby：喂养/尿布（血便/陶土色红线）/睡眠/成长（WHO 百分位锚点插值 + 3rd/97th 提示）/疫苗计划（22 剂程序 + 自费目录）/里程碑/辅食（3 天观察窗 + 过敏仪表盘）/用药
- lucky-care：产检排程自动生成（4-2-1 节奏，15 条）/状态管理/产检记录（医生口径下次产检）
- lucky-family：家庭组/邀请码/角色/授权矩阵（intimate/screenings 硬编码不可授权）
- lucky-reminder：4 类规则 + 待办投影；lucky-data：today 聚合/曲线/时间线/导出（仅 owner）；lucky-seed：部署自检
- database/：23 张表 schema（clientDB 全锁死，读写仅经云对象）

### Phase 5 测试 ✅
- test/harness/unicloud-mock.js：内存版 uniCloud 运行时（DB API 子集 + 云对象 this 语义 + 固定时钟）
- test/unit/smoke.test.js + domain.test.js：账户/孕周恒等式/产检排程/疫苗/EPDS/5-1-1/百分位/授权矩阵/红线/周期预测
- test/e2e/lifecycle.test.js：备孕→验孕→好孕确认→孕期→产检→分娩→产褥→育儿→家庭共享（爸爸记录）→提醒→数据导出→权限边界→二宝回流→登出吊销

### Phase 4 前端（核心已完成，其余骨架就位）
- ✅ utils/request.uts（token 通道 + TOKEN_ 拦截跳登录 + 8 个云对象便捷方法）
- ✅ store/appStore.uts、journeyStore.uts（阶段镜像）
- ✅ pages/account/login、register（完整）
- ✅ pages/onboarding/onboarding（完整：三阶段建档流程）
- ✅ pages/index/index（完整：阶段大卡/待办/快捷宫格/趋势摘要）
- ✅ pages/record/record（完整：阶段动态分组宫格）

## 待完成（下一轮继续）

### A. 页面完整实现（骨架已有，规范见 docs/03 对应小节 + docs/07 组件）
- [ ] 记录表单：weight/blood-pressure/blood-glucose/symptom/diary/cycle/ovulation-test/pregnancy-test/lochia/epds（模式：表单类页面统一 顶部大数值输入+底部保存，调 luckyRecord.addMetric/addCycleEvent/submitEpds）
- [ ] 计时器：contraction-timer（5-1-1 提示调 contractionAdvice）、nursing-timer（调 startTracker/stopTracker）
- [ ] 产检：care/schedule（调 generatePlan/listPlan/updateItem）、care/visit（调 addVisit/listVisits）
- [ ] 宝宝：birth-register（registerDelivery）、baby-home/feeding/diaper/sleep（addXxx + dailySummary）、growth（addGrowth + getGrowthSeries）、vaccines（getVaccinePlan/recordVaccine）
- [ ] 数据：data/data Tab（入口）、data/charts（lbc-chart-line 或简化列表曲线）、data/timeline（luckyData.timeline）
- [ ] 我的：me/me（旅程切换/家庭/隐私/设置/关于入口）、me/family（getFamily/invite/join/setPermission）、me/privacy、me/settings（提醒规则 lucky-reminder CRUD）、me/about
- [ ] learn/learn（静态内容：本周指南文案表，可内置 JSON）

### B. 组件
- [ ] components/lbc-*：button/card/cell/field/stepper/redline/disclaimer（规范 docs/07 §3；页面当前用内联样式，组件化提升一致性）

### C. 上线收尾
- [ ] docs/08 §6 回归清单人工执行（需 HBuilderX/真机）
- [ ] 正式图标替换 static/icon.png 占位

## 需用户介入（不阻塞编码）

| 项 | 位置 | 指南 |
|---|---|---|
| HBuilderX 打开工程 + 生成 appid | manifest.json | docs/08 §2 |
| uniCloud 空间关联 | uniCloud-aliyun/spacex.json | docs/08 §2 |
| tokenSecret 正式密钥 | uni-config-center/uni-id/config.json | docs/08 §4（openssl rand -hex 32） |
| 短信/推送/打包证书 | 可选 | docs/08 §5 |

## 中断恢复指引

1. `git log --oneline -5` 看最近提交；2. 对照"待完成"清单按 A→B→C 顺序继续；3. `npm test` 必须保持 10/10；4. 每完成一个页面组即 commit 并勾选。
