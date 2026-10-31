# HBuilderX 5.34 vapor Web 运行时缺陷报告（可直接提交 DCloud）

> 项目实测环境：HBuilderX 5.34.2026102909（内含 cli v1.0.0.0）· uni-app x（vapor 模式，字节码渲染）·
> 运行到浏览器（h5）· macOS arm64（darwin 27.2.0）· Chrome/IAB 最新版
> 验证方式：浏览器自动化（Playwright DOM 断言 + 编程式事件派发）+ 编译产物分析（vite 模块源码核对）
> 以下三项缺陷在同一环境一次性实测复现，附绕过方案与建议。

## 缺陷①：`<picker>` Web 端点击不创建弹层（功能性失效）

**现象**：uni-app x 项目（vapor）运行到浏览器后，`<picker mode="date/time">` 包裹的触发区域点击后**不出现任何选择弹层**；对宿主元素 `v-uni-picker` 执行编程式 `element.click()` 同样无效；点击后 DOM 中不存在任何弹层节点（`querySelector` 全文档断言为 0）。

**已排除**：
- 宿主元素正常渲染且 props 绑定正确（`mode/value/end` 属性均在 DOM 上）
- 与业务代码无关：最小化到纯 `<picker>` + 静态子元素仍复现
- 与 `:end`/`:value` 绑定方式无关（移除后仍复现）

**影响**：Web 端所有日期/时间/选择器交互静默失效（无报错、无降级提示）。

**绕过**：自绘选择器页面（页面级模板渲染正常），通过 `uni.navigateTo` + 本地存储轮询回传结果。

## 缺陷②：easycom 自定义组件模板在 Web 端不渲染（仅透传 slot）

**现象**：easycom 自定义组件（含/不含 props）在 Web 端宿主元素内**不渲染自身模板**，仅透传页面传入的 slot 内容；无 slot 传入时宿主完全为空。静态内容组件（无任何 props、纯默认文案）同样渲染为空。

**编译产物证据**：页面模块以 `_createAssetComponent("lbc-xxx", {...})` 实例化组件（vue vapor 路径），组件自身模块的 render 函数完整（vapor `_template/_child` API 正确包含模板节点），但运行时 DOM 中宿主下只有 slot 内容——**渲染管线在 vapor Web 下丢失了组件自身模板的挂载**。

**影响**：Web 端所有依赖自定义组件的 UI 静默失效（错误重试块、红线就医提示、免责声明、确认弹窗、空态引导等），且无任何控制台报错，难以察觉。

**绕过**：Web 端（`#ifdef WEB`）以页面级内联模板替代组件；App 端不受影响。

## 缺陷③：长会话下 Web 端事件响应随机失效

**现象**：dev 会话连续运行数小时并经历大量 HMR 更新后，页面内 `@click` 处理器随机不再触发（同一处理器早期可正常触发，后期同协议复测时好时坏；`window.onerror`/`unhandledrejection` 均无捕获）。冷启动新标签页不能恢复，重启 dev 会话后恢复。

**影响**：长开发会话中的调试结论不可信；若生产构建受同样机制影响则表现为用户端随机点击失效。

**建议**：请 DCloud 侧确认 vapor Web 运行时在 ①`_createAssetComponent` 挂载、②`v-uni-picker` 弹层创建、③长时间 HMR 后的事件绑定三个环节的实现状态，或提供已知问题/修复版本号。

## 复现要点（供 QA）

1. HBuilderX 5.34 新建 uni-app x 项目（默认 vapor）
2. 首页放 `<picker mode="date"><view><text>pick</text></view></picker>` → 运行到 Chrome → 点击 → 无弹层
3. 新建 easycom 组件（静态默认文案）→ 页面引用 → Web 端宿主为空，slot 内容直接透传
4. 项目实测源码结构可参考：`pages/util/date-picker.uvue`（自绘选择器绕过实现）与 `components/lbc-*`

---

*本报告由幸孕记（Lucky Bump）项目团队整理，实测脚本与证据链见项目仓库 docs/DEV-PROGRESS.md。*
