import * as extensionConfig from '../extension.json';
import { PcbExtractor } from './extract';
import { PcbDataConverter } from './convert';
import { PdnApiClient } from './api';
import { ResultDisplay } from './display';
import type { PdnConfig, EasyEDA_Track, EasyEDA_Pad, PcbContextData } from './types';

const CONFIG = {
  host: 'localhost',
  port: 5000,
  analyzeEndpoint: '/analyze',
  testEndpoint: '/test',
};

function getServiceAddress(): string {
  return `${CONFIG.host}:${CONFIG.port}`;
}

// ============================================================
// 导出函数
// ============================================================

export async function runPdnAnalysis(): Promise<void> {
  try {
    const api = new PdnApiClient(CONFIG.host, CONFIG.port, {
      analyzeEndpoint: CONFIG.analyzeEndpoint,
      testEndpoint: CONFIG.testEndpoint,
    });

    eda.sys_LoadingAndProgressBar.showProgressBar(0, 'pdn-extract');
    const extractor = new PcbExtractor();
    const converter = new PcbDataConverter();

    const [, easyedaData] = await Promise.all([
      api.checkService().then(async (isRunning) => {
        if (!isRunning) {
          const started = await showServiceCheckDialog();
          if (!started) throw new Error('__CANCEL__');
        }
      }),
      extractor.extractAll((p) => {
        eda.sys_LoadingAndProgressBar.showProgressBar(p, 'pdn-extract');
      }),
    ]);

    if (!easyedaData || (easyedaData.tracks.length === 0 && easyedaData.vias.length === 0 && easyedaData.pads.length === 0)) {
      eda.sys_Dialog.showInformationMessage('未找到 PCB 数据，请确保打开了 PCB 文件', '警告');
      eda.sys_LoadingAndProgressBar.showProgressBar(100, 'pdn-extract');
      return;
    }

    eda.sys_LoadingAndProgressBar.showProgressBar(100, 'pdn-extract');

    const layerNames = easyedaData.layerNames;

    let lastError = '';

    while (true) {
      const config = await openConfigPanel(easyedaData.pads, layerNames, lastError);
      lastError = '';
      if (!config) return;

      eda.sys_LoadingAndProgressBar.showProgressBar(0, 'pdn-convert');
      converter.diagnostics.length = 0;

      const problem = converter.buildProblem(easyedaData, config);

      eda.sys_LoadingAndProgressBar.showProgressBar(40, 'pdn-convert');

      const serialized = converter.serializeProblem(problem, undefined, { generateImages: false });

      problem.layers.length = 0;
      problem.networks.length = 0;

      eda.sys_LoadingAndProgressBar.showProgressBar(100, 'pdn-convert');

      // 显示分析中提示弹窗
      eda.sys_IFrame.openIFrame('/ui/analyzing.html', 360, 160, 'pdn-analyzing', {
        buttonCallbackFn: () => {},
        grayscaleMask: false,
      }).catch(() => {});

      eda.sys_LoadingAndProgressBar.showProgressBar(0, 'pdn-analyze');
      const solution = await api.analyze(serialized);

      // 关闭分析中弹窗
      try { await eda.sys_IFrame.closeIFrame('pdn-analyzing'); } catch {}

      serialized.layers.length = 0;
      serialized.networks.length = 0;

      if (!solution || !solution.layer_solutions || solution.layer_solutions.length === 0) {
        eda.sys_LoadingAndProgressBar.showProgressBar(100, 'pdn-analyze');
        lastError = '求解失败：未生成有效结果。可能原因：电源网络没有铺铜区域，或电压源/负载焊盘不在铜皮范围内。请检查 PCB 铺铜是否完整。';
        continue;
      }

      const solverInfo = solution.solver_info;
      const gni = solverInfo?.ground_node_current;
      const rn = solverInfo?.residual_norm;
      if (gni == null || rn == null || isNaN(gni) || isNaN(rn)) {
        eda.sys_LoadingAndProgressBar.showProgressBar(100, 'pdn-analyze');
        lastError = '求解失败：矩阵奇异，无法求解。可能原因：电压源或负载的焊盘未落在铺铜区域上，或铺铜区域未覆盖所有连接点。请检查铺铜和电源网络配置。';
        continue;
      }

      eda.sys_LoadingAndProgressBar.showProgressBar(100, 'pdn-analyze');

      const display = new ResultDisplay();
      let solutionData;
      try {
        solutionData = converter.deserializeSolution(solution, Object.values(layerNames));
      } catch (e) {
        lastError = `结果解析失败: ${e}`;
        continue;
      }

      // 将前端诊断日志注入到 diagnostics 中（合并到后端诊断前面）
      const frontendDiag = [...extractor.diagnostics, ...converter.diagnostics];
      if (frontendDiag.length > 0) {
        const backendDiag: string[] = solutionData.diagnostics ?? [];
        solutionData.diagnostics = [...frontendDiag, ...backendDiag];
      }

      const images = (solution as any).images ?? null;
      const connectionPoints = (solution as any).connection_points ?? {};
      const layerBoundaries = (solution as any).layer_boundaries ?? {};
      const warningMessage = solution.success === false && solution.message ? solution.message : undefined;

      solution.layer_solutions.length = 0;

      const action = await display.show(solutionData, layerNames, images, connectionPoints, layerBoundaries, warningMessage, buildPcbContext(easyedaData.tracks, easyedaData.pads, config));

      if (action !== 'reanalyze') return;
    }
  } catch (error) {
    if (error === '__CANCEL__' || (error instanceof Error && error.message === '__CANCEL__')) return;
    eda.sys_Dialog.showInformationMessage(`分析失败: ${error}`, '错误');
    for (const id of ['pdn-extract', 'pdn-convert', 'pdn-analyze']) {
      try { eda.sys_LoadingAndProgressBar.showProgressBar(100, id); } catch {}
    }
  }
}

function showServiceCheckDialog(): Promise<boolean> {
  return new Promise((resolve) => {
    try { eda.sys_IFrame.closeIFrame('pdn-service-check'); } catch {}

    let resolved = false;
    const cleanup = () => {
      if (!resolved) { resolved = true; resolve(false); }
      try { readyTask.cancel(); } catch {}
      try { successTask.cancel(); } catch {}
    };

    const readyTask = eda.sys_MessageBus.subscribe('pdn-service-check-ready', () => {
      readyTask.cancel();
      eda.sys_MessageBus.publish('pdn-service-check-config', {
        host: CONFIG.host,
        port: CONFIG.port,
      });
    });

    const successTask = eda.sys_MessageBus.subscribe('pdn-service-check-success', () => {
      if (resolved) return;
      resolved = true;
      try { eda.sys_IFrame.closeIFrame('pdn-service-check'); } catch {}
      resolve(true);
      try { readyTask.cancel(); } catch {}
    });

    eda.sys_IFrame.openIFrame('/ui/service-check.html', 480, 440, 'pdn-service-check', {
      buttonCallbackFn: (btn) => {
        if (btn === 'close') cleanup();
      },
    }).catch(() => cleanup());
  });
}

function openConfigPanel(pads: EasyEDA_Pad[], layerNames: Record<number, string>, lastError?: string): Promise<PdnConfig | null> {
  return new Promise((resolve) => {
    try { eda.sys_IFrame.closeIFrame('pdn-config'); } catch {}

    let resolved = false;
    const cleanup = () => {
      if (!resolved) { resolved = true; resolve(null); }
      try { configReadyTask.cancel(); } catch {}
      try { configResultTask.cancel(); } catch {}
      try { configCancelTask.cancel(); } catch {}
    };

    const configReadyTask = eda.sys_MessageBus.subscribe('pdn-config-ready', () => {
      configReadyTask.cancel();
      const padsByNet: Record<string, EasyEDA_Pad[]> = {};
      for (const pad of pads) {
        if (!pad.net) continue;
        const list = padsByNet[pad.net] ?? [];
        list.push(pad);
        padsByNet[pad.net] = list;
      }
      eda.sys_MessageBus.publish('pdn-config-data', { padsByNet, layerNames, lastError: lastError || '' });
    });

    const configResultTask = eda.sys_MessageBus.subscribe('pdn-config-result', (msg: any) => {
      if (resolved) return;
      resolved = true;
      try { eda.sys_IFrame.closeIFrame('pdn-config'); } catch {}
      resolve(msg.config as PdnConfig);
      cleanup();
    });

    const configCancelTask = eda.sys_MessageBus.subscribe('pdn-config-cancel', () => {
      cleanup();
      try { eda.sys_IFrame.closeIFrame('pdn-config'); } catch {}
    });

    eda.sys_IFrame.openIFrame('/ui/config.html', 860, 620, 'pdn-config', {
      maximizeButton: true,
      minimizeButton: true,
      minimizeStyle: 'collapsed',
      grayscaleMask: false,
      title: 'PDN 分析配置',
      buttonCallbackFn: (btn) => {
        if (btn === 'close') cleanup();
      },
    }).catch(() => cleanup());
  });
}

const MIL_TO_MM = 0.0254;

function buildPcbContext(
  allTracks: EasyEDA_Track[],
  allPads: EasyEDA_Pad[],
  config: PdnConfig,
): PcbContextData {
  const analyzedNets = new Set(config.rails.map(r => r.net));
  return {
    contextTracks: allTracks
      .filter(t => !analyzedNets.has(t.net))
      .map(t => ({
        x1: t.x1 * MIL_TO_MM, y1: t.y1 * MIL_TO_MM,
        x2: t.x2 * MIL_TO_MM, y2: t.y2 * MIL_TO_MM,
        width: t.width * MIL_TO_MM,
        layer: t.layer,
        net: t.net,
      })),
    contextPads: allPads.filter(p => analyzedNets.has(p.net)).map(p => ({
      x: p.x * MIL_TO_MM,
      y: p.y * MIL_TO_MM,
      width: p.width * MIL_TO_MM,
      height: p.height * MIL_TO_MM,
      hole_diameter: p.hole_diameter * MIL_TO_MM,
      layer: p.layer,
      net: p.net,
      ref_des: p.ref_des,
      pad_number: p.pad_number,
    })),
  };
}

export async function showResults(): Promise<void> {
  try {
    // Try showing existing hidden iframe first
    const ok = await eda.sys_IFrame.showIFrame('pdne-results');
    if (ok) return;
  } catch {}

  // No existing iframe — check for cached results and reopen
  try {
    const raw = eda.sys_Storage.getExtensionUserConfig('pdn-results');
    if (!raw || typeof raw !== 'string') {
      eda.sys_Dialog.showInformationMessage('没有可显示的分析结果，请先运行 PDN 分析', '提示');
      return;
    }
    const data = JSON.parse(raw);
    if (!data.result || !data.result.layerSolutions) {
      eda.sys_Dialog.showInformationMessage('没有可显示的分析结果，请先运行 PDN 分析', '提示');
      return;
    }

    // Reopen results iframe (it will load data from Storage)
    eda.sys_IFrame.openIFrame('/ui/results.html', 960, 700, 'pdne-results', {
      maximizeButton: true,
      minimizeButton: false,
      grayscaleMask: false,
      title: 'PDN 分析结果',
      buttonCallbackFn: (btn) => {
        if (btn === 'close') {
          try { eda.sys_IFrame.closeIFrame('pdne-results'); } catch {}
        }
      },
    }).catch(() => {});
  } catch {
    eda.sys_Dialog.showInformationMessage('没有可显示的分析结果，请先运行 PDN 分析', '提示');
  }
}

export function about(): void {
  const content = `PDN 分析插件 v${extensionConfig.version}

用于从 EasyEDA 提取 PCB 数据并进行 PDN 电源分配网络分析

功能：
• 从 EasyEDA 提取 PCB 走线、过孔、焊盘、铺铜数据
• 转换为 padne 分析格式
• 调用本地 Python 后端进行 FEM 求解
• 展示电压分布和功率密度结果`;
  eda.sys_Dialog.showInformationMessage(content, '关于');
}

export function activate(status?: 'onStartupFinished', arg?: string): void {}
