import React, { useState } from 'react';
import { Search, Settings, ArrowRight, RefreshCw, FolderArchive, FileCode, Check, Smartphone, Monitor, Layers, FileSearch } from 'lucide-react';
import { CloneOptions, CloneMode } from '../types';

interface UrlInputBarProps {
  onStartClone: (options: CloneOptions) => void;
  isLoading: boolean;
}

const PRESET_SITES = [
  { name: '示例引导页', url: 'https://example.com' },
  { name: '百度首页', url: 'https://www.baidu.com' },
  { name: '维基百科', url: 'https://zh.wikipedia.org' },
  { name: 'GitHub Blog', url: 'https://github.blog' },
  { name: 'Vite 官网', url: 'https://vitejs.dev' },
];

export const UrlInputBar: React.FC<UrlInputBarProps> = ({ onStartClone, isLoading }) => {
  const [url, setUrl] = useState('https://example.com');
  const [mode, setMode] = useState<CloneMode>('zip');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [userAgent, setUserAgent] = useState<'desktop' | 'mobile'>('desktop');
  const [downloadCss, setDownloadCss] = useState(true);
  const [downloadJs, setDownloadJs] = useState(true);
  const [downloadImages, setDownloadImages] = useState(true);
  const [crawlDepth, setCrawlDepth] = useState<number>(3); // Default to 3 depth for articles & inner pages
  const [maxPages, setMaxPages] = useState<number>(20); // Default 20 pages

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    onStartClone({
      url: url.trim(),
      mode,
      userAgent,
      downloadCss,
      downloadJs,
      downloadImages,
      crawlDepth,
      maxPages,
      timeoutMs: 30000,
    });
  };

  const handlePresetSelect = (presetUrl: string) => {
    setUrl(presetUrl);
  };

  return (
    <div className="bg-slate-900 border-b border-slate-800 text-white pt-8 pb-10 px-4 sm:px-6">
      <div className="max-w-4xl mx-auto text-center mb-6">
        <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-100 tracking-tight">
          输入网址，一键获取全套网页与内页离线镜像包
        </h2>
        <p className="mt-2 text-sm text-slate-400">
          支持解析导航栏与子页面层级，提取外链 CSS/JS 及图片资源，解压 ZIP 在本地双击即可无缝点击跳转内页。
        </p>
      </div>

      <div className="max-w-4xl mx-auto">
        <form onSubmit={handleSubmit} className="relative shadow-2xl rounded-2xl bg-slate-800/90 border border-slate-700/80 p-3 sm:p-4">
          <div className="flex flex-col sm:flex-row items-stretch gap-3">
            {/* Input Field */}
            <div className="relative flex-1">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-indigo-400" />
              </div>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="例如: https://example.com 或 www.baidu.com"
                required
                className="block w-full pl-11 pr-4 py-3.5 bg-slate-900/90 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm sm:text-base transition-all font-mono"
              />
              {url && (
                <button
                  type="button"
                  onClick={() => setUrl('')}
                  className="absolute inset-y-0 right-3 flex items-center text-xs text-slate-500 hover:text-slate-300"
                >
                  清除
                </button>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className={`p-3.5 rounded-xl border transition-colors flex items-center justify-center ${
                  showAdvanced
                    ? 'bg-indigo-600/30 border-indigo-500 text-indigo-300'
                    : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                }`}
                title="高级与多页面设置"
              >
                <Settings className={`w-5 h-5 ${showAdvanced ? 'rotate-90' : ''} transition-transform duration-300`} />
              </button>

              <button
                type="submit"
                disabled={isLoading || !url.trim()}
                className="flex-1 sm:flex-initial px-6 py-3.5 rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white font-semibold shadow-lg shadow-indigo-600/30 flex items-center justify-center space-x-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm sm:text-base"
              >
                {isLoading ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    <span>正在获取与打包中...</span>
                  </>
                ) : (
                  <>
                    <span>获取目标源码</span>
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Mode & Depth Quick Selector Bar */}
          <div className="mt-4 pt-4 border-t border-slate-700/60 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center space-x-2 text-slate-400 font-medium">
                <span>克隆模式:</span>
                <div className="inline-flex rounded-lg bg-slate-900 p-1 border border-slate-700">
                  <button
                    type="button"
                    onClick={() => setMode('zip')}
                    className={`px-2.5 py-1 rounded-md transition-all flex items-center space-x-1.5 ${
                      mode === 'zip'
                        ? 'bg-indigo-600 text-white font-semibold shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <FolderArchive className="w-3.5 h-3.5" />
                    <span>ZIP 离线包 (支持多内页)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setMode('standalone')}
                    className={`px-2.5 py-1 rounded-md transition-all flex items-center space-x-1.5 ${
                      mode === 'standalone'
                        ? 'bg-indigo-600 text-white font-semibold shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <FileCode className="w-3.5 h-3.5" />
                    <span>仅单首页 HTML</span>
                  </button>
                </div>
              </div>

              {/* Quick Depth Selection */}
              {mode === 'zip' && (
                <div className="flex items-center space-x-2 text-slate-400 font-medium">
                  <span className="flex items-center text-indigo-300">
                    <Layers className="w-3.5 h-3.5 mr-1" />
                    抓取深度:
                  </span>
                  <div className="inline-flex rounded-lg bg-slate-900 p-1 border border-slate-700">
                    <button
                      type="button"
                      onClick={() => setCrawlDepth(1)}
                      className={`px-2 py-0.5 rounded text-[11px] ${
                        crawlDepth === 1 ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      1层 (首页)
                    </button>
                    <button
                      type="button"
                      onClick={() => setCrawlDepth(2)}
                      className={`px-2 py-0.5 rounded text-[11px] ${
                        crawlDepth === 2 ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      2层 (导航)
                    </button>
                    <button
                      type="button"
                      onClick={() => setCrawlDepth(3)}
                      className={`px-2 py-0.5 rounded text-[11px] ${
                        crawlDepth === 3 ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      3层 (文章列表/详情)
                    </button>
                    <button
                      type="button"
                      onClick={() => setCrawlDepth(4)}
                      className={`px-2 py-0.5 rounded text-[11px] ${
                        crawlDepth === 4 ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      4层 (多级深入)
                    </button>
                    <button
                      type="button"
                      onClick={() => setCrawlDepth(5)}
                      className={`px-2 py-0.5 rounded text-[11px] ${
                        crawlDepth === 5 ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      5层 (全站递归)
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Presets */}
            <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 sm:pb-0">
              <span className="text-slate-500 mr-1 hidden md:inline">快速测试:</span>
              {PRESET_SITES.map((preset) => (
                <button
                  key={preset.url}
                  type="button"
                  onClick={() => handlePresetSelect(preset.url)}
                  className="px-2.5 py-1 rounded-md bg-slate-900/80 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs transition-colors whitespace-nowrap"
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>

          {/* Advanced Drawer */}
          {showAdvanced && (
            <div className="mt-4 p-4 rounded-xl bg-slate-900/90 border border-slate-700 text-slate-300 text-xs space-y-4 animate-fadeIn">
              <div className="font-semibold text-slate-200 border-b border-slate-800 pb-2 flex items-center justify-between">
                <span>🛠️ 高级抓取与多层级设置</span>
                <span className="text-[11px] font-normal text-slate-500">自定义内页抓取与文件提取规则</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-1">
                {/* Multi-page depth and limits */}
                <div className="space-y-2 bg-slate-800/60 p-3 rounded-lg border border-slate-700/60">
                  <label className="block text-indigo-300 font-bold flex items-center space-x-1">
                    <FileSearch className="w-3.5 h-3.5" />
                    <span>内页抓取上限:</span>
                  </label>
                  <div className="grid grid-cols-5 gap-1 text-center font-mono text-[11px]">
                    {[10, 20, 30, 50, 100].map((num) => (
                      <button
                        key={num}
                        type="button"
                        onClick={() => setMaxPages(num)}
                        className={`py-1 rounded border ${
                          maxPages === num
                            ? 'bg-indigo-600 border-indigo-500 text-white font-bold'
                            : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {num} 页
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-400 leading-tight">
                    在抓取层级范围内，最多关联抓取的同域内页总数量。
                  </p>
                </div>

                {/* User Agent */}
                <div className="space-y-1">
                  <label className="block text-slate-400 font-medium">模拟设备标识 (User-Agent):</label>
                  <div className="flex rounded-lg bg-slate-800 p-1 border border-slate-700">
                    <button
                      type="button"
                      onClick={() => setUserAgent('desktop')}
                      className={`flex-1 py-1 rounded flex items-center justify-center space-x-1 ${
                        userAgent === 'desktop' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Monitor className="w-3.5 h-3.5" />
                      <span>PC 桌面版</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setUserAgent('mobile')}
                      className={`flex-1 py-1 rounded flex items-center justify-center space-x-1 ${
                        userAgent === 'mobile' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Smartphone className="w-3.5 h-3.5" />
                      <span>手机移动版</span>
                    </button>
                  </div>
                </div>

                {/* Resource Checkboxes */}
                <div className="space-y-2">
                  <label className="block text-slate-400 font-medium">资源获取选项:</label>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={downloadCss}
                      onChange={(e) => setDownloadCss(e.target.checked)}
                      className="rounded bg-slate-800 border-slate-700 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>提取 CSS 外部样式文件</span>
                  </label>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={downloadJs}
                      onChange={(e) => setDownloadJs(e.target.checked)}
                      className="rounded bg-slate-800 border-slate-700 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>提取 JavaScript 脚本文件</span>
                  </label>
                </div>

                <div className="space-y-2">
                  <label className="block text-slate-400 font-medium">图片与多媒体:</label>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={downloadImages}
                      onChange={(e) => setDownloadImages(e.target.checked)}
                      className="rounded bg-slate-800 border-slate-700 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>下载图片与 Favicon 图标</span>
                  </label>
                </div>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};

