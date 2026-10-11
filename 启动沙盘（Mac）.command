#!/bin/bash
# 双击运行：在本机启动一个小网页服务器，打开光明区微缩沙盘（需要电脑上有 Python 3）
cd "$(dirname "$0")/dist" || exit 1
PORT=8790
echo "光明区微缩沙盘：http://localhost:$PORT  （关闭这个窗口即停止）"
(sleep 1.5 && open "http://localhost:$PORT") &
python3 -m http.server $PORT
