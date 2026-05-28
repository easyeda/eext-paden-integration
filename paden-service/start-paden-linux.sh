#!/usr/bin/env bash
set -e

echo "============================================"
echo "  paden-service build and start"
echo "============================================"
echo

# Check Python
PYTHON=""
if command -v python3 &>/dev/null; then
    PYTHON=python3
elif command -v python &>/dev/null; then
    PYTHON=python
else
    echo "[ERROR] Python not found"
    echo "Please install Python 3.8+ and try again"
    exit 1
fi

# Check required files
if [ ! -f "main.py" ]; then
    echo "[ERROR] main.py not found"
    echo
    echo "Please make sure this script is placed inside the paden-service directory:"
    echo "  paden-service/start-paden-linux.sh    <- here"
    echo "  paden-service/main.py"
    echo "  paden-service/solver.py"
    echo "  ..."
    exit 1
fi

echo "Using: $($PYTHON --version)"
echo

# Change to script directory
cd "$(dirname "$0")"

echo "[1/3] Checking local files..."

if [ -f "problem.py" ] && [ -f "solver.py" ]; then
    echo "       problem.py and solver.py already exist, skipping pull"
else
    if ! command -v curl &>/dev/null; then
        echo "[ERROR] curl not found, cannot pull from GitHub"
        exit 1
    fi

    if ! curl -fsSL -o problem.py https://raw.githubusercontent.com/atx/padne/master/padne/problem.py; then
        echo "[ERROR] Failed to download problem.py"
        exit 1
    fi
    echo "       problem.py  OK"

    if ! curl -fsSL -o solver.py https://raw.githubusercontent.com/atx/padne/master/padne/solver.py; then
        echo "[ERROR] Failed to download solver.py"
        exit 1
    fi
    echo "       solver.py   OK"
fi

$PYTHON -c "f=open('solver.py','r',encoding='utf-8');c=f.read();f.close();c=c.replace('from . import problem, mesh','import problem\nimport mesh_pure as mesh').replace('from . import problem','import problem');f=open('solver.py','w',encoding='utf-8');f.write(c);f.close()"
echo "       solver.py   patched"
echo

echo "[2/3] Installing dependencies..."
$PYTHON -m pip install numpy scipy shapely fastapi uvicorn pydantic matplotlib trimesh --quiet
if [ $? -ne 0 ]; then
    echo "[ERROR] pip install failed"
    exit 1
fi
echo

echo "[3/3] Syntax check..."
$PYTHON -c "import main" 2>&1
echo "       main.py     OK"
$PYTHON -m py_compile solver.py
echo "       solver.py   OK"
$PYTHON -m py_compile problem.py
echo "       problem.py  OK"
$PYTHON -m py_compile mesh_pure.py
echo "       mesh_pure.py OK"

echo
echo "============================================"
echo "  OK! Starting server on port 5000 ..."
echo "============================================"
echo
$PYTHON main.py
