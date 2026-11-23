# 我的 AI 团队

一个工作群：Claude 当项目经理，Gemini 出点子，GPT 执行。你在群里说一句需求，它们自己拆活、分工、对比方案，关键的地方弹出拍板卡让你决定。你随时可以 @ 某个成员插话。

**原理和 T3 Code 一样**：不走 API，而是调用你电脑上登录好的 Claude Code、Codex、Antigravity CLI（Gemini）。命令行版和网页版、App 是同一个账号、同一份会员，所以不额外花钱（会用掉各家会员的额度）。

## 用起来

**1. 装 Node.js**（18 以上）：https://nodejs.org ，下载 LTS 版本，一路下一步。

**2. 启动**，选一种：
- 双击 `启动-Mac.command`（Windows：`启动-Windows.bat`）
- 或者在终端里进到这个文件夹，运行 `node server.js`

浏览器会自动打开 http://localhost:3939 。

**3. 接上三个 AI**：点左下角任意一个成员，打开「团队体检」：
- 没安装的点「一键安装」
- 按提示在终端里运行一次登录命令（`claude`、`codex login`、`agy`），用你的会员账号登录
- 点「测试连接」，显示"测试通过"就接上了

没接上的成员会先用"演示回复"，流程照样能走一遍。

> 也可以双击 `一键安装-Mac.command` / `一键安装-Windows.bat`，在终端里一次装好三个并依次登录。

## 怎么用

- **说需求**：直接在群里说，比如"下周想发一期视频，帮我想选题"。
- **插话**：点输入框下面的 `@Gemini` 等，直接找某个成员。
- **拍板**：橙色卡片是给你拍板的，点"就这么干""换成备选"，或者直接打字说意见。
- **进度**：右边泳道显示每一步谁在干、干到哪，点一格跳到那段对话。AI 写的内容会边写边显示。
- **公司规章**：左下角，写一次（账号定位、说话风格等），所有 AI 都照着做。
- **新任务**：左上角。旧任务留在左边列表里，随时能翻看。

## 关于 Gemini

Google 已经不让 Gemini CLI 用会员账号登录了。现在 Gemini 会员（Google AI Pro）要通过 **Antigravity CLI**（命令 `agy`）来用。这里和 T3 Code 一样，通过官方的 `agy acp` 接口调用它。

- 安装：`curl -fsSL https://antigravity.google/cli/install.sh | bash`（团队体检里点「一键安装」也行）
- 登录：终端里运行一次 `agy`，用你有 Pro 会员的 Google 账号登录
- 注意：第三方工具调用 Antigravity 在 Google 条款里还属于灰色地带，T3 Code 也是这样接的。介意的话可以在 `team.json` 里把 Gemini 去掉。

## 你的数据放在哪

聊天记录、公司规章都在你电脑的 `~/.my-ai-team/` 文件夹里，只在本机。更新程序不会丢。

## 调整团队

想改角色、擅长、短板，或者换项目经理：把 `team.json` 复制到 `~/.my-ai-team/team.json` 再改，重启生效。
- `pm`：谁当项目经理
- `role` / `strengths` / `weaknesses`：项目经理按这些派活
- `command` / `args`：怎么调用这个 AI 的命令行，一般不用动

## 演示模式

`node server.js --demo`：所有成员都用演示回复，适合给别人演示流程。
