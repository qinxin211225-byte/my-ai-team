@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo == 我的 AI 团队：一键安装 ==
echo.
where node >nul 2>nul || (echo 还没装 Node.js。我帮你打开下载页面，下载 LTS 版本装好后，再双击一次这个文件。& start "" https://nodejs.org/ & pause & exit /b)
where claude >nul 2>nul || (echo 正在安装 Claude Code... & call npm install -g @anthropic-ai/claude-code)
where codex >nul 2>nul || (echo 正在安装 Codex... & call npm install -g @openai/codex)
where gemini >nul 2>nul || (echo 正在安装 Gemini CLI... & call npm install -g @google/gemini-cli)
echo.
echo == 安装完成，接下来依次登录三个 AI ==
echo 1. Claude：按提示用浏览器登录。登录完，输入 /exit 回车退出。
echo 2. GPT：会打开浏览器，用 ChatGPT 账号登录。
echo 3. Gemini：选 Login with Google，用浏览器登录。登录完，输入 /quit 回车退出。
echo 哪个不想用，到它那一步直接按 Ctrl+C 跳过。
pause
call claude
call codex login
call gemini
echo.
echo 全部完成！以后双击「启动-Windows.bat」就能用。
pause
