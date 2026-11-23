# 我的 AI 团队（v0）

一个工作群，Claude 当项目经理，Gemini 出点子，GPT 执行。你在群里说一句需求，它们自己拆活、分工、对比方案，关键的地方弹出拍板卡等你决定。

- 用的是你电脑上**已经登录好的** Claude Code、Codex、Gemini CLI，不用 API key，不额外花钱（会用掉各家订阅的额度）。
- 全部在你自己电脑上跑，对话存在本文件夹的 `data/` 里。
- 某个 AI 没装也能打开，它会先用"演示回复"带你走一遍流程。

## 第一次用（最简单的方法）

1. 装 Node.js：https://nodejs.org ，下载 LTS 版本，一路下一步。
2. 双击 `一键安装-Mac.command`（Windows：`一键安装-Windows.bat`），它会自动装好三个 AI，再带你依次登录。
3. 双击 `启动-Mac.command`（Windows：`启动-Windows.bat`）。

## 第一次用（手动装）

**1. 装 Node.js**（18 以上）：https://nodejs.org ，下载 LTS 版本，一路下一步。

**2. 装你想用的 AI，并登录**（打开"终端"，Windows 叫"命令提示符"或 PowerShell）：

| 成员 | 安装 | 登录 |
|---|---|---|
| Claude（项目经理） | `npm install -g @anthropic-ai/claude-code` | 运行 `claude`，按提示登录 |
| GPT（执行） | `npm install -g @openai/codex` | `codex login` |
| Gemini（出点子） | `npm install -g @google/gemini-cli` | 运行 `gemini`，按提示用 Google 账号登录 |

只装 Claude 也能用，没装的成员会显示"演示"。

**3. 启动**
- Mac：双击 `启动-Mac.command`（第一次如果提示"无法打开"，右键 → 打开）
- Windows：双击 `启动-Windows.bat`
- 或者在终端里进到这个文件夹，运行 `node server.js`

浏览器会自动打开 http://localhost:3939 。不想用了，关掉那个黑色窗口就行。

## 怎么用

- **说需求**：直接在群里说，比如"下周想发一期视频，帮我想选题"。
- **插话**：点输入框下面的 `@Gemini` 之类，直接找某个成员。
- **拍板**：橙色的卡片是给你拍板的，点"就这么干""换成备选"，或者直接打字说意见。
- **右边的进度**：每一步谁在干、干到哪，点一格跳到那段对话。
- **公司规章**：左下角，写一次（账号定位、说话风格等），所有 AI 都照着做。
- **新任务**：左上角，旧任务会留在左边列表里，可以随时翻看。

## 想调整团队

打开 `team.json`：
- `pm`：谁当项目经理（填成员的 id）
- 每个成员的 `role`（角色）、`strengths`（擅长）、`weaknesses`（短板）：项目经理会按这些派活，改了就会按新的来
- `command` 和 `args`：怎么调用这个 AI 的命令行，一般不用动

改完重新启动生效。

## 演示模式

`node server.js --demo`：所有成员都用演示回复，适合给别人演示流程。
