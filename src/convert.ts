import {
  EasyEDA_PcbData,
  EasyEDA_Track,
  EasyEDA_Via,
  EasyEDA_Pad,
  Point,
  Polygon,
  MultiPolygon,
  Layer,
  NodeID,
  Connection,
  LumpedElement,
  Network,
  Problem,
  Stackup,
  StackupItem,
  StackupItemType,
  ViaSpec,
  Endpoint,
  LayerPoint,
  Directive,
  CopperSpec,
  SerializedPoint,
  SerializedPolygon,
  SerializedMultiPolygon,
  SerializedLayer,
  SerializedConnection,
  SerializedLumpedElement,
  SerializedNetwork,
  SerializedProblem,
  SerializedSolution,
  SerializedPreMeshedPolygon,
  MeshData,
  LayerSolutionData,
  SolverInfoData,
  SolutionData,
  ProblemSummary,
  PdnConfig,
} from './types';

/**
 * convert.ts - 数据格式转换模块
 * 负责将 EasyEDA 原始数据转换为 padne 分析格式，
 * 以及序列化/反序列化。
 */
export class PcbDataConverter {

  /** 前端诊断日志 */
  readonly diagnostics: string[] = [];

  private diag(line: string) {
    this.diagnostics.push(line);
  }

  /** 铜电导率 (S/mm) */
  private readonly COPPER_CONDUCTIVITY = 5.95e4;
  /** 默认铜厚 1oz = 0.035mm */
  private readonly DEFAULT_COPPER_THICKNESS = 0.035;
  /** 默认 FR4 介电层厚度 */
  private readonly DEFAULT_DIELECTRIC_THICKNESS = 1.6;
  /** 1 mil = 0.0254 mm */
  private readonly MIL_TO_MM = 0.0254;
  /** 默认过孔电阻 (Ω) — 0.3mm 孔径、1.6mm 板厚的铜通孔 */
  private readonly DEFAULT_VIA_RESISTANCE = 0.001;

  private nodeIdCounter = 0;

  // ============================================================
  // 核心方法：EasyEDA 数据 → Problem
  // ============================================================

  /**
   * 将 EasyEDA 原始 PCB 数据转换为 PDN 分析问题
   * 坐标从 mil ���换为 mm
   * @param config 用户配置的电压源/负载信息
   */
  buildProblem(easyedaData: EasyEDA_PcbData, config?: PdnConfig): Problem {
    // 构建层几何
    const layers = this.buildLayers(easyedaData, config);

    // 构建网络
    const networks = config
      ? this.buildNetworksWithConfig(easyedaData, layers, config)
      : this.buildNetworks(easyedaData, layers);

    return { layers, networks };
  }

  /** 构建层：按 layer 分组铜箔和走线，形成每层的 MultiPolygon */
  private buildLayers(data: EasyEDA_PcbData, config?: PdnConfig): Layer[] {
    const polygonsByLayer = new Map<number, Polygon[]>();

    // 只包含分析网络的铜箔（避免 GND 等其他网络铜箔与 VCC 合并导致短路）
    const analysisNets = new Set((config?.rails ?? []).map(r => r.net));
    this.diag('\n' + '='.repeat(20) + ' 层几何构建诊断 (buildLayers) ' + '='.repeat(20));
    this.diag(`analysisNets: [${[...analysisNets].map(n => `"${n}"`).join(', ')}]`);
    this.diag(`提取到的 copperPours 总数: ${data.copperPours.length}`);
    if (data.copperPours.length > 0) {
      const pourNets = [...new Set(data.copperPours.map(p => p.net))];
      this.diag(`copperPours 网络: [${pourNets.map(n => `"${n}"`).join(', ')}]`);
    }

    // 铜箔区域直接作为多边形（按 net+layer 排序确保确定性）
    const sortedPours = [...data.copperPours].sort((a, b) => {
      if (a.layer !== b.layer) return a.layer - b.layer;
      return a.net.localeCompare(b.net);
    });
    const pourCountByLayer: Record<number, number> = {};
    let pourFilteredByNet = 0;
    for (const pour of sortedPours) {
      if (analysisNets.size > 0 && !analysisNets.has(pour.net)) {
        pourFilteredByNet++;
        continue;
      }
      if (!pour.vertices || pour.vertices.length < 3) continue;
      pourCountByLayer[pour.layer] = (pourCountByLayer[pour.layer] ?? 0) + 1;
      const exterior = pour.vertices.map(v => ({
        x: v.x * this.MIL_TO_MM,
        y: v.y * this.MIL_TO_MM,
      }));
      const holes = (pour.holes ?? []).map(h => h.map(v => ({
        x: v.x * this.MIL_TO_MM,
        y: v.y * this.MIL_TO_MM,
      })));
      const polys = polygonsByLayer.get(pour.layer) ?? [];
      polys.push({ exterior, holes });
      polygonsByLayer.set(pour.layer, polys);
    }
    this.diag(`铜皮铺铜: ${JSON.stringify(pourCountByLayer)} (被网络过滤掉: ${pourFilteredByNet})`);

    // 只合并属于当前分析网络的走线（避免 16851 条无关走线撑爆几何）
    let trackCount = 0;
    const trackCountByLayer: Record<number, number> = {};
    for (const track of data.tracks) {
      if (analysisNets.size > 0 && !analysisNets.has(track.net)) continue;
      const poly = this.expandTrackToPolygon(track);
      if (!poly) continue;
      trackCount++;
      trackCountByLayer[track.layer] = (trackCountByLayer[track.layer] ?? 0) + 1;
      const polys = polygonsByLayer.get(track.layer) ?? [];
      polys.push(poly);
      polygonsByLayer.set(track.layer, polys);
    }
    // 转角补齐：在走线拐点处添加圆形填充，消除矩形扩展留下的缺角
    const junctionFills = this.createTrackJunctionFills(data.tracks, analysisNets);
    let junctionFillCount = 0;
    const junctionFillByLayer: Record<number, number> = {};
    for (const fill of junctionFills) {
      junctionFillCount++;
      junctionFillByLayer[fill.layer] = (junctionFillByLayer[fill.layer] ?? 0) + 1;
      const polys = polygonsByLayer.get(fill.layer) ?? [];
      polys.push(fill.polygon);
      polygonsByLayer.set(fill.layer, polys);
    }
    this.diag(`走线: total=${trackCount}, byLayer=${JSON.stringify(trackCountByLayer)}`);
    this.diag(`转角补齐: total=${junctionFillCount}, byLayer=${JSON.stringify(junctionFillByLayer)}`);
    this.diag(`每层多边形总数: ${JSON.stringify(
      Object.fromEntries([...polygonsByLayer.entries()].map(([k, v]) => [k, v.length]))
    )}`);

    // 坐标对比诊断：走线 vs 铜皮的 mm 坐标范围
    const analysisTracks = data.tracks.filter(t => analysisNets.size === 0 || analysisNets.has(t.net));
    if (analysisTracks.length > 0 && data.copperPours.length > 0) {
      const analysisPours = data.copperPours.filter(p => analysisNets.size === 0 || analysisNets.has(p.net));
      const tMinX = Math.min(...analysisTracks.map(t => t.x1 * this.MIL_TO_MM));
      const tMaxX = Math.max(...analysisTracks.map(t => t.x2 * this.MIL_TO_MM));
      const tMinY = Math.min(...analysisTracks.map(t => Math.min(t.y1, t.y2) * this.MIL_TO_MM));
      const tMaxY = Math.max(...analysisTracks.map(t => Math.max(t.y1, t.y2) * this.MIL_TO_MM));
      const pMinX = Math.min(...analysisPours.map(p => Math.min(...p.vertices.map(v => v.x * this.MIL_TO_MM))));
      const pMaxX = Math.max(...analysisPours.map(p => Math.max(...p.vertices.map(v => v.x * this.MIL_TO_MM))));
      const pMinY = Math.min(...analysisPours.map(p => Math.min(...p.vertices.map(v => v.y * this.MIL_TO_MM))));
      const pMaxY = Math.max(...analysisPours.map(p => Math.max(...p.vertices.map(v => v.y * this.MIL_TO_MM))));
      this.diag(`坐标范围对比 (mm): 走线 X=[${tMinX.toFixed(2)},${tMaxX.toFixed(2)}] Y=[${tMinY.toFixed(2)},${tMaxY.toFixed(2)}]`);
      this.diag(`坐标范围对比 (mm): 铜皮 X=[${pMinX.toFixed(2)},${pMaxX.toFixed(2)}] Y=[${pMinY.toFixed(2)},${pMaxY.toFixed(2)}]`);
      const overlap = tMinX <= pMaxX && pMinX <= tMaxX && tMinY <= pMaxY && pMinY <= tMaxY;
      this.diag(`坐标重叠: ${overlap ? 'YES' : 'NO !! 坐标系不一致'}`);
    }

    // 构建层列表（按 layer ID 排序）
    const sortedLayerIds = [...polygonsByLayer.keys()].sort((a, b) => a - b);
    const layers = sortedLayerIds.map(layerId => {
      const name = data.layerNames[layerId] ?? `Layer_${layerId}`;
      const thickness = config?.layerCuThickness?.[layerId] ?? this.DEFAULT_COPPER_THICKNESS;
      const polys = polygonsByLayer.get(layerId)!;
      return {
        name,
        conductance: this.COPPER_CONDUCTIVITY * thickness,
        shape: { polygons: polys },
      };
    });
    return layers;
  }

  /** 在走线拐点处创建圆形填充多边形，消除矩形扩展的缺角 */
  private createTrackJunctionFills(
    tracks: EasyEDA_Track[],
    analysisNets: Set<string>,
  ): Array<{ layer: number; polygon: Polygon }> {
    // 用 mil 原始坐标作为 key，避免 mm 浮点误差导致同一拐点无法匹配
    const endpointMap = new Map<string, Array<{ x: number; y: number; halfWmm: number; layer: number }>>();

    for (const track of tracks) {
      if (analysisNets.size > 0 && !analysisNets.has(track.net)) continue;
      const halfWmm = (track.width / 2) * this.MIL_TO_MM;
      const k1 = `${track.net}|${track.layer}|${track.x1.toFixed(2)}|${track.y1.toFixed(2)}`;
      const k2 = `${track.net}|${track.layer}|${track.x2.toFixed(2)}|${track.y2.toFixed(2)}`;
      const a1 = endpointMap.get(k1) ?? []; a1.push({ x: track.x1, y: track.y1, halfWmm, layer: track.layer }); endpointMap.set(k1, a1);
      const a2 = endpointMap.get(k2) ?? []; a2.push({ x: track.x2, y: track.y2, halfWmm, layer: track.layer }); endpointMap.set(k2, a2);
    }

    const fills: Array<{ layer: number; polygon: Polygon }> = [];
    for (const [, endpoints] of endpointMap.entries()) {
      if (endpoints.length < 2) continue;
      const jx = endpoints[0].x * this.MIL_TO_MM;
      const jy = endpoints[0].y * this.MIL_TO_MM;
      const layer = endpoints[0].layer;
      const maxHalfW = Math.max(...endpoints.map(p => p.halfWmm));
      const nSeg = 12;
      const exterior: Array<{ x: number; y: number }> = [];
      for (let k = 0; k < nSeg; k++) {
        const angle = (k / nSeg) * 2 * Math.PI;
        exterior.push({ x: jx + maxHalfW * Math.cos(angle), y: jy + maxHalfW * Math.sin(angle) });
      }
      fills.push({ layer, polygon: { exterior, holes: [] } });
    }
    return fills;
  }

  /** 将走线扩展为矩形多边形（mil → mm） */
  private expandTrackToPolygon(track: EasyEDA_Track): Polygon | null {
    const dx = track.x2 - track.x1;
    const dy = track.y2 - track.y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-6) return null;

    // 法线方向（垂直于走线）
    const nx = -dy / len;
    const ny = dx / len;
    const halfW = (track.width / 2) * this.MIL_TO_MM;

    // 四个角点
    const x1 = track.x1 * this.MIL_TO_MM;
    const y1 = track.y1 * this.MIL_TO_MM;
    const x2 = track.x2 * this.MIL_TO_MM;
    const y2 = track.y2 * this.MIL_TO_MM;

    return {
      exterior: [
        { x: x1 + nx * halfW, y: y1 + ny * halfW },
        { x: x2 + nx * halfW, y: y2 + ny * halfW },
        { x: x2 - nx * halfW, y: y2 - ny * halfW },
        { x: x1 - nx * halfW, y: y1 - ny * halfW },
      ],
      holes: [],
    };
  }

  /** 构建网络：过孔 -> Resistor + Connection（焊盘需关联电压源/电流源才能参与） */
  private buildNetworks(data: EasyEDA_PcbData, layers: Layer[]): Network[] {
    const layerByName = new Map<string, Layer>();
    for (const layer of layers) {
      layerByName.set(layer.name, layer);
    }

    // 按网络名称分组过孔（排序确保确定性）
    const viasByNet = new Map<string, EasyEDA_Via[]>();
    for (const via of data.vias) {
      const list = viasByNet.get(via.net) ?? [];
      list.push(via);
      viasByNet.set(via.net, list);
    }

    // 只有含过孔的网络才产生元件（排序确保确定性）
    const allNets = [...viasByNet.keys()].sort();
    const networks: Network[] = [];

    for (const netName of allNets) {
      const sortedVias = (viasByNet.get(netName) ?? []).sort((a, b) => a.x - b.x || a.y - b.y);
      const connections: Connection[] = [];
      const elements: LumpedElement[] = [];
      const nodeMap = new Map<string, NodeID>();

      const getNodeId = (key: string): NodeID => {
        if (!nodeMap.has(key)) nodeMap.set(key, { id: key });
        return nodeMap.get(key)!;
      };

      // 过孔 -> Resistor（通孔连接所有铜层）
      for (const via of sortedVias) {
        const vx = via.x * this.MIL_TO_MM;
        const vy = via.y * this.MIL_TO_MM;
        const totalResistance = this.estimateViaResistance(via);
        const segmentCount = Math.max(layers.length - 1, 1);
        const segResistance = totalResistance / segmentCount;

        for (const layer of layers) {
          const layerKey = `${netName}_via_${vx.toFixed(3)}_${vy.toFixed(3)}_${layer.name}`;
          connections.push({
            layerName: layer.name,
            point: { x: vx, y: vy },
            nodeId: getNodeId(layerKey),
          });
        }

        for (let i = 0; i < layers.length - 1; i++) {
          const key1 = `${netName}_via_${vx.toFixed(3)}_${vy.toFixed(3)}_${layers[i].name}`;
          const key2 = `${netName}_via_${vx.toFixed(3)}_${vy.toFixed(3)}_${layers[i + 1].name}`;
          elements.push({
            type: 'resistor',
            a: getNodeId(key1),
            b: getNodeId(key2),
            resistance: segResistance,
          });
        }
      }

      if (connections.length > 0 || elements.length > 0) {
        networks.push({ connections, elements });
      }
    }

    return networks;
  }

  /** 根据用户配置构建网络（电压源 + 负载 + 过孔电阻） */
  private buildNetworksWithConfig(data: EasyEDA_PcbData, layers: Layer[], config: PdnConfig): Network[] {
    const layerByName = new Map<string, Layer>();
    for (const layer of layers) layerByName.set(layer.name, layer);

    // 按网络名称分组过孔
    const viasByNet = new Map<string, EasyEDA_Via[]>();
    for (const via of data.vias) {
      const list = viasByNet.get(via.net) ?? [];
      list.push(via);
      viasByNet.set(via.net, list);
    }

    const networks: Network[] = [];

    for (const rail of [...config.rails].sort((a, b) => a.net.localeCompare(b.net))) {
      const connections: Connection[] = [];
      const elements: LumpedElement[] = [];
      const nodeMap = new Map<string, NodeID>();

      const getNodeId = (key: string): NodeID => {
        if (!nodeMap.has(key)) nodeMap.set(key, { id: key });
        return nodeMap.get(key)!;
      };

      // 电压源焊盘 → Connection + VoltageSource
      // 每个 source 创建一个 VoltageSource，正极为该 source 的 pads，负极为 GND 节点
      const gndKey = `${rail.net}_GND`;
      for (const src of rail.sources) {
        for (let pi = 0; pi < src.pads.length; pi++) {
          const pad = src.pads[pi];
          const padKey = `${rail.net}_src_${src.ref_des}_${pi}`;
          const padX = pad.x * this.MIL_TO_MM;
          const padY = pad.y * this.MIL_TO_MM;

          if (pad.layer) {
            // SMD 焊盘：只在指定层创建连接
            connections.push({
              layerName: pad.layer,
              point: { x: padX, y: padY },
              nodeId: getNodeId(padKey),
            });
            elements.push({
              type: 'voltage_source',
              p: getNodeId(padKey),
              n: getNodeId(gndKey),
              voltage: rail.voltage,
            });
          } else {
            // 通孔焊盘：在所有层创建连接 + 层间低电阻（类似过孔）
            const padR = 0.0001; // 通孔镀层电阻极低
            for (const layer of layers) {
              const layerKey = `${padKey}_${layer.name}`;
              connections.push({
                layerName: layer.name,
                point: { x: padX, y: padY },
                nodeId: getNodeId(layerKey),
              });
            }
            for (let i = 0; i < layers.length - 1; i++) {
              elements.push({
                type: 'resistor',
                a: getNodeId(`${padKey}_${layers[i].name}`),
                b: getNodeId(`${padKey}_${layers[i + 1].name}`),
                resistance: padR,
              });
            }
            elements.push({
              type: 'voltage_source',
              p: getNodeId(`${padKey}_${layers[0].name}`),
              n: getNodeId(gndKey),
              voltage: rail.voltage,
            });
          }
        }
      }

      // 负载焊盘 → Connection + CurrentSource
      for (const load of rail.loads) {
        const currentPerPad = load.current / Math.max(load.pads.length, 1);
        for (let pi = 0; pi < load.pads.length; pi++) {
          const pad = load.pads[pi];
          const padKey = `${rail.net}_load_${load.ref_des}_${pi}`;
          const padX = pad.x * this.MIL_TO_MM;
          const padY = pad.y * this.MIL_TO_MM;

          if (pad.layer) {
            // SMD 焊盘
            connections.push({
              layerName: pad.layer,
              point: { x: padX, y: padY },
              nodeId: getNodeId(padKey),
            });
            elements.push({
              type: 'current_source',
              f: getNodeId(gndKey),
              t: getNodeId(padKey),
              current: currentPerPad,
            });
          } else {
            // 通孔焊盘：在所有层创建连接 + 层间低电阻
            const padR = 0.0001;
            for (const layer of layers) {
              const layerKey = `${padKey}_${layer.name}`;
              connections.push({
                layerName: layer.name,
                point: { x: padX, y: padY },
                nodeId: getNodeId(layerKey),
              });
            }
            for (let i = 0; i < layers.length - 1; i++) {
              elements.push({
                type: 'resistor',
                a: getNodeId(`${padKey}_${layers[i].name}`),
                b: getNodeId(`${padKey}_${layers[i + 1].name}`),
                resistance: padR,
              });
            }
            elements.push({
              type: 'current_source',
              f: getNodeId(gndKey),
              t: getNodeId(`${padKey}_${layers[0].name}`),
              current: currentPerPad,
            });
          }
        }
      }

      // 过孔 → Resistor（通孔连接所有铜层，按坐标排序确保确定性）
      const vias = (viasByNet.get(rail.net) ?? []).sort((a, b) => a.x - b.x || a.y - b.y);
      for (const via of vias) {
        const vx = via.x * this.MIL_TO_MM;
        const vy = via.y * this.MIL_TO_MM;
        const totalResistance = this.estimateViaResistance(via);
        const segmentCount = Math.max(layers.length - 1, 1);
        const segResistance = totalResistance / segmentCount;

        for (const layer of layers) {
          const layerKey = `${rail.net}_via_${vx.toFixed(3)}_${vy.toFixed(3)}_${layer.name}`;
          connections.push({
            layerName: layer.name,
            point: { x: vx, y: vy },
            nodeId: getNodeId(layerKey),
          });
        }

        for (let i = 0; i < layers.length - 1; i++) {
          const key1 = `${rail.net}_via_${vx.toFixed(3)}_${vy.toFixed(3)}_${layers[i].name}`;
          const key2 = `${rail.net}_via_${vx.toFixed(3)}_${vy.toFixed(3)}_${layers[i + 1].name}`;
          elements.push({
            type: 'resistor',
            a: getNodeId(key1),
            b: getNodeId(key2),
            resistance: segResistance,
          });
        }
      }

      if (connections.length > 0 || elements.length > 0) {
        networks.push({ connections, elements });
      }
    }

    return networks;
  }

  /** 估算过孔电阻 (Ω) */
  private estimateViaResistance(via: EasyEDA_Via): number {
    // R = ρ × L / A
    // ρ = 1/σ = 1/(5.95e4) S/mm ≈ 1.68e-5 Ω·mm
    // L = 板厚 (1.6mm)
    // A = 镀铜筒截面积 = π × ((r_hole + t_plating)² - r_hole²)
    const rho = 1 / this.COPPER_CONDUCTIVITY;
    const holeD = via.hole_diameter * this.MIL_TO_MM;
    const platingThickness = 0.025; // mm，镀铜厚度
    const innerR = holeD / 2;
    const outerR = innerR + platingThickness;
    const area = Math.PI * (outerR * outerR - innerR * innerR);
    if (area < 1e-10) return this.DEFAULT_VIA_RESISTANCE;
    const resistance = rho * this.DEFAULT_DIELECTRIC_THICKNESS / area;
    // 调试：验证过孔尺寸单位是否正确
    // 正常过孔: hole_diameter ~12mil → ~0.3mm, R ~1mΩ
    // 如果 holeD < 0.05mm, 说明 API 返回的可能是 mm 而非 mil
    if (holeD < 0.05) {
      console.warn(
        `[PDN] 过孔孔径异常小 (${holeD.toFixed(4)}mm, 原始值=${via.hole_diameter}), ` +
        `可能 API 返回的是 mm 而非 mil, 请检查单位转换`
      );
    }
    return resistance;
  }

  // ============================================================
  // 调试信息
  // ============================================================

  /** 生成调试信息字��串，用于弹窗展示关键参数 */
  getDebugInfo(easyedaData: EasyEDA_PcbData, config?: PdnConfig): string {
    const lines: string[] = [];
    lines.push('=== 单位转换 ===');
    lines.push(`MIL_TO_MM = ${this.MIL_TO_MM}`);
    lines.push(`COPPER_CONDUCTIVITY = ${this.COPPER_CONDUCTIVITY} S/mm`);
    lines.push(`DEFAULT_COPPER_THICKNESS = ${this.DEFAULT_COPPER_THICKNESS} mm`);
    lines.push('');

    // 层信息
    lines.push('=== 层信息 ===');
    for (const [id, name] of Object.entries(easyedaData.layerNames)) {
      const cuThick = config?.layerCuThickness?.[Number(id)] ?? this.DEFAULT_COPPER_THICKNESS;
      const cond = this.COPPER_CONDUCTIVITY * cuThick;
      lines.push(`Layer ${id} "${name}": 铜厚=${cuThick}mm, conductance=${cond.toFixed(1)} S`);
    }
    lines.push('');

    // 过孔参数
    const vias = easyedaData.vias;
    lines.push(`=== 过孔 (${vias.length} 个) ===`);
    if (vias.length > 0) {
      const sample = vias.slice(0, Math.min(3, vias.length));
      for (const v of sample) {
        const rawX = v.x, rawY = v.y;
        const mmX = rawX * this.MIL_TO_MM;
        const mmY = rawY * this.MIL_TO_MM;
        const rawD = v.diameter;
        const rawH = v.hole_diameter;
        const mmD = rawD * this.MIL_TO_MM;
        const mmH = rawH * this.MIL_TO_MM;
        lines.push(`  Via @ (${rawX}, ${rawY}) raw`);
        lines.push(`    -> (${mmX.toFixed(4)}, ${mmY.toFixed(4)}) mm`);
        lines.push(`    直径: raw=${rawD}, 转换后=${mmD.toFixed(4)}mm`);
        lines.push(`    孔径: raw=${rawH}, 转换后=${mmH.toFixed(4)}mm`);
        // 计算电阻
        const rho = 1 / this.COPPER_CONDUCTIVITY;
        const plating = 0.025;
        const innerR = mmH / 2;
        const outerR = innerR + plating;
        const area = Math.PI * (outerR * outerR - innerR * innerR);
        const R = area > 1e-10 ? rho * this.DEFAULT_DIELECTRIC_THICKNESS / area : this.DEFAULT_VIA_RESISTANCE;
        lines.push(`    镀铜厚=${plating}mm, 截面积=${area.toFixed(6)}mm²`);
        lines.push(`    电阻 R=${(R * 1000).toFixed(3)} mΩ (板厚${this.DEFAULT_DIELECTRIC_THICKNESS}mm)`);
        // 诊断
        if (mmH < 0.05) lines.push(`    ⚠ 孔径异常小! API可能返回mm而非mil`);
        if (mmH > 5) lines.push(`    ⚠ 孔径异常大! 可能单位不对`);
        if (mmD > 5) lines.push(`    ⚠ 直径异常大! 可能单位不对`);
      }
      if (vias.length > 3) lines.push(`  ... 还有 ${vias.length - 3} 个过孔`);
    } else {
      lines.push('  (无过孔)');
    }
    lines.push('');

    // 走线参数
    const tracks = easyedaData.tracks;
    lines.push(`=== 走线 (${tracks.length} 条) ===`);
    if (tracks.length > 0) {
      const sample = tracks.slice(0, Math.min(3, tracks.length));
      for (const t of sample) {
        const rawW = t.width;
        const mmW = rawW * this.MIL_TO_MM;
        lines.push(`  Track [${t.net}] raw width=${rawW}, 转换后=${mmW.toFixed(4)}mm`);
        if (mmW < 0.01) lines.push(`    ⚠ 线宽异常细! API可能返回mm而非mil`);
        if (mmW > 10) lines.push(`    ⚠ 线宽异常宽! 可能单位不对`);
      }
      if (tracks.length > 3) lines.push(`  ... 还有 ${tracks.length - 3} 条走线`);
    }
    lines.push('');

    // 网络配置
    if (config) {
      lines.push('=== 电源轨道配置 ===');
      for (const rail of config.rails) {
        lines.push(`  ${rail.net}: ${rail.voltage}V`);
        lines.push(`    Sources: ${rail.sources.map(s => s.ref_des).join(', ')}`);
        lines.push(`    Loads: ${rail.loads.map(l => `${l.ref_des}(${l.current}A)`).join(', ')}`);
      }
    }

    return lines.join('\n');
  }

  // ============================================================
  // 序列化：Problem → JSON（发送到 Python 后端）
  // ============================================================

  /** 序列化 Problem 为 JSON 兼容格式 */
  serializeProblem(
    problem: Problem,
    preMeshed?: SerializedPreMeshedPolygon[][],
    options?: { generateImages?: boolean },
  ): SerializedProblem {
    return {
      format_version: preMeshed ? 2 : 1,
      project_name: problem.projectName ?? null,
      layers: problem.layers.map((l, i) => this.serializeLayer(l, preMeshed?.[i])),
      networks: problem.networks.map(n => this.serializeNetwork(n)),
      generate_images: options?.generateImages ?? false,
    };
  }

  private serializeLayer(layer: Layer, layerMeshes?: SerializedPreMeshedPolygon[]): SerializedLayer {
    const result: SerializedLayer = {
      name: layer.name,
      conductance: layer.conductance,
      geometry: this.serializeMultiPolygon(layer.shape),
    };
    if (layerMeshes) result.meshes = layerMeshes;
    return result;
  }

  private serializeNetwork(network: Network): SerializedNetwork {
    return {
      connections: network.connections.map(c => this.serializeConnection(c)),
      elements: network.elements.map(e => this.serializeLumpedElement(e)),
    };
  }

  private serializeConnection(conn: Connection): SerializedConnection {
    return {
      layer_name: conn.layerName,
      point: [conn.point.x, conn.point.y],
      node_id: conn.nodeId.id,
    };
  }

  private serializeLumpedElement(el: LumpedElement): SerializedLumpedElement {
    switch (el.type) {
      case 'resistor':
        return { type: 'resistor', a: el.a.id, b: el.b.id, resistance: el.resistance };
      case 'voltage_source':
        return { type: 'voltage_source', p: el.p.id, n: el.n.id, voltage: el.voltage };
      case 'current_source':
        return { type: 'current_source', f: el.f.id, t: el.t.id, current: el.current };
      case 'voltage_regulator':
        return {
          type: 'voltage_regulator',
          v_p: el.vP.id, v_n: el.vN.id,
          s_f: el.sF.id, s_t: el.sT.id,
          voltage: el.voltage, gain: el.gain,
        };
    }
  }

  private serializeMultiPolygon(mp: MultiPolygon): SerializedMultiPolygon {
    return mp.polygons.map(p => {
      const rings: SerializedPolygon = [p.exterior.map(pt => [pt.x, pt.y] as SerializedPoint)];
      for (const hole of p.holes) {
        rings.push(hole.map(pt => [pt.x, pt.y] as SerializedPoint));
      }
      return rings;
    });
  }

  // ============================================================
  // 反序列化：JSON → TypeScript 类型
  // ============================================================

  /** 反序列化 JSON 为 Problem */
  deserializeProblem(sp: SerializedProblem): Problem {
    return {
      projectName: sp.project_name ?? undefined,
      layers: sp.layers.map(sl => this.deserializeLayer(sl)),
      networks: sp.networks.map(sn => this.deserializeNetwork(sn)),
    };
  }

  private deserializeLayer(sl: SerializedLayer): Layer {
    return {
      name: sl.name,
      conductance: sl.conductance,
      shape: this.deserializeMultiPolygon(sl.geometry),
    };
  }

  private deserializeNetwork(sn: SerializedNetwork): Network {
    return {
      connections: sn.connections.map(c => this.deserializeConnection(c)),
      elements: sn.elements.map(e => this.deserializeLumpedElement(e)),
    };
  }

  private deserializeConnection(sc: SerializedConnection): Connection {
    return {
      layerName: sc.layer_name,
      point: { x: sc.point[0], y: sc.point[1] },
      nodeId: { id: sc.node_id },
    };
  }

  private deserializeLumpedElement(se: SerializedLumpedElement): LumpedElement {
    switch (se.type) {
      case 'resistor':
        return { type: 'resistor', a: { id: se.a }, b: { id: se.b }, resistance: se.resistance };
      case 'voltage_source':
        return { type: 'voltage_source', p: { id: se.p }, n: { id: se.n }, voltage: se.voltage };
      case 'current_source':
        return { type: 'current_source', f: { id: se.f }, t: { id: se.t }, current: se.current };
      case 'voltage_regulator':
        return {
          type: 'voltage_regulator',
          vP: { id: se.v_p }, vN: { id: se.v_n },
          sF: { id: se.s_f }, sT: { id: se.s_t },
          voltage: se.voltage, gain: se.gain,
        };
    }
  }

  private deserializeMultiPolygon(smp: SerializedMultiPolygon): MultiPolygon {
    return {
      polygons: smp.map(sp => ({
        exterior: sp[0].map(p => ({ x: p[0], y: p[1] })),
        holes: sp.slice(1).map(ring => ring.map(p => ({ x: p[0], y: p[1] }))),
      })),
    };
  }

  // ============================================================
  // 求解结果反序列化
  // ============================================================

  /** 反序列化后端求解结果为显示类型 */
  deserializeSolution(solution: SerializedSolution, layerNames: string[]): SolutionData {
    return {
      layerSolutions: solution.layer_solutions.map((ls, i) => ({
        layerName: ls.layer_name ?? layerNames[i] ?? `Layer ${i}`,
        meshes: ls.meshes.map(m => ({
          vertices: m.vertices.map(p => ({ x: p[0], y: p[1] })),
          triangles: m.triangles.map(t => [t.vertices[0], t.vertices[1], t.vertices[2]]),
          potentials: m.potentials,
          powerDensities: m.power_densities,
        })),
        disconnectedMeshes: ls.disconnected_meshes.map(m => ({
          vertices: m.vertices.map(p => ({ x: p[0], y: p[1] })),
          triangles: m.triangles.map(t => [t.vertices[0], t.vertices[1], t.vertices[2]]),
          potentials: [],
          powerDensities: [],
        })),
      })),
      solverInfo: {
        groundNodeCurrent: solution.solver_info.ground_node_current,
        residualNorm: solution.solver_info.residual_norm,
      },
      diagnostics: solution.diagnostics,
    };
  }

  // ============================================================
  // 单位转换
  // ============================================================

  /** mil → mm */
  milToMm(mil: number): number {
    return mil * this.MIL_TO_MM;
  }

  // ============================================================
  // 摘要生成
  // ============================================================

  /** 计算 Problem 摘要 */
  summarizeProblem(problem: Problem): ProblemSummary {
    let totalPolygons = 0;
    let totalVertices = 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const elementCounts: Record<string, number> = {};

    for (const layer of problem.layers) {
      for (const poly of layer.shape.polygons) {
        totalPolygons++;
        totalVertices += poly.exterior.length;
        for (const pt of poly.exterior) {
          if (pt.x < minX) minX = pt.x;
          if (pt.y < minY) minY = pt.y;
          if (pt.x > maxX) maxX = pt.x;
          if (pt.y > maxY) maxY = pt.y;
        }
      }
    }

    let totalConnections = 0;
    for (const network of problem.networks) {
      totalConnections += network.connections.length;
      for (const el of network.elements) {
        elementCounts[el.type] = (elementCounts[el.type] ?? 0) + 1;
      }
    }

    return {
      projectName: problem.projectName ?? null,
      layerCount: problem.layers.length,
      layerNames: problem.layers.map(l => l.name),
      networkCount: problem.networks.length,
      totalConnections,
      elementCounts,
      geometryStats: {
        totalPolygons,
        totalVertices,
        boundingBox: minX !== Infinity ? { minX, minY, maxX, maxY } : null,
      },
    };
  }

  /** 格式化摘要为可读字符串 */
  formatSummary(summary: ProblemSummary): string {
    const lines: string[] = [];
    lines.push(`项目: ${summary.projectName ?? '未命名'}`);
    lines.push(`层数: ${summary.layerCount} (${summary.layerNames.join(', ')})`);
    lines.push(`网络: ${summary.networkCount}`);
    lines.push(`连接: ${summary.totalConnections}`);
    const elemParts = Object.entries(summary.elementCounts).map(([t, c]) => `${t}: ${c}`);
    if (elemParts.length > 0) lines.push(`元件: ${elemParts.join(', ')}`);
    if (summary.geometryStats.boundingBox) {
      const bb = summary.geometryStats.boundingBox;
      lines.push(`板子: ${(bb.maxX - bb.minX).toFixed(1)} × ${(bb.maxY - bb.minY).toFixed(1)} mm`);
      lines.push(`多边形: ${summary.geometryStats.totalPolygons}, 顶点: ${summary.geometryStats.totalVertices}`);
    }
    return lines.join('\n');
  }
}
