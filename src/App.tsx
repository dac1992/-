import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { UrlInputBar } from './components/UrlInputBar';
import { ProgressLogs } from './components/ProgressLogs';
import { ResultWorkbench } from './components/ResultWorkbench';
import { HistoryList } from './components/HistoryList';
import { UsageTips } from './components/UsageTips';
import { CloneOptions, CloneResult, SiteHistoryItem, ProgressLog } from './types';

export default function App() {
  const [isLoading, setIsLoading] = useState(false);
  const [progressLogs, setProgressLogs] = useState<ProgressLog[]>([]);
  const [result, setResult] = useState<CloneResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<SiteHistoryItem[]>([]);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);

  // Load history from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('website_clone_history');
      if (saved) {
        setHistory(JSON.parse(saved));
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

  // Save history to localStorage
  const saveToHistory = (newResult: CloneResult) => {
    const item: SiteHistoryItem = {
      id: newResult.id,
      url: newResult.url,
      title: newResult.title,
      favicon: newResult.favicon,
      timestamp: newResult.timestamp,
      mode: newResult.mode,
      totalSize: newResult.stats.htmlSize + newResult.stats.totalAssetsSize,
      assetCount: newResult.stats.assetCount,
      processedHtml: newResult.processedHtml,
      zipBase64: newResult.zipBase64,
      standaloneHtml: newResult.standaloneHtml,
    };

    const updated = [item, ...history.filter((h) => h.url !== item.url)].slice(0, 20);
    setHistory(updated);
    try {
      localStorage.setItem('website_clone_history', JSON.stringify(updated));
    } catch {
      // Ignore quota errors
    }
  };

  const handleStartClone = async (options: CloneOptions) => {
    setIsLoading(true);
    setError(null);
    setResult(null);

    const initialTime = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    setProgressLogs([
      { timestamp: initialTime, level: 'info', message: `准备连接后端，建立 HTTP 客户端抓取任务...` },
      { timestamp: initialTime, level: 'info', message: `目标网址: ${options.url}` },
    ]);

    try {
      const res = await fetch('/api/clone', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(options),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || errJson.details || `服务端处理失败，HTTP ${res.status}`);
      }

      const data: CloneResult = await res.json();
      setResult(data);
      if (data.logs && data.logs.length) {
        setProgressLogs(data.logs);
      }
      saveToHistory(data);

      // Scroll to result workbench smoothly
      setTimeout(() => {
        const el = document.getElementById('result-section');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth' });
        }
      }, 100);
    } catch (err: any) {
      console.error(err);
      setError(err.message || '抓取网页数据过程发生未知异常');
      setProgressLogs((prev) => [
        ...prev,
        {
          timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
          level: 'error',
          message: err.message || '抓取网页数据过程发生未知异常',
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  // Select history item to load into workbench
  const handleSelectHistory = (historyItem: SiteHistoryItem) => {
    const reconstitutedResult: CloneResult = {
      id: historyItem.id,
      url: historyItem.url,
      finalUrl: historyItem.url,
      title: historyItem.title,
      favicon: historyItem.favicon,
      timestamp: historyItem.timestamp,
      mode: historyItem.mode,
      stats: {
        htmlSize: new TextEncoder().encode(historyItem.processedHtml || '').length,
        totalAssetsSize: historyItem.totalSize,
        assetCount: historyItem.assetCount,
        pagesCount: historyItem.pagesCount || 1,
        cssCount: 0,
        jsCount: 0,
        imageCount: 0,
        fontCount: 0,
        loadTimeMs: 0,
        statusCode: 200,
      },
      processedHtml: historyItem.processedHtml,
      standaloneHtml: historyItem.standaloneHtml || historyItem.processedHtml,
      assets: [],
      zipBase64: historyItem.zipBase64,
      logs: [{ timestamp: 'History', level: 'info', message: '已从本地缓存载入历史记录数据' }],
    };

    setResult(reconstitutedResult);
  };

  const handleClearHistory = () => {
    setHistory([]);
    localStorage.removeItem('website_clone_history');
  };

  const handleDeleteHistoryItem = (id: string) => {
    const updated = history.filter((h) => h.id !== id);
    setHistory(updated);
    localStorage.setItem('website_clone_history', JSON.stringify(updated));
  };

  return (
    <div className="min-h-screen bg-slate-950 font-sans text-slate-100 flex flex-col selection:bg-indigo-600 selection:text-white">
      {/* Header */}
      <Header
        onOpenHistory={() => setHistoryDrawerOpen(true)}
        historyCount={history.length}
      />

      {/* Main Content */}
      <main className="flex-1 pb-16">
        <UrlInputBar onStartClone={handleStartClone} isLoading={isLoading} />

        <ProgressLogs logs={progressLogs} isLoading={isLoading} error={error} />

        {result && (
          <div id="result-section">
            <ResultWorkbench result={result} />
          </div>
        )}

        {!result && !isLoading && <UsageTips />}
      </main>

      {/* History Drawer */}
      <HistoryList
        isOpen={historyDrawerOpen}
        onClose={() => setHistoryDrawerOpen(false)}
        history={history}
        onSelectHistory={handleSelectHistory}
        onClearHistory={handleClearHistory}
        onDeleteHistoryItem={handleDeleteHistoryItem}
      />

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-slate-900 py-6 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>网页源码获取与离线镜像工具 &copy; {new Date().getFullYear()}</span>
          <span>支持完整转换 HTML / CSS / JS / 图片等资源 &bull; 本地无网完美还原视觉效果</span>
        </div>
      </footer>
    </div>
  );
}
