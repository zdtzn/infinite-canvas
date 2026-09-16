# Tigerowo 第一批兼容移植 Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** 在现有命名、主题、账户和持久化体系内补齐素材筛选、摄影参数、媒体衍生工具及画布交互。

**Architecture:** 保留 Bun/Vite 和现有 storageKey、任务网关、撤销历史。借鉴 tigerowo/infinite-canvas@f30b8d7 的功能，不导入其 Next/Go 运行时。重型媒体依赖只在用户发起处理时加载。三个独立模块并行实现，主代理负责画布入口接线、快捷键及合并验收；不得提交部署。

**Tech Stack:** React 19、Ant Design 6、TypeScript、Bun SQLite、Vite、按需加载媒体处理。

## Task 1: 素材分类及筛选

- Files: `server/lib/asset-library.ts`、`server/db/database.ts`、`server/index.ts`（仅素材接口）、`web/src/stores/use-asset-store.ts`、`web/src/pages/assets/index.tsx`、`web/src/components/canvas/asset-picker-modal.tsx`、相关 API 类型。
- 先添加缺失分类、空分类兼容、类别和标签组合、跨用户隔离及分页测试，执行最近的 Bun 测试观察失败。
- 新增可选 `category`，保留旧素材；标签沿用现有数组。服务端分页前应用筛选，返回全量范围分类/标签选项；所有查询保持 owner 隔离。
- 本地与托管入口共享筛选语义，切换筛选回第一页，提供清空选项，不下载全库来筛选。
- 验收：旧记录导入/导出、更新、空结果、分页、账户切换均不丢数据。

## Task 2: 摄影参数

- Create: `web/src/lib/canvas/canvas-camera.ts`、对应 `.test.ts`、`web/src/components/canvas/canvas-camera-dialog.tsx`。
- Modify: `web/src/types/canvas.ts`（可选 camera 字段）；画布主入口由主代理统一接入。
- 首先验证默认关闭不改提示词、无效参数被过滤、应用多次不重复、文本/音频不受影响。
- 提供机身/镜头/焦距/光圈与清除，保存节点 metadata，采用标记段幂等组合，明确仅为模型提示引导。
- 接入图片/视频/配置节点，不绕开现有生成上下文、引用、渠道与任务。

## Task 3: 媒体衍生工具

- Create: `web/src/lib/canvas/canvas-media-tools.ts`、对应 `.test.ts`、`web/src/components/canvas/canvas-media-tools-dialog.tsx`。
- 验证时间范围边界、非法时长、资源错误和取消；保留原媒体，只返回新的 Blob/File 与准确 MIME。
- 视频支持首帧/当前指定时间/尾帧、提取音频；音频支持试听与裁剪，含忙碌、错误、取消、资源释放。
- 音频转换依赖动态加载；不得在首页入口导入。通过现有 uploadImage/uploadAudio 入库，不添加公开上传接口。
- 主代理负责回写新节点/连线，校验项目、用户、源节点仍有效，单次记录撤销。

## Task 4: 画布接入及快捷键

- Modify: `web/src/pages/canvas/project.tsx`、`web/src/components/canvas/canvas-context-menu.tsx`、`web/src/components/canvas/infinite-canvas.tsx`。
- 新增 Ctrl/Command+G 分组、Shift+Ctrl/Command+G 解组，输入框/弹窗/IME/锁定保护；复用既有分组动作。
- 失去焦点/按钮释放后停止平移，保留双指缩放与既有选择规则。
- 摄影和媒体操作从现有右键菜单进入，清楚显示禁用状态。

## Task 5: 验证与交付

- Targeted: `cd web; bun test <新增或修改的测试文件>`，先红后绿。
- Gates: `bun run typecheck`、`bun run test`、`bun run build`、`git diff --check`。
- Browser: 桌面和窄屏检查素材筛选、摄影保存/清除、截帧/裁音/取消、撤销；尽量用本地合成媒体，不运行付费生成。
- Browser unavailable: 明确报告工具故障，不将静态测试描述成界面验收。
- 更新 CHANGELOG、pending-test、todo；第二批模板/全景及可选存储协议保留为后续范围，不宣称已完成。

## 执行记录

- 三个子代理留下初稿后因用量限制中止，主代理接手完成接线、修复类型与状态问题。
- 新媒体位置自动避让已有节点；远端素材编辑直接保存完整记录并等待确认，避免未载入局部缓存的记录无法编辑。
- Chrome 隔离会话合成 2 秒 MP4 验证三种截帧及音轨转换，裁剪后解码时长 1 秒；页面验证摄影持久化、清除、分类过滤、390px 无横向溢出、新节点插入及撤销/重做、组合/取消组合。
- 构建将媒体工具弹窗和音频转换依赖分开按需加载；没有部署或付费生成。生产登录态和其他浏览器剩余项目见 pending-test。
- 最终检查：603 项测试通过、0 失败；前后端 TypeScript、生产构建及 git diff --check 通过。模拟服务端浏览器用例确认不在本地缓存中的记录完成一次 PUT，分类改变且原内容保留；这不等同于真实生产登录态验证。
- 按交付 QA 和 React 性能技能，补充真实浏览器媒体解码、移动端截图、撤销重做验收，并保持摄影/媒体弹窗与音频处理库按需加载。
