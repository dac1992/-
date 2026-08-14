export type CloneMode = 'zip' | 'standalone' | 'inlined';

export interface CloneOptions {
  url: string;
  mode: CloneMode;
  userAgent?: string;
  downloadImages?: boolean;
  downloadCss?: boolean;
  downloadJs?: boolean;
  inlineSmallAssets?: boolean;
  timeoutMs?: number;
  maxAssetSizeMb?: number;
  addBaseTag?: boolean;
  cleanScripts?: boolean;
  crawlDepth?: number; // 1 = 仅首页, 2 = 包含直接内页, 3 = 深度内页
  maxPages?: number; // 最大抓取页面数
}

export interface AssetItem {
  path: string;
  originalUrl: string;
  type: 'css' | 'js' | 'image' | 'font' | 'other';
  size: number;
  status: 'success' | 'failed' | 'skipped';
  error?: string;
  mimeType?: string;
  dataBase64?: string; // Optional preview
}

export interface SubpageItem {
  url: string;
  title: string;
  localPath: string;
  size: number;
  depth: number;
}

export interface CloneResult {
  id: string;
  url: string;
  finalUrl: string;
  title: string;
  favicon?: string;
  description?: string;
  timestamp: number;
  mode: CloneMode;
  stats: {
    htmlSize: number;
    totalAssetsSize: number;
    assetCount: number;
    pagesCount: number;
    cssCount: number;
    jsCount: number;
    imageCount: number;
    fontCount: number;
    loadTimeMs: number;
    statusCode: number;
  };
  processedHtml: string;
  standaloneHtml: string;
  assets: AssetItem[];
  subpages?: SubpageItem[];
  zipBase64?: string;
  responseHeaders?: Record<string, string>;
  logs: ProgressLog[];
}

export interface ProgressLog {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

export interface SiteHistoryItem {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  timestamp: number;
  mode: CloneMode;
  totalSize: number;
  assetCount: number;
  pagesCount?: number;
  processedHtml: string;
  zipBase64?: string;
  standaloneHtml: string;
}
