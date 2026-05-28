[简体中文](./README.md) | [English](./README.en.md) | [繁體中文](./README.zh-Hant.md) | [日本語](#) | [Русский](./README.ru.md)

# PADEN シミュレーション

JLCEDA & EasyEDA Pro 拡張機能 — PCB データを抽出し、PDN 電源配電ネットワーク FEM 分析を実行

## 機能

- EasyEDA から PCB トレース、ビア、パッド、銅箔 pour データを抽出
- ユーザー設定可能な電源レール（電圧源、電流負荷）
- クライアント側プレメッシュ化（TypeScript earcut 三角分割）
- ローカル Python バックエンドによる FEM 解析
- WebGL 電圧分布・電力密度ヒートマップ可視化

## アーキテクチャ

```
EasyEDA PCB
    │
    ▼
┌─────────────┐     ┌──────────────┐     ┌───────────────┐
│  extract.ts │────▶│  convert.ts  │────▶│   mesh.ts     │  クライアントプレメッシュ化
│  データ抽出   │     │  データ変換    │     │  三角分割      │
└─────────────┘     └──────────────┘     └───────┬───────┘
                                                   │
                                           format_version=2
                                                   │
                                                   ▼
                                         ┌─────────────────┐
                                         │  Python バックエンド │
                                         │  main.py         │
                                         │  ├ solver.py     │  FEM ソルバー
                                         │  ├ problem.py    │  問題定義
                                         │  └ mesh_pure.py  │  メッシュデータ構造
                                         └────────┬────────┘
                                                  │
                                                  ▼
                                         ┌─────────────────┐
                                         │  results.html   │  WebGL 可視化
                                         └─────────────────┘
```

## 使用手順

### 1. JLCEDA Pro（3.0+）に本拡張機能をインストール
インストール後、設定を行います

![「設定」をクリック](./images/img-1.png)

![「外部との連携を許可」にチェック](./images/img-2.png)

### 2. エンジニアリングプロジェクトの PCB エディタで本拡張機能が使用可能

### 3. 上部メニューバーから 高度 → PADENシミュレーション → PDN分析を実行

### 4. 分析パラメータを選択し、「分析開始」をクリック

![PCB データ抽出](./images/img-3.png)

![PCB データ抽出](./images/img-4.png)


## クイックスタート

### 1. フロントエンド依存関係のインストール

```shell
npm install
```

### 2. 拡張機能のコンパイル

```shell
npm run compile
```

リリース用ビルド：

```shell
npm run build
```

### 3. Python バックエンドの起動

```shell
cd paden-service
start-paden-windows.bat
```

`start-paden-windows.bat` は自動的に以下を実行します：
- GitHub から最新の `solver.py` と `problem.py` をプル
- Python 依存関係のインストール（numpy, scipy, shapely, fastapi, uvicorn, matplotlib）
- 構文チェック
- `localhost:5000` でサーバー起動

### 4. EasyEDA へのインストール

1. JLCEDA Pro を開き、PCB エディタに入る
2. 拡張パッケージをインストール。初回実行時にバックエンドサービス起動のプロンプトが表示されるので、手順に従ってサービスを起動

![サービス起動](./images/img-5.png)

3. メニューから **PDN 分析 → PDN 分析を実行...** を選択

## プロジェクト構成

```
├── src/                    # TypeScript フロントエンド
│   ├── index.ts            # メインエントリ、分析フロー統合
│   ├── extract.ts          # PCB データ抽出（トレース、ビア、パッド、銅箔）
│   ├── convert.ts          # データ変換 + プレメッシュ化 + シリアライズ
│   ├── mesh.ts             # クライアント側三角分割（earcut ハーフエッジ）
│   ├── api.ts              # HTTP 通信（Python バックエンドとの通信）
│   ├── display.ts          # 結果表示（IFrame + Storage + MessageBus）
│   └── types.ts            # 型定義
├── ui/
│   ├── config.html         # 電源レール設定 UI
│   ├── results.html        # WebGL 可視化結果
│   └── results.tpl.html    # results.html ビルドテンプレート
├── paden-service/          # Python バックエンド
│   ├── main.py             # FastAPI サーバー（デシリアライズ、求解、可視化）
│   ├── solver.py           # FEM ソルバー（GitHub から）
│   ├── problem.py          # 問題定義（GitHub から）
│   ├── mesh_pure.py        # メッシュデータ構造（ハーフエッジ、微分形式）
│   ├── standby/            # solver.py + problem.py バックアップ
│   └── start-paden-windows.bat           # ワンクリックビルド＆起動スクリプト
├── config/                 # ビルド設定
│   ├── esbuild.common.ts
│   └── esbuild.prod.ts
└── extension.json          # 拡張機能マニフェスト
```

## 使用フロー

1. **データ抽出** — 現在の PCB からトレース、ビア、パッド、銅箔エリアを抽出
2. **分析設定** — 電源ネットを選択し、電圧源と電流負荷を設定
3. **クライアントプレメッシュ化** — TypeScript earcut アルゴリズムで銅箔領域を三角分割
4. **FEM 解析** — Python バックエンドがプレメッシュデータを受信し、ラプラシアン行列を構築して電圧分布を求解
5. **可視化** — WebGL 電圧ヒートマップ。レイヤー切替、メッシュエッジ表示、ビアマーカー対応

## 技術スタック

**フロントエンド**：TypeScript, esbuild, WebGL, earcut

**バックエンド**：Python, FastAPI, numpy, scipy, shapely, matplotlib

**依存関係**：`@jlceda/pro-api-types`, `earcut`

## ライセンス

本拡張機能は [Apache License 2.0](https://choosealicense.com/licenses/apache-2.0/) オープンソースライセンスを使用しています。
