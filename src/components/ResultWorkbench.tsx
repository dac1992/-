import React, { useState, useEffect, useCallback, useRef } from 'react';
import JSZip from 'jszip';
import {
  Monitor,
  Tablet,
  Smartphone,
  Download,
  FileCode,
  FolderArchive,
  ExternalLink,
  Copy,
  Check,
  Maximize2,
  Minimize2,
  RefreshCw,
  Folder,
  FileText,
  Image as ImageIcon,
  Code as CodeIcon,
  Layers,
  Sparkles,
  Info,
  CheckCircle2,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Home,
  AlertCircle,
  X
} from 'lucide-react';
import { CloneResult, AssetItem } from '../types';

interface ResultWorkbenchProps {
  result: CloneResult;
}

interface HtmlPageItem {
  path: string;
  title: string;
}

export const ResultWorkbench: React.FC<ResultWorkbenchProps> = ({ result }) => {
  const [activeTab, setActiveTab] = useState<'preview' | 'assets' | 'code' | 'stats'>('preview');
  const [device, setDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [previewMode, setPreviewMode] = useState<'processed' | 'standalone'>('processed');
  const [codeType, setCodeType] = useState<'processed' | 'standalone'>('processed');
  const [copied, setCopied] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<AssetItem | null>(null);

  // Subpage navigation and history state
  const [currentPath, setCurrentPath] = useState<string>('index.html');
  const [navHistory, setNavHistory] = useState<string[]>(['index.html']);
  const [historyIndex, setHistoryIndex] = useState<number>(0);
  const [availablePages, setAvailablePages] = useState<HtmlPageItem[]>([]);
  const [navToast, setNavToast] = useState<{ message: string; targetUrl?: string } | null>(null);

  // In-memory offline unpacked HTML with local blob URLs
  const [offlineHtmlWithBlobs, setOfflineHtmlWithBlobs] = useState<string>('');
  const [isPreparingOffline, setIsPreparingOffline] = useState(false);
  const [unpackedCount, setUnpackedCount] = useState({ css: 0, images: 0, pages: 1 });

  const zipInstanceRef = useRef<JSZip | null>(null);
  const blobUrlsRef = useRef<string[]>([]);
  const assetBlobMapRef = useRef<Record<string, string>>({});
  const cssContentMapRef = useRef<Record<string, string>>({});

  // Helper to normalize path lookup inside ZIP
  const findFileInZip = useCallback((zip: JSZip, targetPath: string) => {
    const clean = targetPath.replace(/^\.\//, '').replace(/^\//, '');
    if (zip.file(clean)) return zip.file(clean);
    for (const [name, file] of Object.entries(zip.files)) {
      if (name.toLowerCase() === clean.toLowerCase() || name.endsWith('/' + clean) || clean.endsWith('/' + name)) {
        return file;
      }
    }
    return null;
  }, []);

  // Build rendered HTML for a specific page using unpacked blobs
  const renderPageHtml = useCallback(async (zip: JSZip, pagePath: string) => {
    const file = findFileInZip(zip, pagePath);
    let htmlText = file ? await file.async('text') : result.processedHtml;

    const cleanCurrent = pagePath.replace(/^\.\//, '');

    // 1. Replace stylesheet link tags with inlined <style> containing the blob-mapped CSS
    for (const [cssPath, cssContent] of Object.entries(cssContentMapRef.current)) {
      const cleanCss = cssPath.replace(/^\.\//, '');
      const linkPattern = new RegExp(`<link[^>]+href=["'][^"']*${cleanCss.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`, 'gi');
      htmlText = htmlText.replace(linkPattern, `<style data-source="${cleanCss}">\n${cssContent}\n</style>`);
    }

    // 2. Replace asset references in HTML (images, scripts, inline styles)
    for (const [assetPath, blobUrl] of Object.entries(assetBlobMapRef.current)) {
      if (assetPath.startsWith('./') || assetPath.startsWith('/')) continue;
      const simpleName = assetPath;
      htmlText = htmlText.split(`"${simpleName}"`).join(`"${blobUrl}"`);
      htmlText = htmlText.split(`'${simpleName}'`).join(`'${blobUrl}'`);
      htmlText = htmlText.split(`"./${simpleName}"`).join(`"${blobUrl}"`);
      htmlText = htmlText.split(`'./${simpleName}'`).join(`'${blobUrl}'`);
      htmlText = htmlText.split(`"../${simpleName}"`).join(`"${blobUrl}"`);
      htmlText = htmlText.split(`'../${simpleName}'`).join(`'${blobUrl}'`);
    }

    // 3. Inject interactive navigation bridge script
    const navScript = `
<script id="__offline_interactive_nav_bridge">
(function() {
  window.__CLONER_PAGE_PATH = "${cleanCurrent}";
  
  document.addEventListener('click', function(e) {
    var a = e.target.closest('a');
    if (!a) return;
    var href = a.getAttribute('href');
    if (!href || href === '#' || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) {
      return;
    }

    // 1. Handle in-page Anchor jumps (#section)
    if (href.startsWith('#')) {
      var targetId = href.substring(1);
      var targetEl = document.getElementById(targetId) || document.querySelector('[name="' + targetId + '"]');
      if (targetEl) {
        e.preventDefault();
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }

    // 2. Handle local relative subpage links
    if (!href.startsWith('http://') && !href.startsWith('https://') && !href.startsWith('//') && !href.startsWith('blob:')) {
      e.preventDefault();
      window.parent.postMessage({
        type: 'CLONER_NAVIGATE',
        href: href,
        currentPath: window.__CLONER_PAGE_PATH
      }, '*');
      return;
    }

    // 3. Handle absolute / external links
    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//')) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
  }, true);
})();
</script>
`;

    if (htmlText.includes('</body>')) {
      htmlText = htmlText.replace('</body>', navScript + '\n</body>');
    } else {
      htmlText += navScript;
    }

    return htmlText;
  }, [findFileInZip, result.processedHtml]);

  // Initial Unpack of ZIP archive
  useEffect(() => {
    let isMounted = true;

    async function prepareOfflinePreview() {
      if (!result.zipBase64) {
        setOfflineHtmlWithBlobs(result.processedHtml);
        return;
      }

      setIsPreparingOffline(true);
      try {
        // Clean up previous blob URLs
        blobUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
        blobUrlsRef.current = [];

        const zip = await JSZip.loadAsync(result.zipBase64, { base64: true });
        zipInstanceRef.current = zip;

        const assetBlobMap: Record<string, string> = {};
        let imgCount = 0;
        let styleCount = 0;

        // Step 1: Discover all HTML pages inside ZIP
        const foundPages: HtmlPageItem[] = [];
        for (const [filePath, file] of Object.entries(zip.files)) {
          if (!file.dir && filePath.endsWith('.html')) {
            let pageTitle = filePath;
            if (filePath === 'index.html') {
              pageTitle = result.title ? `首页 (${result.title.substring(0, 16)})` : '首页 (index.html)';
            } else if (result.subpages) {
              const matchedSub = result.subpages.find(s => s.localPath === filePath);
              if (matchedSub && matchedSub.title) {
                pageTitle = `${matchedSub.title.substring(0, 16)} (${filePath})`;
              }
            }
            foundPages.push({ path: filePath, title: pageTitle });
          }
        }
        foundPages.sort((a, b) => (a.path === 'index.html' ? -1 : b.path === 'index.html' ? 1 : a.path.localeCompare(b.path)));

        // Step 2: Extract all binary assets (images, fonts, scripts)
        for (const [filePath, file] of Object.entries(zip.files)) {
          if (file.dir || filePath.endsWith('.html') || filePath.endsWith('.css') || filePath.endsWith('.txt')) {
            continue;
          }
          const ab = await file.async('arraybuffer');
          let mime = 'application/octet-stream';
          const lower = filePath.toLowerCase();
          if (lower.endsWith('.png')) mime = 'image/png';
          else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) mime = 'image/jpeg';
          else if (lower.endsWith('.gif')) mime = 'image/gif';
          else if (lower.endsWith('.svg')) mime = 'image/svg+xml';
          else if (lower.endsWith('.webp')) mime = 'image/webp';
          else if (lower.endsWith('.ico')) mime = 'image/x-icon';
          else if (lower.endsWith('.avif')) mime = 'image/avif';
          else if (lower.endsWith('.woff2')) mime = 'font/woff2';
          else if (lower.endsWith('.woff')) mime = 'font/woff';
          else if (lower.endsWith('.ttf')) mime = 'font/ttf';
          else if (lower.endsWith('.js')) mime = 'application/javascript';

          if (mime.startsWith('image/')) imgCount++;

          const blob = new Blob([ab], { type: mime });
          const blobUrl = URL.createObjectURL(blob);
          blobUrlsRef.current.push(blobUrl);

          assetBlobMap[filePath] = blobUrl;
          assetBlobMap['./' + filePath] = blobUrl;
          assetBlobMap['/' + filePath] = blobUrl;
        }

        assetBlobMapRef.current = assetBlobMap;

        // Step 3: Extract & rewrite all CSS files with blob URLs
        const cssContentMap: Record<string, string> = {};
        for (const [filePath, file] of Object.entries(zip.files)) {
          if (file.dir || !filePath.endsWith('.css')) continue;
          styleCount++;
          let cssText = await file.async('text');

          for (const [assetPath, blobUrl] of Object.entries(assetBlobMap)) {
            if (assetPath.startsWith('./') || assetPath.startsWith('/')) continue;
            const simpleName = assetPath;
            const relFromCss = '../' + simpleName;

            cssText = cssText.split(`url("${relFromCss}")`).join(`url("${blobUrl}")`);
            cssText = cssText.split(`url('${relFromCss}')`).join(`url('${blobUrl}')`);
            cssText = cssText.split(`url(${relFromCss})`).join(`url("${blobUrl}")`);
            cssText = cssText.split(`"${relFromCss}"`).join(`"${blobUrl}"`);
            cssText = cssText.split(`'${relFromCss}'`).join(`'${blobUrl}'`);

            cssText = cssText.split(`url("${simpleName}")`).join(`url("${blobUrl}")`);
            cssText = cssText.split(`url('${simpleName}')`).join(`url('${blobUrl}')`);
            cssText = cssText.split(`url(${simpleName})`).join(`url("${blobUrl}")`);
            cssText = cssText.split(`"${simpleName}"`).join(`"${blobUrl}"`);
            cssText = cssText.split(`'${simpleName}'`).join(`'${blobUrl}'`);
          }

          cssContentMap[filePath] = cssText;
          cssContentMap['./' + filePath] = cssText;
        }

        cssContentMapRef.current = cssContentMap;

        // Step 4: Render initial home page
        const htmlText = await renderPageHtml(zip, 'index.html');

        if (isMounted) {
          setAvailablePages(foundPages);
          setCurrentPath('index.html');
          setNavHistory(['index.html']);
          setHistoryIndex(0);
          setOfflineHtmlWithBlobs(htmlText);
          setUnpackedCount({ css: styleCount, images: imgCount, pages: foundPages.length || 1 });
        }
      } catch (e) {
        console.error('Error unpacking zip for preview:', e);
        if (isMounted) {
          setOfflineHtmlWithBlobs(result.processedHtml);
        }
      } finally {
        if (isMounted) setIsPreparingOffline(false);
      }
    }

    prepareOfflinePreview();

    return () => {
      isMounted = false;
      blobUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    };
  }, [result.zipBase64, result.processedHtml, result.title, result.subpages, renderPageHtml]);

  // Navigate to a specific page inside the ZIP
  const navigateToPage = useCallback(async (targetPath: string, pushHistory = true) => {
    if (!zipInstanceRef.current) return;
    setIsPreparingOffline(true);
    try {
      const cleanTarget = targetPath.replace(/^\.\//, '');
      const rendered = await renderPageHtml(zipInstanceRef.current, cleanTarget);
      setOfflineHtmlWithBlobs(rendered);
      setCurrentPath(cleanTarget);

      if (pushHistory) {
        setNavHistory(prev => {
          const next = prev.slice(0, historyIndex + 1);
          return [...next, cleanTarget];
        });
        setHistoryIndex(prev => prev + 1);
      }
    } catch (e) {
      console.error('Error navigating page:', e);
    } finally {
      setIsPreparingOffline(false);
    }
  }, [historyIndex, renderPageHtml]);

  // Listen for navigation messages from iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!event.data || event.data.type !== 'CLONER_NAVIGATE') return;

      const { href, currentPath: fromPath } = event.data;
      if (!href) return;

      const [rawPath] = href.split('#');
      let targetPath = rawPath;

      if (!targetPath || targetPath === './' || targetPath === '.') {
        targetPath = fromPath;
      } else if (targetPath.startsWith('../')) {
        const fromDirParts = fromPath.split('/');
        fromDirParts.pop();
        const parts = targetPath.split('/');
        while (parts[0] === '..') {
          parts.shift();
          if (fromDirParts.length > 0) fromDirParts.pop();
        }
        targetPath = [...fromDirParts, ...parts].join('/');
      } else if (targetPath.startsWith('./')) {
        const fromDirParts = fromPath.split('/');
        fromDirParts.pop();
        targetPath = [...fromDirParts, targetPath.substring(2)].join('/');
      } else if (!targetPath.includes('/') && fromPath.includes('/')) {
        const fromDirParts = fromPath.split('/');
        fromDirParts.pop();
        targetPath = [...fromDirParts, targetPath].join('/');
      }

      targetPath = targetPath.replace(/^\.\//, '').replace(/^\//, '');

      // Check if target page exists in ZIP
      if (zipInstanceRef.current && findFileInZip(zipInstanceRef.current, targetPath)) {
        navigateToPage(targetPath);
      } else {
        // Subpage was not downloaded or is an external link
        try {
          const originalBase = new URL(result.finalUrl);
          const fullFallbackUrl = new URL(href, originalBase.href).href;
          setNavToast({
            message: `点击的导航链接 [${targetPath || href}] 为未下载的子页面（当前为单页克隆）。您可在新标签页直接访问原站，或开启【整站克隆】下载全部内页。`,
            targetUrl: fullFallbackUrl
          });
        } catch {
          setNavToast({
            message: `点击的导航链接 [${targetPath || href}] 为未下载的子页面。`,
          });
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [findFileInZip, navigateToPage, result.finalUrl]);

  // Handle browser history back / forward
  const handleNavBack = () => {
    if (historyIndex > 0) {
      const prevPath = navHistory[historyIndex - 1];
      setHistoryIndex(historyIndex - 1);
      navigateToPage(prevPath, false);
    }
  };

  const handleNavForward = () => {
    if (historyIndex < navHistory.length - 1) {
      const nextPath = navHistory[historyIndex + 1];
      setHistoryIndex(historyIndex + 1);
      navigateToPage(nextPath, false);
    }
  };

  const handleNavHome = () => {
    navigateToPage('index.html');
  };

  // Trigger download of ZIP archive
  const handleDownloadZip = () => {
    if (!result.zipBase64) {
      alert('未生成 ZIP 数据，将直接下载 index.html');
      handleDownloadHtml();
      return;
    }

    const link = document.createElement('a');
    link.href = `data:application/zip;base64,${result.zipBase64}`;
    const cleanHost = new URL(result.finalUrl).hostname.replace(/[^a-zA-Z0-9]/g, '_');
    link.download = `${cleanHost}_offline_mirror_${Date.now()}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Trigger download of standalone HTML
  const handleDownloadHtml = () => {
    const htmlContent = result.standaloneHtml || result.processedHtml;
    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const cleanHost = new URL(result.finalUrl).hostname.replace(/[^a-zA-Z0-9]/g, '_');
    link.download = `index_${cleanHost}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Copy HTML source code
  const handleCopyCode = () => {
    const code = codeType === 'standalone' ? result.standaloneHtml : result.processedHtml;
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Open in new tab
  const handleOpenNewTab = () => {
    const contentToOpen = previewMode === 'processed' ? (offlineHtmlWithBlobs || result.processedHtml) : (result.standaloneHtml || result.processedHtml);
    const blob = new Blob([contentToOpen], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  const getDeviceWidth = () => {
    if (device === 'mobile') return 'max-w-[375px]';
    if (device === 'tablet') return 'max-w-[768px]';
    return 'w-full';
  };

  const formatSize = (bytes: number) => {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 my-8 animate-fadeIn">
      {/* Target Site Summary Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 rounded-2xl border border-slate-700/80 p-5 shadow-2xl text-white mb-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start space-x-4">
            {result.favicon && (
              <img
                src={result.favicon}
                alt="Favicon"
                className="w-10 h-10 rounded-lg p-1 bg-slate-800 border border-slate-700 shrink-0 object-contain"
                onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
              />
            )}
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xl font-bold text-slate-100">{result.title}</h3>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center">
                  <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-400" />
                  解析成功 ({result.stats.statusCode})
                </span>
              </div>
              <a
                href={result.finalUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center mt-1 break-all group"
              >
                <span>{result.finalUrl}</span>
                <ExternalLink className="w-3 h-3 ml-1 group-hover:translate-x-0.5 transition-transform" />
              </a>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {result.zipBase64 && (
              <button
                onClick={handleDownloadZip}
                className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs sm:text-sm shadow-lg shadow-emerald-600/20 flex items-center space-x-2 transition-all hover:scale-[1.02]"
              >
                <FolderArchive className="w-4 h-4" />
                <span>下载完整的 ZIP 离线镜像包</span>
              </button>
            )}

            <button
              onClick={handleDownloadHtml}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 text-xs sm:text-sm font-semibold flex items-center space-x-1.5 transition-all"
            >
              <FileCode className="w-4 h-4 text-indigo-400" />
              <span>仅下载 index.html</span>
            </button>
          </div>
        </div>

        {/* Quick Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-4 border-t border-slate-800 text-xs text-slate-300">
          <div className="bg-slate-950/50 p-2.5 rounded-xl border border-slate-800">
            <span className="text-slate-400 block text-[11px]">抓取网页总数</span>
            <span className="font-mono text-sm font-bold text-indigo-300">{result.stats.pagesCount || 1} 个页面</span>
          </div>
          <div className="bg-slate-950/50 p-2.5 rounded-xl border border-slate-800">
            <span className="text-slate-400 block text-[11px]">提取静态资源数</span>
            <span className="font-mono text-sm font-bold text-cyan-300">{result.stats.assetCount} 个文件</span>
          </div>
          <div className="bg-slate-950/50 p-2.5 rounded-xl border border-slate-800">
            <span className="text-slate-400 block text-[11px]">离线镜像总大小</span>
            <span className="font-mono text-sm font-bold text-emerald-300">
              {formatSize(result.stats.htmlSize + result.stats.totalAssetsSize)}
            </span>
          </div>
          <div className="bg-slate-950/50 p-2.5 rounded-xl border border-slate-800">
            <span className="text-slate-400 block text-[11px]">抓取全耗时</span>
            <span className="font-mono text-sm font-bold text-amber-300">{result.stats.loadTimeMs} ms</span>
          </div>
        </div>
      </div>

      {/* Main Tabs Navigation */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
        <div className="bg-slate-800/90 border-b border-slate-700/80 px-4 pt-3 flex items-center justify-between flex-wrap gap-2">
          <div className="flex space-x-1">
            <button
              onClick={() => setActiveTab('preview')}
              className={`px-4 py-2.5 rounded-t-xl text-xs sm:text-sm font-semibold transition-all flex items-center space-x-2 ${
                activeTab === 'preview'
                  ? 'bg-slate-900 text-indigo-400 border-t-2 border-indigo-500 shadow-md'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <Monitor className="w-4 h-4" />
              <span>本地还原预览</span>
            </button>

            <button
              onClick={() => setActiveTab('assets')}
              className={`px-4 py-2.5 rounded-t-xl text-xs sm:text-sm font-semibold transition-all flex items-center space-x-2 ${
                activeTab === 'assets'
                  ? 'bg-slate-900 text-indigo-400 border-t-2 border-indigo-500 shadow-md'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <FolderArchive className="w-4 h-4" />
              <span>资源与包结构 ({result.assets.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('code')}
              className={`px-4 py-2.5 rounded-t-xl text-xs sm:text-sm font-semibold transition-all flex items-center space-x-2 ${
                activeTab === 'code'
                  ? 'bg-slate-900 text-indigo-400 border-t-2 border-indigo-500 shadow-md'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <CodeIcon className="w-4 h-4" />
              <span>HTML 源码查看</span>
            </button>

            <button
              onClick={() => setActiveTab('stats')}
              className={`px-4 py-2.5 rounded-t-xl text-xs sm:text-sm font-semibold transition-all flex items-center space-x-2 ${
                activeTab === 'stats'
                  ? 'bg-slate-900 text-indigo-400 border-t-2 border-indigo-500 shadow-md'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>分析报告</span>
            </button>
          </div>

          <div className="pb-2 text-xs text-slate-400 hidden sm:block">
            双击离线包中的 <code className="bg-slate-950 text-indigo-300 px-1.5 py-0.5 rounded border border-slate-700">index.html</code> 即可在本地运行
          </div>
        </div>

        {/* TAB 1: Live Preview */}
        {activeTab === 'preview' && (
          <div className="p-4 sm:p-6 bg-slate-950">
            {/* Viewport controls bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4 bg-slate-900 p-2.5 rounded-xl border border-slate-800">
              <div className="flex items-center space-x-1">
                <span className="text-xs text-slate-400 mr-2 font-medium">设备模拟:</span>
                <button
                  onClick={() => setDevice('desktop')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center space-x-1 transition-colors ${
                    device === 'desktop' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Monitor className="w-3.5 h-3.5" />
                  <span>桌面 100%</span>
                </button>
                <button
                  onClick={() => setDevice('tablet')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center space-x-1 transition-colors ${
                    device === 'tablet' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Tablet className="w-3.5 h-3.5" />
                  <span>平板 768px</span>
                </button>
                <button
                  onClick={() => setDevice('mobile')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center space-x-1 transition-colors ${
                    device === 'mobile' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Smartphone className="w-3.5 h-3.5" />
                  <span>手机 375px</span>
                </button>
              </div>

              <div className="flex items-center space-x-2">
                <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-700">
                  <button
                    onClick={() => setPreviewMode('processed')}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-all flex items-center space-x-1.5 ${
                      previewMode === 'processed'
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                    title="从已生成的离线 ZIP 归档包中实时装载本地样式与图片资源"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>本地离线真实渲染</span>
                  </button>
                  <button
                    onClick={() => setPreviewMode('standalone')}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                      previewMode === 'standalone'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                    title="使用原站在线网络回退渲染（对照原始线上网站）"
                  >
                    <span>原站在网对比</span>
                  </button>
                </div>

                {availablePages.length > 1 && (
                  <div className="hidden sm:flex items-center space-x-1.5 bg-slate-950 border border-slate-700 px-2.5 py-1 rounded-lg text-xs">
                    <span className="text-slate-400">页面:</span>
                    <select
                      value={currentPath}
                      onChange={(e) => navigateToPage(e.target.value)}
                      className="bg-transparent text-emerald-300 font-medium text-xs focus:outline-none cursor-pointer"
                    >
                      {availablePages.map(p => (
                        <option key={p.path} value={p.path} className="bg-slate-900 text-slate-200">
                          {p.title}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <button
                  onClick={() => setIframeKey((prev) => prev + 1)}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center space-x-1"
                  title="重新加载渲染"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>刷新</span>
                </button>
                <button
                  onClick={handleOpenNewTab}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center space-x-1"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>新标签</span>
                </button>
                <button
                  onClick={() => setIsFullscreen(!isFullscreen)}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center space-x-1"
                >
                  {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Notification Toast for Uncrawled Links */}
            {navToast && (
              <div className="mb-4 bg-amber-950/80 border border-amber-600/50 p-3 rounded-xl text-xs text-amber-200 flex items-start justify-between gap-3 animate-in fade-in">
                <div className="flex items-start space-x-2">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">导航提示：</span>
                    <span>{navToast.message}</span>
                  </div>
                </div>
                <div className="flex items-center space-x-2 shrink-0">
                  {navToast.targetUrl && (
                    <a
                      href={navToast.targetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded font-medium flex items-center space-x-1"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>打开原站链接</span>
                    </a>
                  )}
                  <button
                    onClick={() => setNavToast(null)}
                    className="p-1 text-amber-400 hover:text-amber-100 rounded"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* Iframe Viewport Container */}
            <div className={`mx-auto transition-all duration-300 ${getDeviceWidth()}`}>
              <div className="bg-slate-900 rounded-2xl border border-slate-800 shadow-2xl overflow-hidden">
                {/* Browser Address Bar with Back/Forward/Home */}
                <div className="bg-slate-800/90 px-3 py-2 border-b border-slate-700/60 flex items-center space-x-2">
                  <div className="flex space-x-1.5 mr-1">
                    <div className="w-3 h-3 rounded-full bg-rose-500/80"></div>
                    <div className="w-3 h-3 rounded-full bg-amber-500/80"></div>
                    <div className="w-3 h-3 rounded-full bg-emerald-500/80"></div>
                  </div>

                  {/* Browser Nav Buttons */}
                  <div className="flex items-center space-x-1 bg-slate-950/60 p-0.5 rounded-md border border-slate-700/40">
                    <button
                      onClick={handleNavBack}
                      disabled={historyIndex <= 0}
                      className={`p-1 rounded text-slate-400 ${historyIndex > 0 ? 'hover:bg-slate-800 hover:text-slate-100' : 'opacity-30 cursor-not-allowed'}`}
                      title="后退"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={handleNavForward}
                      disabled={historyIndex >= navHistory.length - 1}
                      className={`p-1 rounded text-slate-400 ${historyIndex < navHistory.length - 1 ? 'hover:bg-slate-800 hover:text-slate-100' : 'opacity-30 cursor-not-allowed'}`}
                      title="前进"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={handleNavHome}
                      className="p-1 rounded text-slate-400 hover:bg-slate-800 hover:text-emerald-400"
                      title="返回主页"
                    >
                      <Home className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Address Path Display */}
                  <div className="flex-1 bg-slate-950/80 text-left py-1 px-3 rounded-md text-[11px] font-mono text-slate-300 truncate flex items-center justify-between">
                    <span className="truncate">
                      {previewMode === 'standalone'
                        ? result.finalUrl
                        : `file:///local_mirror/${result.title.replace(/\s+/g, '_') || 'website'}/${currentPath}`}
                    </span>
                    {availablePages.length > 1 && (
                      <span className="ml-2 text-[10px] px-1.5 py-0.5 bg-emerald-950/80 border border-emerald-700/50 text-emerald-300 rounded font-sans">
                        共 {availablePages.length} 页
                      </span>
                    )}
                  </div>

                  {isPreparingOffline && (
                    <div className="flex items-center space-x-1 text-[11px] text-amber-400">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span>切换中...</span>
                    </div>
                  )}
                </div>

                <div className="relative bg-white min-h-[600px] h-[70vh]">
                  {isPreparingOffline ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 text-slate-300 space-y-3 z-10">
                      <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
                      <p className="text-sm font-medium">正在装载页面资源...</p>
                    </div>
                  ) : null}
                  <iframe
                    key={`${iframeKey}-${previewMode}-${currentPath}-${offlineHtmlWithBlobs ? 'loaded' : 'initial'}`}
                    title="Webpage Offline Preview"
                    srcDoc={
                      previewMode === 'processed'
                        ? (offlineHtmlWithBlobs || result.processedHtml)
                        : (result.standaloneHtml || result.processedHtml)
                    }
                    className="w-full h-full border-none"
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-top-navigation-by-user-activation"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: Asset Bundle Explorer */}
        {activeTab === 'assets' && (
          <div className="p-4 sm:p-6 bg-slate-950 text-slate-300 space-y-6">
            <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h4 className="font-bold text-slate-100 text-sm">打包文件树与目录划分</h4>
                <p className="text-xs text-slate-400 mt-1">
                  离线包已结构化整理：包含根目录 <code className="text-indigo-300">index.html</code>、<code className="text-indigo-300">css/</code>、<code className="text-indigo-300">js/</code> 及 <code className="text-indigo-300">images/</code>
                </p>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={handleDownloadZip}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center space-x-1.5 shadow-md"
                >
                  <Download className="w-4 h-4" />
                  <span>下载完整 ZIP 包</span>
                </button>
              </div>
            </div>

            {/* Folder Visualizer */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Directory Tree */}
              <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 font-mono text-xs space-y-2">
                <div className="text-slate-400 font-bold border-b border-slate-800 pb-2 mb-3 flex items-center space-x-2">
                  <Folder className="w-4 h-4 text-amber-400" />
                  <span>离线项目根目录</span>
                </div>

                {/* Index.html */}
                <div
                  onClick={() => setSelectedAsset(null)}
                  className="flex items-center space-x-2 p-2 rounded-lg hover:bg-slate-800 cursor-pointer text-indigo-300 font-semibold bg-slate-800/40"
                >
                  <FileText className="w-4 h-4 text-indigo-400" />
                  <span>index.html (主页)</span>
                  <span className="text-[10px] text-slate-500 ml-auto">{formatSize(result.stats.htmlSize)}</span>
                </div>

                {/* Subpages Folder */}
                {result.subpages && result.subpages.length > 1 && (
                  <div className="pl-3 space-y-1 border-l border-slate-800 ml-2">
                    <div className="text-slate-400 py-1 flex items-center space-x-1.5 font-bold text-indigo-300">
                      <Folder className="w-3.5 h-3.5 text-indigo-400" />
                      <span>pages/ ({result.subpages.length - 1} 个关联内页)</span>
                    </div>
                    {result.subpages
                      .filter((p) => p.localPath !== 'index.html')
                      .map((sub, idx) => (
                        <div
                          key={idx}
                          className="pl-4 py-1 rounded flex items-center justify-between text-slate-300 hover:bg-slate-800 cursor-default"
                          title={sub.url}
                        >
                          <span className="truncate pr-2 text-[11px]">{sub.localPath.replace('pages/', '')}</span>
                          <span className="text-[10px] text-slate-500 shrink-0">{formatSize(sub.size)}</span>
                        </div>
                      ))}
                  </div>
                )}

                {/* CSS Folder */}
                <div className="pl-3 space-y-1 border-l border-slate-800 ml-2">
                  <div className="text-slate-400 py-1 flex items-center space-x-1.5">
                    <Folder className="w-3.5 h-3.5 text-blue-400" />
                    <span>css/ ({result.assets.filter((a) => a.type === 'css').length})</span>
                  </div>
                  {result.assets
                    .filter((a) => a.type === 'css')
                    .map((item, idx) => (
                      <div
                        key={idx}
                        onClick={() => setSelectedAsset(item)}
                        className={`pl-4 py-1 rounded flex items-center justify-between hover:bg-slate-800 cursor-pointer ${
                          selectedAsset?.path === item.path ? 'bg-slate-800 text-indigo-300' : 'text-slate-400'
                        }`}
                      >
                        <span className="truncate pr-2">{item.path.replace('./', '')}</span>
                        <span className="text-[10px] text-slate-500 shrink-0">{formatSize(item.size)}</span>
                      </div>
                    ))}
                </div>

                {/* JS Folder */}
                <div className="pl-3 space-y-1 border-l border-slate-800 ml-2">
                  <div className="text-slate-400 py-1 flex items-center space-x-1.5">
                    <Folder className="w-3.5 h-3.5 text-amber-400" />
                    <span>js/ ({result.assets.filter((a) => a.type === 'js').length})</span>
                  </div>
                  {result.assets
                    .filter((a) => a.type === 'js')
                    .map((item, idx) => (
                      <div
                        key={idx}
                        onClick={() => setSelectedAsset(item)}
                        className={`pl-4 py-1 rounded flex items-center justify-between hover:bg-slate-800 cursor-pointer ${
                          selectedAsset?.path === item.path ? 'bg-slate-800 text-indigo-300' : 'text-slate-400'
                        }`}
                      >
                        <span className="truncate pr-2">{item.path.replace('./', '')}</span>
                        <span className="text-[10px] text-slate-500 shrink-0">{formatSize(item.size)}</span>
                      </div>
                    ))}
                </div>

                {/* Images Folder */}
                <div className="pl-3 space-y-1 border-l border-slate-800 ml-2">
                  <div className="text-slate-400 py-1 flex items-center space-x-1.5">
                    <Folder className="w-3.5 h-3.5 text-emerald-400" />
                    <span>images/ ({result.assets.filter((a) => a.type === 'image').length})</span>
                  </div>
                  {result.assets
                    .filter((a) => a.type === 'image')
                    .map((item, idx) => (
                      <div
                        key={idx}
                        onClick={() => setSelectedAsset(item)}
                        className={`pl-4 py-1 rounded flex items-center justify-between hover:bg-slate-800 cursor-pointer ${
                          selectedAsset?.path === item.path ? 'bg-slate-800 text-indigo-300' : 'text-slate-400'
                        }`}
                      >
                        <span className="truncate pr-2">{item.path.replace('./', '')}</span>
                        <span className="text-[10px] text-slate-500 shrink-0">{formatSize(item.size)}</span>
                      </div>
                    ))}
                </div>
              </div>

              {/* Assets Detailed Table */}
              <div className="md:col-span-2 bg-slate-900 rounded-xl border border-slate-800 p-4">
                <div className="text-slate-200 font-bold text-sm mb-3 flex items-center justify-between">
                  <span>静态资源明细清单</span>
                  <span className="text-xs font-normal text-slate-400">点击左侧目录项查看详情</span>
                </div>

                {selectedAsset ? (
                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3 font-mono text-xs">
                    <div className="flex items-center justify-between text-indigo-300 font-bold border-b border-slate-800 pb-2">
                      <span className="flex items-center space-x-1.5">
                        {selectedAsset.type === 'image' ? <ImageIcon className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                        <span>{selectedAsset.path}</span>
                      </span>
                      <span className="text-slate-400 text-[11px]">{selectedAsset.mimeType || '未知格式'}</span>
                    </div>

                    <div className="space-y-1 text-slate-400">
                      <div><span className="text-slate-500">原始 URL:</span> <a href={selectedAsset.originalUrl} target="_blank" rel="noreferrer" className="text-indigo-400 underline break-all">{selectedAsset.originalUrl}</a></div>
                      <div><span className="text-slate-500">大小:</span> {formatSize(selectedAsset.size)}</div>
                      <div><span className="text-slate-500">状态:</span> <span className="text-emerald-400">{selectedAsset.status}</span></div>
                    </div>

                    {selectedAsset.type === 'image' && (
                      <div className="pt-2 border-t border-slate-800">
                        <span className="text-slate-500 block mb-2">图片预览:</span>
                        <div className="p-3 bg-slate-900 rounded-lg border border-slate-800 flex justify-center max-h-48">
                          <img
                            src={selectedAsset.originalUrl}
                            alt="Asset preview"
                            className="max-h-40 object-contain rounded"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = 'https://via.placeholder.com/150?text=Preview+Error';
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs font-mono">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400">
                          <th className="py-2 px-3">相对路径</th>
                          <th className="py-2 px-3">类型</th>
                          <th className="py-2 px-3">文件大小</th>
                          <th className="py-2 px-3">状态</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {result.assets.slice(0, 15).map((item, idx) => (
                          <tr key={idx} className="hover:bg-slate-800/50">
                            <td className="py-2 px-3 text-indigo-300 max-w-[200px] truncate">{item.path}</td>
                            <td className="py-2 px-3 uppercase text-slate-400 text-[10px]">{item.type}</td>
                            <td className="py-2 px-3 text-slate-300">{formatSize(item.size)}</td>
                            <td className="py-2 px-3">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] ${item.status === 'success' ? 'bg-emerald-950 text-emerald-400' : 'bg-rose-950 text-rose-400'}`}>
                                {item.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {result.assets.length > 15 && (
                      <div className="text-center py-2 text-[11px] text-slate-500 border-t border-slate-800">
                        显示前 15 项，共打包 {result.assets.length} 个资源文件
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: Source Code Inspector */}
        {activeTab === 'code' && (
          <div className="p-4 sm:p-6 bg-slate-950 text-slate-200">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <div className="flex space-x-2 text-xs">
                <button
                  onClick={() => setCodeType('processed')}
                  className={`px-3 py-1.5 rounded-lg border font-medium ${
                    codeType === 'processed' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  重写后相对路径源码 (ZIP 解压用)
                </button>
                <button
                  onClick={() => setCodeType('standalone')}
                  className={`px-3 py-1.5 rounded-lg border font-medium ${
                    codeType === 'standalone' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  基址补全源码 (Base 地址修复版)
                </button>
              </div>

              <button
                onClick={handleCopyCode}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 text-xs font-semibold flex items-center space-x-1.5 border border-slate-700 shadow-sm"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                <span>{copied ? '源码已复制!' : '复制代码'}</span>
              </button>
            </div>

            <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 font-mono text-xs max-h-[60vh] overflow-auto scrollbar-thin scrollbar-thumb-slate-800 text-slate-300 leading-relaxed whitespace-pre">
              {codeType === 'standalone' ? result.standaloneHtml : result.processedHtml}
            </div>
          </div>
        )}

        {/* TAB 4: Analysis & Metrics */}
        {activeTab === 'stats' && (
          <div className="p-4 sm:p-6 bg-slate-950 text-slate-300 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-1">
                <span className="text-xs text-slate-400">网页响应时间</span>
                <div className="text-2xl font-extrabold text-indigo-400 font-mono">{result.stats.loadTimeMs} ms</div>
                <p className="text-[11px] text-slate-500">主页面 HTTP 请求传输与抓取耗时</p>
              </div>

              <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-1">
                <span className="text-xs text-slate-400">总包资源体积</span>
                <div className="text-2xl font-extrabold text-emerald-400 font-mono">
                  {formatSize(result.stats.htmlSize + result.stats.totalAssetsSize)}
                </div>
                <p className="text-[11px] text-slate-500">HTML + 提取的外链 CSS/JS/图片总和</p>
              </div>

              <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-1">
                <span className="text-xs text-slate-400">样式与脚本占比</span>
                <div className="text-2xl font-extrabold text-amber-400 font-mono">
                  {result.stats.cssCount} CSS / {result.stats.jsCount} JS
                </div>
                <p className="text-[11px] text-slate-500">自动离线化整合的样式与动效脚本</p>
              </div>

              <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-1">
                <span className="text-xs text-slate-400">图片资源统计</span>
                <div className="text-2xl font-extrabold text-cyan-400 font-mono">{result.stats.imageCount} 张</div>
                <p className="text-[11px] text-slate-500">下载并存入 images/ 目录的图像文件</p>
              </div>
            </div>

            {/* Subpages List */}
            {result.subpages && result.subpages.length > 0 && (
              <div className="bg-slate-900 p-4 rounded-xl border border-slate-800">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-bold text-slate-100 text-sm flex items-center space-x-2">
                    <FileText className="w-4 h-4 text-indigo-400" />
                    <span>已抓取的多层级网页与内页列表 ({result.subpages.length} 页)</span>
                  </h4>
                  <span className="text-xs text-slate-400">所有内页已完成相对路径与超链接离线绑定</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="py-2 px-3">层级</th>
                        <th className="py-2 px-3">页面标题</th>
                        <th className="py-2 px-3">本地存储路径</th>
                        <th className="py-2 px-3">文件大小</th>
                        <th className="py-2 px-3">原始网址</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {result.subpages.map((sub, idx) => (
                        <tr key={idx} className="hover:bg-slate-800/50">
                          <td className="py-2 px-3">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] ${sub.depth === 1 ? 'bg-indigo-950 text-indigo-300 border border-indigo-800' : 'bg-slate-800 text-slate-300'}`}>
                              {sub.depth} 层
                            </span>
                          </td>
                          <td className="py-2 px-3 text-slate-200 font-sans font-medium">{sub.title}</td>
                          <td className="py-2 px-3 text-emerald-400">{sub.localPath}</td>
                          <td className="py-2 px-3 text-slate-400">{formatSize(sub.size)}</td>
                          <td className="py-2 px-3 text-indigo-400 truncate max-w-[250px]">
                            <a href={sub.url} target="_blank" rel="noreferrer" className="hover:underline">
                              {sub.url}
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Headers inspection */}
            {result.responseHeaders && (
              <div className="bg-slate-900 p-4 rounded-xl border border-slate-800">
                <h4 className="font-bold text-slate-100 text-sm mb-3">HTTP Response Headers 响应头参数</h4>
                <div className="font-mono text-xs max-h-48 overflow-y-auto space-y-1.5 bg-slate-950 p-3 rounded-lg border border-slate-800">
                  {Object.entries(result.responseHeaders).map(([k, v]) => (
                    <div key={k} className="flex flex-col sm:flex-row sm:items-center">
                      <span className="text-slate-500 sm:w-48 shrink-0">{k}:</span>
                      <span className="text-indigo-300 break-all">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
