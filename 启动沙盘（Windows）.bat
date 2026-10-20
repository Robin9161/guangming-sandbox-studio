@echo off
chcp 65001 >nul
rem 双击运行：在本机启动一个小网页服务器，打开光明区微缩沙盘
cd /d "%~dp0dist"
set PORT=8795
echo 光明区微缩沙盘：http://localhost:%PORT%  （关闭这个窗口即停止）
start "" "http://localhost:%PORT%"
where python >nul 2>nul && (python -m http.server %PORT% & goto :eof)
where npx >nul 2>nul && (npx --yes serve -l %PORT% . & goto :eof)
echo 没有找到 Python 或 Node.js，请先安装其中一个（见 README.md）。
pause
