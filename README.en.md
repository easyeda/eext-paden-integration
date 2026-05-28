[简体中文](./README.md) | [English](#) | [繁體中文](./README.zh-Hant.md) | [日本語](./README.ja.md) | [Русский](./README.ru.md)

# PADEN Simulation

JLCEDA & EasyEDA Pro Extension — Extract PCB data and perform PDN Power Distribution Network FEM analysis

## Features

- Extract PCB traces, vias, pads, and copper pours from EasyEDA
- User-configurable power rails (voltage sources, current loads)
- Client-side pre-meshing (TypeScript earcut triangulation)
- Local Python backend for FEM solving
- WebGL voltage distribution and power density heatmap visualization

## Architecture

```
EasyEDA PCB
    │
    ▼
┌─────────────┐     ┌──────────────┐     ┌───────────────┐
│  extract.ts │────▶│  convert.ts  │────▶│   mesh.ts     │  Client pre-meshing
│  Extraction │     │  Conversion  │     │  Triangulation │
└─────────────┘     └──────────────┘     └───────┬───────┘
                                                   │
                                           format_version=2
                                                   │
                                                   ▼
                                         ┌─────────────────┐
                                         │  Python Backend  │
                                         │  main.py         │
                                         │  ├ solver.py     │  FEM solver
                                         │  ├ problem.py    │  Problem definition
                                         │  └ mesh_pure.py  │  Mesh data structures
                                         └────────┬────────┘
                                                  │
                                                  ▼
                                         ┌─────────────────┐
                                         │  results.html   │  WebGL visualization
                                         └─────────────────┘
```

## Usage Guide

### 1. Install this extension in JLCEDA Pro (3.0+)
After installation, configure the extension

![Click "Configure"](./images/img-1.png)

![Check "Allow external interaction"](./images/img-2.png)

### 2. The extension is available in the PCB editor under an engineering project

### 3. Access via the top menu bar: Advanced → PADEN Simulation → Run PDN Analysis

### 4. Select the analysis parameters and click Start Analysis

![Extract PCB data](./images/img-3.png)

![Extract PCB data](./images/img-4.png)


## Quick Start

### 1. Install frontend dependencies

```shell
npm install
```

### 2. Compile extension

```shell
npm run compile
```

Build for release:

```shell
npm run build
```

### 3. Start Python backend

```shell
cd paden-service
start-paden-windows.bat
```

`start-paden-windows.bat` will automatically:
- Pull latest `solver.py` and `problem.py` from GitHub
- Install Python dependencies (numpy, scipy, shapely, fastapi, uvicorn, matplotlib)
- Run syntax checks
- Start server on `localhost:5000`

### 4. Install in EasyEDA

1. Open JLCEDA Pro, enter PCB editor
2. Install the extension package. On first run, a backend service startup prompt will appear — follow the steps to start the service

![Start service](./images/img-5.png)

3. Select **PDN Analysis → Run PDN Analysis...** from the menu

## Project Structure

```
├── src/                    # TypeScript frontend
│   ├── index.ts            # Main entry, analysis orchestration
│   ├── extract.ts          # PCB data extraction (traces, vias, pads, copper)
│   ├── convert.ts          # Data conversion + pre-meshing + serialization
│   ├── mesh.ts             # Client-side triangulation (earcut half-edge)
│   ├── api.ts              # HTTP communication (with Python backend)
│   ├── display.ts          # Result display (IFrame + Storage + MessageBus)
│   └── types.ts            # Type definitions
├── ui/
│   ├── config.html         # Power rail configuration UI
│   ├── results.html        # WebGL visualization results
│   └── results.tpl.html    # Build template for results.html
├── paden-service/          # Python backend
│   ├── main.py             # FastAPI server (deserialization, solving, visualization)
│   ├── solver.py           # FEM solver (from GitHub)
│   ├── problem.py          # Problem definition (from GitHub)
│   ├── mesh_pure.py        # Mesh data structures (half-edge, differential forms)
│   ├── standby/            # solver.py + problem.py backup
│   └── start-paden-windows.bat           # One-click build & start script
├── config/                 # Build configuration
│   ├── esbuild.common.ts
│   └── esbuild.prod.ts
└── extension.json          # Extension manifest
```

## Workflow

1. **Extract data** — Extract traces, vias, pads, and copper areas from the current PCB
2. **Configure analysis** — Select power nets, set voltage sources and current loads
3. **Client pre-meshing** — TypeScript earcut triangulation on copper regions
4. **FEM solving** — Python backend receives pre-meshed data, builds Laplacian matrix, solves voltage distribution
5. **Visualization** — WebGL voltage heatmap with layer switching, mesh edges, via markers

## Tech Stack

**Frontend**: TypeScript, esbuild, WebGL, earcut

**Backend**: Python, FastAPI, numpy, scipy, shapely, matplotlib

**Dependencies**: `@jlceda/pro-api-types`, `earcut`

## License

This extension uses the [Apache License 2.0](https://choosealicense.com/licenses/apache-2.0/) open source license.
