// ============================================================
// 几何类型
// ============================================================

/** 二维点 */
export interface Point {
  x: number;
  y: number;
}

/** 多边形：外环 + 零或多个孔洞 */
export interface Polygon {
  exterior: Point[];
  holes: Point[][];
}

/** 多多边形 */
export interface MultiPolygon {
  polygons: Polygon[];
}

// ============================================================
// EasyEDA 原始数据类型
// ============================================================

/** EasyEDA 走线 */
export interface EasyEDA_Track {
  net: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  layer: number;
}

/** EasyEDA 过孔 */
export interface EasyEDA_Via {
  net: string;
  x: number;
  y: number;
  diameter: number;
  hole_diameter: number;
}

/** EasyEDA 焊盘 */
export interface EasyEDA_Pad {
  net: string;
  x: number;
  y: number;
  pad_number: string;
  width: number;
  height: number;
  hole_diameter: number;
  layer?: number;
  ref_des?: string;
  device_name?: string;
}

/** EasyEDA 铺铜区域 */
export interface EasyEDA_CopperPour {
  net: string;
  layer: number;
  vertices: Array<{ x: number; y: number }>;
  holes: Array<Array<{ x: number; y: number }>>;
  is_fill: boolean;
}

/** EasyEDA PCB 完整数据 */
export interface EasyEDA_PcbData {
  tracks: EasyEDA_Track[];
  vias: EasyEDA_Via[];
  pads: EasyEDA_Pad[];
  copperPours: EasyEDA_CopperPour[];
  layerNames: Record<number, string>;
  outerLayerIds: Set<number>;
}

// ============================================================
// 层叠结构类型（对应 padne/problem.py）
// ============================================================

/** 层叠项类型 */
export enum StackupItemType {
  COPPER = 'COPPER',
  DIELECTRIC = 'DIELECTRIC',
}

/** 层叠中的单层 */
export interface StackupItem {
  name: string;
  thickness: number; // mm
  type: StackupItemType;
  conductivity?: number; // S/mm
}

/** PCB 层叠结构 */
export interface Stackup {
  items: StackupItem[];
}

/** 铜层：包含几何形状、名称和电导 */
export interface Layer {
  shape: MultiPolygon;
  name: string;
  conductance: number; // S = 电导率 [S/mm] × 厚度 [mm]
}

// ============================================================
// 网络与电路类型（对应 padne/problem.py）
// ============================================================

/** 焊盘端点：器件位号 + 焊盘编号，如 "R1.1" */
export interface Endpoint {
  designator: string;
  pad: string;
}

/** 层上的点 */
export interface LayerPoint {
  layer: string;
  point: Point;
}

/** 网络节点 ID */
export interface NodeID {
  id: string;
}

/** 连接：将网络节点绑定到层上的物理点 */
export interface Connection {
  layerName: string;
  point: Point;
  nodeId: NodeID;
}

/** 电阻 */
export interface Resistor {
  type: 'resistor';
  a: NodeID;
  b: NodeID;
  resistance: number;
}

/** 电压源 */
export interface VoltageSource {
  type: 'voltage_source';
  p: NodeID;
  n: NodeID;
  voltage: number;
}

/** 电流源 */
export interface CurrentSource {
  type: 'current_source';
  f: NodeID;
  t: NodeID;
  current: number;
}

/** 稳压器 */
export interface VoltageRegulator {
  type: 'voltage_regulator';
  vP: NodeID;
  vN: NodeID;
  sF: NodeID;
  sT: NodeID;
  voltage: number;
  gain: number;
}

/** 所有集总元件联合类型 */
export type LumpedElement = Resistor | VoltageSource | CurrentSource | VoltageRegulator;

/** 电气网络 */
export interface Network {
  connections: Connection[];
  elements: LumpedElement[];
}

/** PDN 分析问题 */
export interface Problem {
  layers: Layer[];
  networks: Network[];
  projectName?: string;
}

// ============================================================
// 指令类型（对应 kicad.py Directive）
// ============================================================

/** 原理图中的 !padne 指令 */
export interface Directive {
  name: string;
  params: Record<string, string>;
}

/** 铜电导率规格 */
export interface CopperSpec {
  conductivity: number; // S/mm
}

// ============================================================
// 过孔规格
// ============================================================

/** 过孔规格 */
export interface ViaSpec {
  point: Point;
  drillDiameter: number; // mm
  layerNames: string[];
  endpoint?: Endpoint;
  shape: Polygon;
}

// ============================================================
// 序列化格式类型（发送到 Python 后端）
// ============================================================

/** 序列化点 [x, y] */
export type SerializedPoint = [number, number];

/** 序列化多边形：[外环, 孔洞1, 孔洞2, ...] */
export type SerializedPolygon = SerializedPoint[][];

/** 序列化多多边形 */
export type SerializedMultiPolygon = SerializedPolygon[];

/** 序列化层 */
export interface SerializedPreMeshedPolygon {
  vertices: [number, number][];
  triangles: [number, number, number][];
}

export interface SerializedLayer {
  name: string;
  conductance: number;
  geometry: SerializedMultiPolygon;
  meshes?: SerializedPreMeshedPolygon[];
}

/** 序列化连接 */
export interface SerializedConnection {
  layer_name: string;
  point: SerializedPoint;
  node_id: string;
}

/** 序列化电阻 */
export interface SerializedResistor {
  type: 'resistor';
  a: string;
  b: string;
  resistance: number;
}

/** 序列化电压源 */
export interface SerializedVoltageSource {
  type: 'voltage_source';
  p: string;
  n: string;
  voltage: number;
}

/** 序列化电流源 */
export interface SerializedCurrentSource {
  type: 'current_source';
  f: string;
  t: string;
  current: number;
}

/** 序列化稳压器 */
export interface SerializedVoltageRegulator {
  type: 'voltage_regulator';
  v_p: string;
  v_n: string;
  s_f: string;
  s_t: string;
  voltage: number;
  gain: number;
}

/** 序列化集总元件联合类型 */
export type SerializedLumpedElement =
  | SerializedResistor
  | SerializedVoltageSource
  | SerializedCurrentSource
  | SerializedVoltageRegulator;

/** 序列化网络 */
export interface SerializedNetwork {
  connections: SerializedConnection[];
  elements: SerializedLumpedElement[];
}

/** 发送到 Python 后端的完整序列化问题 */
export interface SerializedProblem {
  format_version: 1 | 2;
  project_name: string | null;
  layers: SerializedLayer[];
  networks: SerializedNetwork[];
  generate_images?: boolean;
}

// ============================================================
// 求解结果类型（从 Python 后端返回）
// ============================================================

/** 三角面片 */
export interface MeshTriangle {
  vertices: [number, number, number];
}

/** 序列化网格 */
export interface SerializedMesh {
  vertices: SerializedPoint[];
  triangles: MeshTriangle[];
  potentials: number[];
  power_densities: number[];
}

/** 序列化断开连接的网格 */
export interface SerializedDisconnectedMesh {
  vertices: SerializedPoint[];
  triangles: MeshTriangle[];
}

/** 序列化层求解结果 */
export interface SerializedLayerSolution {
  layer_name: string;
  meshes: SerializedMesh[];
  disconnected_meshes: SerializedDisconnectedMesh[];
}

/** 序列化求解器信息 */
export interface SerializedSolverInfo {
  ground_node_current: number;
  residual_norm: number;
}

/** 序列化完整求解结果 */
export interface SerializedSolution {
  layer_solutions: SerializedLayerSolution[];
  solver_info: SerializedSolverInfo;
  diagnostics?: string[];
}

// ============================================================
// 显示用类型
// ============================================================

/** 网格数据 */
export interface MeshData {
  vertices: Point[];
  triangles: [number, number, number][];
  potentials: number[];
  powerDensities: number[];
}

/** 层求解结果数据 */
export interface LayerSolutionData {
  layerName: string;
  meshes: MeshData[];
  disconnectedMeshes: MeshData[];
}

/** 求解器信息 */
export interface SolverInfoData {
  groundNodeCurrent: number;
  residualNorm: number;
}

/** 完整求解结果数据 */
export interface SolutionData {
  layerSolutions: LayerSolutionData[];
  solverInfo: SolverInfoData;
  diagnostics?: string[];
}

// ============================================================
// 摘要类型
// ============================================================

/** 问题摘要 */
export interface ProblemSummary {
  projectName: string | null;
  layerCount: number;
  layerNames: string[];
  networkCount: number;
  totalConnections: number;
  elementCounts: Record<string, number>;
  geometryStats: {
    totalPolygons: number;
    totalVertices: number;
    boundingBox: { minX: number; minY: number; maxX: number; maxY: number } | null;
  };
}

// ============================================================
// 用户配置类型（config.html → index.ts）
// ============================================================

/** 用户的 PDN 分析配置 */
export interface PdnConfig {
  rails: PdnRailConfig[];
  layerCuThickness: Record<number, number>;
}

/** 单个电源轨道配置 */
export interface PdnRailConfig {
  net: string;
  voltage: number;
  sources: PdnSourceConfig[];
  loads: PdnLoadConfig[];
}

/** 电压源配置 */
export interface PdnSourceConfig {
  ref_des: string;
  pads: Array<{ x: number; y: number; layer: string }>;
}

/** 电流负载配置 */
export interface PdnLoadConfig {
  ref_des: string;
  current: number;
  pads: Array<{ x: number; y: number; layer: string }>;
}

// ============================================================
// 可视化图片类型（Python 后端 → 前端）
// ============================================================

/** 分析结果中的可视化图片 */
export interface AnalysisImages {
  view_3d?: string;
  layers: Record<string, string>;
}

// ============================================================
// PCB 上下文数据（用于热力图与 PCB 叠加显示）
// ============================================================

/** 上下文走线（非分析网络的走线，已转换为 mm） */
export interface ContextTrack {
  x1: number; y1: number;
  x2: number; y2: number;
  width: number;
  layer: number;
  net: string;
}

/** 上下文焊盘（已转换为 mm） */
export interface ContextPad {
  x: number;
  y: number;
  width: number;
  height: number;
  hole_diameter: number;
  layer?: number;
  net: string;
  ref_des?: string;
  pad_number: string;
}

/** PCB 上下文数据，传递给 results.html 用于叠加显示 */
export interface PcbContextData {
  contextTracks: ContextTrack[];
  contextPads: ContextPad[];
}
