import type { SerializedProblem, SerializedSolution } from './types';

/**
 * api.ts - HTTP 通信模块
 * 负责与 padne Python 后端服务通信
 */

export interface ApiConfig {
  analyzeEndpoint: string;
  testEndpoint: string;
}

export class PdnApiClient {
  private host: string;
  private port: number;
  private config: ApiConfig;

  constructor(host: string, port: number, config: ApiConfig) {
    this.host = host;
    this.port = port;
    this.config = config;
  }

  /** 检测后端服务是否运行 */
  async checkService(): Promise<boolean> {
    try {
      const url = `http://${this.host}:${this.port}${this.config.testEndpoint}`;
      const response = await eda.sys_ClientUrl.request(url);
      return response.ok;
    } catch {
      return false;
    }
  }

  /** 发送分析请求 */
  async analyze(data: SerializedProblem): Promise<any> {
    const url = `http://${this.host}:${this.port}${this.config.analyzeEndpoint}`;

    const response = await eda.sys_ClientUrl.request(url, 'POST', JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[PdnApiClient] HTTP 错误:', response.status, errorText);
      throw new Error(`HTTP 错误: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    return result;
  }

  /** 获取服务 URL */
  getServiceUrl(): string {
    return `http://${this.host}:${this.port}`;
  }
}
