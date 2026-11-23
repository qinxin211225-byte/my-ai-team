#!/bin/bash
cd "$(dirname "$0")"
# 双击时终端可能找不到 node：去常见位置找一个
NODE="$(command -v node 2>/dev/null)"
if [ -z "$NODE" ]; then
  for c in /opt/homebrew/bin/node /usr/local/bin/node "$HOME"/.nvm/versions/node/*/bin/node "$HOME"/.volta/bin/node "$HOME"/.local/share/*/node/*/bin/node "$HOME"/.local/bin/node; do
    if [ -x "$c" ]; then NODE="$c"; break; fi
  done
fi
if [ -z "$NODE" ]; then
  echo "没找到 Node.js。请去 https://nodejs.org 下载 LTS 版本安装，然后再双击这个文件。"
  open "https://nodejs.org/"
  read -p "按回车关闭"
  exit 1
fi
"$NODE" server.js
