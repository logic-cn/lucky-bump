# 幸孕记 Lucky Bump

> 从备孕到育儿，一条不断档的生命记录。
> 覆盖「备孕 → 孕早/中/晚期 → 分娩 → 产褥期 → 产后恢复 → 0-3 岁育儿」全流程的孕期管理 APP。

## 技术栈

- **前端**：[uni-app-x](https://doc.dcloud.net.cn/uni-app-x/)（.uvue + UTS，原生渲染，覆盖 Android/iOS/Web）
- **后端**：uniCloud（阿里云版）云对象，24 张表 schema 全部锁死 clientDB，读写仅经云对象鉴权
- **账户体系**：uni-id 兼容自研实现（uni-id-users 表对齐，可无缝切换官方 uni-id-pages-x，见 docs/06 决策 A3）

## 快速开始

```bash
npm install        # 无必需依赖，测试用 Node 内置 test runner
npm test           # 运行全部测试（10 个，含端到端全生命周期测试）
npm run test:unit  # 单元测试
npm run test:e2e   # 端到端全生命周期测试
npm run icons      # 重新生成占位图标（Python3）
npm run schemas    # 重新生成数据库 schema
```

**真机/云打包**：用 HBuilderX（4.0+）打开工程根目录，按 [docs/08-部署与上线指南](docs/08-部署与上线指南.md) 三步接入（生成 appid → 关联 uniCloud 空间 → 上传云函数并初始化数据库）。

## 工程结构

```
├── pages/               # 36 个 .uvue 页面（账户/引导/今天/记录/产检/宝宝/数据/知识/我的）
├── components/lbc-*     # 设计系统组件（easycom）
├── store/ utils/        # 状态与请求层（云对象 RPC + token 拦截）
├── uniCloud-aliyun/
│   ├── cloudfunctions/  # 9 个云对象 + 2 个公共模块（零第三方依赖，Node 本地可测）
│   └── database/        # 24 张表 schema
├── test/                # 内存版 uniCloud 运行时 + 单元测试 + E2E 全生命周期
├── scripts/             # 图标/schema 生成脚本
└── docs/                # 产品文档 01-05 + 技术文档 06-08 + DEV-PROGRESS
```

## 文档

| 类别 | 文档 |
|---|---|
| 产品 | [01-需求分析](docs/01-需求分析报告.md) · [02-产品定位与功能架构](docs/02-产品定位与功能架构.md) · [03-核心功能详细设计](docs/03-核心功能详细设计.md) · [04-数据模型](docs/04-数据模型与页面结构.md) · [05-版本规划与指标](docs/05-版本规划与成功指标.md) |
| 技术 | [06-技术架构设计](docs/06-技术架构设计.md) · [07-UI设计系统](docs/07-UI设计系统.md) · [08-部署与上线指南](docs/08-部署与上线指南.md) |
| 专项 | [09-同类产品对标同类产品报告](docs/09-同类产品对标同类产品报告.md) · [10-HBuilderX平台缺陷报告](docs/10-HBuilderX平台缺陷报告.md) · [11-外部依赖与接入清单](docs/11-外部依赖与接入清单.md) |
| 过程 | [DEV-PROGRESS 开发进度](docs/DEV-PROGRESS.md) |

## 产品红线（研发必须遵守）

1. 不做诊断：所有提示只描述现象 + 建议就医（`lbc-redline` 组件）
2. 同房、验孕、EPDS 情绪自评：服务端硬编码仅本人可见，任何授权不可覆盖
3. 哀伤模式（流产/胎停）：零营销推送，硬编码不可配置
4. 记录功能永远免费，不做开屏第三方广告
