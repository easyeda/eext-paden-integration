[简体中文](#) | [English](./README.en.md) | [繁體中文](./README.zh-Hant.md) | [日本語](./README.ja.md) | [Русский](./README.ru.md)

# PADEN仿真

嘉立创EDA & EasyEDA 专业版扩展 — 从 PCB 提取数据并进行 PDN 电源分配网络 FEM 分析

## 功能

- 从 EasyEDA 提取 PCB 走线、过孔、焊盘、铺铜数据
- 用户配置电源轨道（电压源、电流负载）
- 客户端预网格化（TypeScript earcut 三角剖分）
- 调用本地 Python 后端进行 FEM 求解
- WebGL 可视化电压分布和功率密度热力图

## 架构

```
EasyEDA PCB
    │
    ▼
┌─────────────┐     ┌──────────────┐     ┌───────────────┐
│  extract.ts │────▶│  convert.ts  │────▶│   mesh.ts     │  客户端预网格化
│  数据提取    │     │  数据转换     │     │  三角剖分      │
└─────────────┘     └──────────────┘     └───────┬───────┘
                                                   │
                                           format_version=2
                                                   │
                                                   ▼
                                         ┌─────────────────┐
                                         │  Python 后端     │
                                         │  main.py         │
                                         │  ├ solver.py     │  FEM 求解
                                         │  ├ problem.py    │  问题定义
                                         │  └ mesh_pure.py  │  网格数据结构
                                         └────────┬────────┘
                                                  │
                                                  ▼
                                         ┌─────────────────┐
                                         │  results.html   │  WebGL 可视化
                                         └─────────────────┘
```

## 使用流程

### 1.在嘉立创EDA专业版（3.0+）中安装本扩展
安装完后进行配置

![点击“配置”](./images/img-1.png)

![勾选“允许外部交互”](./images/img-2.png)

### 2.在工程设计下，PCB编辑窗口可以使用本扩展

### 3.通过顶部菜单栏 高级-PADEN仿真-运行pan分析

### 4.选取需要分析的参数，然后点击开始分析

![提取PCB数据](./images/img-3.png)

![提取PCB数据](./images/img-4.png)


## 快速开始

### 1. 安装前端依赖

```shell
npm install
```

### 2. 编译扩展

```shell
npm run compile
```

打包发布：

```shell
npm run build
```

### 3. 启动 Python 后端

```shell
cd paden-service
start-paden-windows.bat
```

`start-paden-windows.bat` 会自动：
- 从 GitHub 拉取最新的 `solver.py` 和 `problem.py`
- 安装 Python 依赖（numpy, scipy, shapely, fastapi, uvicorn, matplotlib）
- 语法检查
- 启动服务在 `localhost:5000`

### 4. 在 EasyEDA 中安装

1. 打开嘉立创EDA专业版，进入 PCB 编辑器
2. 安装扩展包，第一次运行时会弹出一个后端服务启动提示，需要按步骤启动服务

![启动服务](./images/img-5.png)

3. 在菜单中选择 **PDN 分析 → 运行 PDN 分析...**

## 项目结构

```
├── src/                    # TypeScript 前端
│   ├── index.ts            # 主入口，分析流程编排
│   ├── extract.ts          # PCB 数据提取（走线、过孔、焊盘、铺铜）
│   ├── convert.ts          # 数据转换 + 预网格化 + 序列化
│   ├── mesh.ts             # 客户端三角剖分（earcut 半边数据结构）
│   ├── api.ts              # HTTP 通信（与 Python 后端）
│   ├── display.ts          # 结果展示（IFrame + Storage + MessageBus）
│   └── types.ts            # 类型定义
├── ui/
│   ├── config.html         # 电源轨道配置界面
│   ├── results.html        # WebGL 可视化结果界面
│   └── results.tpl.html    # results.html 构建模板
├── paden-service/          # Python 后端
│   ├── main.py             # FastAPI 服务端（反序列化、求解编排、可视化）
│   ├── solver.py           # FEM 求解器（来自 GitHub）
│   ├── problem.py          # 问题定义（来自 GitHub）
│   ├── mesh_pure.py        # 网格数据结构（半边、微分形式）
│   ├── standby/            # solver.py + problem.py 备份
│   └── start-paden-windows.bat           # 一键构建启动脚本
├── config/                 # 构建配置
│   ├── esbuild.common.ts
│   └── esbuild.prod.ts
└── extension.json          # 扩展配置
```

## 使用流程

1. **提取数据** — 从当前 PCB 提取走线、过孔、焊盘、铺铜区域
2. **配置分析** — 选择电源网络，设置电压源和电流负载
3. **客户端预网格化** — TypeScript 端使用 earcut 算法对铜皮区域做三角剖分
4. **FEM 求解** — Python 后端接收预网格数据，构建拉普拉斯矩阵并求解电压分布
5. **可视化** — WebGL 渲染电压分布热力图，支持层切换、网格边显示、过孔标记

## 技术栈

**前端**：TypeScript, esbuild, WebGL, earcut

**后端**：Python, FastAPI, numpy, scipy, shapely, matplotlib

**依赖**：`@jlceda/pro-api-types`, `earcut`

## 开源许可

本扩展使用 [Apache License 2.0](https://choosealicense.com/licenses/apache-2.0/) 开源许可协议。
