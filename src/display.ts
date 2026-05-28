import type { SolutionData, AnalysisImages, PcbContextData } from './types';

/**
 * display.ts - 结果展示模块
 * 负责将后端求解结果可视化展示给用户
 */
export class ResultDisplay {

  /** 展示求解结果，返回用户操作：'close' 或 'reanalyze' */
  show(
    result: SolutionData,
    layerNames?: Record<number, string>,
    images?: AnalysisImages,
    connectionPoints?: Record<string, Array<{ x: number; y: number; is_source: boolean }>>,
    layerBoundaries?: Record<string, Array<{ exterior: number[][]; holes: number[][][] }>>,
    warningMessage?: string,
    pcbContext?: PcbContextData,
  ): Promise<'close' | 'reanalyze'> {
    return new Promise((resolve) => {
      // 先关闭已有面板
      try { eda.sys_IFrame.closeIFrame('pdne-results'); } catch {}

      let resolved = false;
      const done = (action: 'close' | 'reanalyze') => {
        if (resolved) return;
        resolved = true;
        try { reanalyzeTask.cancel(); } catch {}
        try { closeTask.cancel(); } catch {}
        try { eda.sys_IFrame.closeIFrame('pdne-results'); } catch {}
        resolve(action);
      };

      // Storage 传递数据（图片单独存储避免大小限制）
      eda.sys_Storage.setExtensionUserConfig('pdn-results', JSON.stringify({
        result,
        layerNames: layerNames || {},
        connectionPoints: connectionPoints || {},
        layerBoundaries: layerBoundaries || {},
        warningMessage: warningMessage || null,
        pcbContext: pcbContext || null,
      }));
      if (images) {
        eda.sys_Storage.setExtensionUserConfig('pdn-results-images', JSON.stringify(images));
      }

      // MessageBus 双保险
      const task = eda.sys_MessageBus.subscribe('padne-results-ready', () => {
        task.cancel();
        eda.sys_MessageBus.publish('pdn-results-data', {
          result,
          layerNames: layerNames || {},
          images: images || null,
          connectionPoints: connectionPoints || {},
          layerBoundaries: layerBoundaries || {},
          warningMessage: warningMessage || null,
          pcbContext: pcbContext || null,
        });
      });

      // 监听重新分析
      const reanalyzeTask = eda.sys_MessageBus.subscribe('pdn-reanalyze', () => {
        done('reanalyze');
      });

      // 监听关闭（results.html 内部关闭按钮通过 MessageBus 通知）
      const closeTask = eda.sys_MessageBus.subscribe('pdn-results-close', () => {
        done('close');
      });

      eda.sys_IFrame.openIFrame('/ui/results.html', 960, 700, 'pdne-results', {
        maximizeButton: true,
        minimizeButton: true,
        minimizeStyle: 'collapsed',
        grayscaleMask: false,
        title: 'PDN 分析结果',
        buttonCallbackFn: (btn) => {
          if (btn === 'close') {
            task.cancel();
            done('close');
          }
        },
      }).catch(() => {
        task.cancel();
        done('close');
      });
    });
  }
}
