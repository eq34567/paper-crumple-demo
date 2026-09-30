@echo off
chcp 65001 >nul
title 纸团页面 · 本地服务器
cd /d %~dp0

set PORT=8123

rem 端口已被占用 = 服务器已在运行，直接打开页面即可
netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul 2>&1
if not errorlevel 1 (
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

rem 依次尝试 py / python / python3 / node，哪个能用用哪个
where py >nul 2>&1
if not errorlevel 1 (
    start "" "http://localhost:%PORT%/"
    py -3 -m http.server %PORT%
    goto :end
)
where python >nul 2>&1
if not errorlevel 1 (
    start "" "http://localhost:%PORT%/"
    python -m http.server %PORT%
    goto :end
)
where python3 >nul 2>&1
if not errorlevel 1 (
    start "" "http://localhost:%PORT%/"
    python3 -m http.server %PORT%
    goto :end
)
where node >nul 2>&1
if not errorlevel 1 (
    start "" "http://localhost:%PORT%/"
    node "%~dp0serve.js" %PORT%
    goto :end
)

echo.
echo [错误] 没找到 python 或 node，无法启动本地服务器。
echo 请安装 Python ^(https://www.python.org^) 或 Node.js ^(https://nodejs.org^) 后再双击本文件。
echo.

:end
pause
