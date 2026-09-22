# DeepSeek Enhancer（MVP v0.1.0）

选中 DeepSeek 回答文本 → 点击「引用」 → 自动插入输入框继续提问。完全本地运行，不上传数据。

## 安装（开发模式）

1. `npm install`
2. `npm run build`（产物在 `dist/`）
3. Chrome 打开 `chrome://extensions` → 开启开发者模式 → “加载已解压的扩展程序” → 选择 `dist/`。
4. 打开 `https://chat.deepseek.com/` 验证。

## 验证清单

- 普通回答 / 列表 / 标题 / 代码块中拖选 → 附近出现「引用」按钮，不超出屏幕；
- 点击后引用按 `“内容”\n\n` 进入正确的底部输入框；
- 已有草稿不丢失，插入到当前光标处，光标停在引用后可继续输入；
- 点击空白 / 滚动 / 缩放 / Esc 隐藏按钮；
- 选中输入框内文字不弹按钮；超长（>5000字）提示拒绝；
- 继续输入 / 删除 / 发送 / 刷新 / 新对话后功能仍可用，无控制台异常，不自动发送。

模拟页：`fixtures/mock-chat.html`（含历史回答、侧栏搜索框、底部输入框）。

## 命令

- `npm test`：Vitest 单元测试（quote / selection / popup / composer）
- `npm run typecheck`：TS 类型检查
- `npm run build`：生产构建
- `npm run dev`：开发构建（HMR）

## 隐私

- 仅在 `chat.deepseek.com` 运行 content script；无 `tabs/storage/cookies`/网络权限；
- 不收集、不上传、不持久化聊天内容；引用文本只保存在内存快照中，点击后即清除。

## 已知限制

- 真实 DeepSeek 输入框类型（textarea vs contenteditable / ProseMirror / Lexical）需在实页 DevTools 校准后补充优先选择器（见 `src/adapters/deepseek-composer.ts`）；
- React 受控组件已用原生 setter + `input` 事件同步，仍需在实页验证重渲染不消失；
- 深色主题 / 80%/125% 缩放需人工回归。
