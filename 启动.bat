@echo off
chcp 65001 >nul
title 纸团页面 · 本地服务器
cd /d %~dp0

set PORT=8123

rem 端口已被占用 = 服务器已在运行，直接打开页面即可
netstat -ano | findstr ":%PORT% .*LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo 服务器已在运行: http://localhost:%PORT%/
    start "" "http://localhost:%PORT%/"
    timeout /t 3 >nul
    exit /b 0
)

echo ============================================
echo   纸团页面 Paper Crumple Demo
echo   地址: http://localhost:%PORT%/
echo   关闭本窗口即停止服务器
echo ============================================
start "" "http://localhost:%PORT%/"
python -m http.server %PORT%
