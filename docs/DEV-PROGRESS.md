# 开发进度（DEV-PROGRESS）

> 本文件是自动巡检任务与开发过程的协调锚点：每次推进后必须更新并 git commit。
> 目标：完成 uni-app-x + uniCloud 全部编码并端到端测试，达到可上线级别。技术决策见 docs/06。

## 状态总览

- 当前阶段：**架构与设计文档完成，进入编码阶段**
- 最近更新：2026-10-26

## 任务清单

### Phase 1 文档与设计
- [x] 产品文档 01-05（已完成于编码前）
- [x] git 仓库初始化 + 文档基线提交
- [x] docs/06-技术架构设计（架构师决策记录 A1-A7）
- [x] docs/07-UI设计系统（设计令牌 + lbc 组件清单）

### Phase 2 工程骨架
- [ ] uni-app-x 工程骨架：manifest.json / pages.json / App.uvue / main.uts / uni.scss / index.html / package.json
- [ ] static 图标（脚本生成）+ .gitignore 完善
- [ ] store（appStore/userStore/journeyStore）与 utils（request/date/pregnancy/prenatal/vaccine/format）

### Phase 3 uniCloud 后端（零依赖 Node.js，本地可测）
- [ ] database/*.schema.json + db_init.json（产检模板/疫苗程序表）
- [ ] common/lucky-auth-common（HMAC token，uni-id 兼容语义）
- [ ] lucky-id（注册/登录/token/资料）
- [ ] lucky-journey（建档/孕周计算/阶段切换/哀伤模式/多旅程）
- [ ] lucky-record（周期/指标/症状/计时/恶露/EPDS）
- [ ] lucky-baby（喂养/尿布/睡眠/成长/疫苗/里程碑/辅食/用药）
- [ ] lucky-care（产检日程生成/产检记录）
- [ ] lucky-family（家庭组/授权矩阵）
- [ ] lucky-reminder（提醒规则/排程投影）
- [ ] lucky-data（今日聚合/曲线/时间线/导出）
- [ ] lucky-seed（基础模板初始化）

### Phase 4 前端页面（.uvue）
- [ ] 登录/注册/账户
- [ ] onboarding 引导与建档
- [ ] 今天（阶段化首页）
- [ ] 记录 Tab + 表单记录页 + 计时器（宫缩/亲喂）
- [ ] 产检中心（日程/详情）
- [ ] 宝宝（分娩登记/喂养/尿布/睡眠/成长/疫苗）
- [ ] 数据（曲线/时间线）
- [ ] 我的（家庭/隐私/设置/关于）
- [ ] lbc 组件库

### Phase 5 测试
- [ ] test/harness/unicloud-mock.js（内存版 uniCloud 运行时）
- [ ] 单元测试（token/孕周/产检模板/疫苗/5-1-1/EPDS/百分位/授权）
- [ ] 端到端全生命周期测试（备孕→孕期→分娩→产后→育儿→二宝）
- [ ] 前端静态检查（uvue 结构/路由对齐 pages.json）

### Phase 6 上线收尾
- [ ] 部署文档（HBuilderX 步骤/密钥占位回填清单）
- [ ] README 更新 + 最终提交

## 需用户介入（编码不阻塞，占位已留）

| 项 | 位置 |
|---|---|
| uniCloud spaceId/clientSecret | uniCloud-aliyun/spacex.json（占位文件，HBuilderX 关联空间后回填） |
| DCloud appid | manifest.json（占位） |
| 短信服务商配置 | lucky-id config 占位（未配置时关闭短信注册，账号密码可用） |
| iOS/Android 打包证书 | HBuilderX 云打包 |

## 中断恢复指引

1. `git log --oneline -5` 看最近提交；2. 对照上面任务清单找到第一个未勾选项继续；3. `npm test`（若依赖已装）验证现状；4. 完成后更新本文件并提交。
