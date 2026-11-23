#!/bin/bash
cd "$(dirname "$0")"
echo ""
echo "== 我的 AI 团队：一键安装 =="
echo ""
if ! command -v node >/dev/null 2>&1; then
  echo "还没装 Node.js。我帮你打开下载页面，下载 LTS 版本装好后，再双击一次这个文件。"
  open "https://nodejs.org/"
  read -p "按回车关闭"
  exit 1
fi
echo "Node.js 已经装好：$(node -v)"
install_pkg() {
  if command -v "$2" >/dev/null 2>&1; then echo "[已装好] $1"; return; fi
  echo ""
  echo "正在安装 $1 ..."
  if ! npm install -g "$3"; then
    echo ""
    echo "需要你的电脑开机密码才能安装。输入密码时屏幕上不会显示任何字，这是正常的，输完按回车。"
    sudo npm install -g "$3"
  fi
}
install_pkg "Claude Code（项目经理）" claude @anthropic-ai/claude-code
install_pkg "Codex（GPT，执行）" codex @openai/codex
install_pkg "Gemini CLI（出点子）" gemini @google/gemini-cli
echo ""
echo "== 安装完成，接下来依次登录三个 AI =="
echo "1. Claude：按提示用浏览器登录。登录完，输入 /exit 回车退出。"
echo "2. GPT：会打开浏览器，用 ChatGPT 账号登录。"
echo "3. Gemini：选 Login with Google，用浏览器登录。登录完，输入 /quit 回车退出。"
echo "哪个不想用，到它那一步直接按 Ctrl+C 跳过。"
echo ""
read -p "准备好了按回车开始"
claude
codex login
gemini
echo ""
echo "全部完成！以后双击「启动-Mac.command」就能用。"
read -p "按回车关闭"
