@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1
cd /d "%~dp0"
echo ============================================
echo   paden-service build and start
echo ============================================
echo.

where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python not found
    pause
    exit /b 1
)

if not exist "main.py" (
    echo [ERROR] main.py not found
    echo.
    echo Please make sure this script is placed inside the paden-service directory:
    echo   paden-service\start-paden-windows.bat    ^<- here
    echo   paden-service\main.py
    echo   paden-service\solver.py
    echo   ...
    pause
    exit /b 1
)

echo [1/3] Checking local files...

if exist "problem.py" if exist "solver.py" (
    echo        problem.py and solver.py already exist, skipping pull
    goto :patch_solver
)

where curl >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] curl not found, cannot pull from GitHub
    pause
    exit /b 1
)

curl -fsSL -o problem.py https://raw.githubusercontent.com/atx/padne/master/padne/problem.py
if %errorlevel% neq 0 (
    echo [ERROR] Failed to download problem.py
    pause
    exit /b 1
)
echo        problem.py  OK

curl -fsSL -o solver.py https://raw.githubusercontent.com/atx/padne/master/padne/solver.py
if %errorlevel% neq 0 (
    echo [ERROR] Failed to download solver.py
    pause
    exit /b 1
)
echo        solver.py   OK

:patch_solver
python -c "f=open('solver.py','r',encoding='utf-8');c=f.read();f.close();c=c.replace('from . import problem, mesh','import problem\nimport mesh_pure as mesh').replace('from . import problem','import problem');f=open('solver.py','w',encoding='utf-8');f.write(c);f.close()"
echo        solver.py   patched
echo.

echo [2/3] Installing dependencies...
pip install numpy scipy shapely fastapi uvicorn pydantic matplotlib trimesh --quiet
if %errorlevel% neq 0 (
    echo [ERROR] pip install failed
    pause
    exit /b 1
)
echo.

echo [3/3] Syntax check...
python -c "import main" 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Syntax check failed on main.py
    pause
    exit /b 1
)
python -m py_compile solver.py
if %errorlevel% neq 0 (
    echo [ERROR] Syntax check failed on solver.py
    pause
    exit /b 1
)
python -m py_compile problem.py
if %errorlevel% neq 0 (
    echo [ERROR] Syntax check failed on problem.py
    pause
    exit /b 1
)
python -m py_compile mesh_pure.py
if %errorlevel% neq 0 (
    echo [ERROR] Syntax check failed on mesh_pure.py
    pause
    exit /b 1
)

echo.
echo ============================================
echo   OK! Starting server on port 5000 ...
echo ============================================
echo.
python main.py
pause
