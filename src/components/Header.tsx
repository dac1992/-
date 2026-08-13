import React from 'react';
import { Globe, Download, Zap, Code, ShieldCheck } from 'lucide-react';

interface HeaderProps {
  onOpenHistory?: () => void;
  historyCount?: number;
}

export const Header: React.FC<HeaderProps> = ({ onOpenHistory, historyCount = 0 }) => {
  return (
    <header className="bg-slate-900 border-b border-slate-800 text-white sticky top-0 z-40 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Logo and title */}
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-blue-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Globe className="w-6 h-6 text-white animate-pulse" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="font-bold text-lg text-slate-100 tracking-tight">网页源码获取与离线镜像工具</h1>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                v2.0 Pro
              </span>
            </div>
            <p className="text-xs text-slate-400 hidden sm:block">一键抓取全套 HTML/CSS/JS/图片资源，本地双击无损还原网站效果</p>
          </div>
        </div>

        {/* Feature status badges & action */}
        <div className="flex items-center space-x-3">
          <div className="hidden md:flex items-center space-x-4 text-xs text-slate-300 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700/60">
            <span className="flex items-center text-emerald-400">
              <ShieldCheck className="w-3.5 h-3.5 mr-1" />
              智能补全 URL
            </span>
            <span className="text-slate-600">|</span>
            <span className="flex items-center text-blue-400">
              <Code className="w-3.5 h-3.5 mr-1" />
              自动修复 CSP
            </span>
            <span className="text-slate-600">|</span>
            <span className="flex items-center text-amber-400">
              <Zap className="w-3.5 h-3.5 mr-1" />
              ZIP 离线压缩包
            </span>
          </div>

          {onOpenHistory && (
            <button
              onClick={onOpenHistory}
              className="relative inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors shadow-sm"
            >
              <Download className="w-3.5 h-3.5 text-indigo-400" />
              <span>历史克隆</span>
              {historyCount > 0 && (
                <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-indigo-600 text-white font-bold">
                  {historyCount}
                </span>
              )}
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
