import React from 'react';
import { History, Download, Trash2, ArrowUpRight, X, FolderArchive, Clock } from 'lucide-react';
import { SiteHistoryItem } from '../types';

interface HistoryListProps {
  isOpen: boolean;
  onClose: () => void;
  history: SiteHistoryItem[];
  onSelectHistory: (item: SiteHistoryItem) => void;
  onClearHistory: () => void;
  onDeleteHistoryItem: (id: string) => void;
}

export const HistoryList: React.FC<HistoryListProps> = ({
  isOpen,
  onClose,
  history,
  onSelectHistory,
  onClearHistory,
  onDeleteHistoryItem,
}) => {
  if (!isOpen) return null;

  const formatSize = (bytes: number) => {
    if (!bytes) return '0 B';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex justify-end animate-fadeIn">
      <div className="bg-slate-900 border-l border-slate-800 w-full max-w-md h-full flex flex-col shadow-2xl text-white">
        {/* Drawer Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <History className="w-5 h-5 text-indigo-400" />
            <h3 className="font-bold text-slate-100 text-base">历史抓取记录</h3>
            <span className="text-xs bg-slate-800 px-2 py-0.5 rounded text-slate-400 font-mono">
              {history.length}
            </span>
          </div>

          <div className="flex items-center space-x-2">
            {history.length > 0 && (
              <button
                onClick={onClearHistory}
                className="text-xs text-rose-400 hover:text-rose-300 px-2 py-1 rounded bg-rose-950/40 border border-rose-900/60"
              >
                清空记录
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Drawer Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {history.length === 0 ? (
            <div className="text-center py-16 text-slate-500 space-y-2">
              <History className="w-12 h-12 mx-auto text-slate-700 stroke-1" />
              <p className="text-sm">暂无抓取记录</p>
              <p className="text-xs text-slate-600">在上方的输入框粘贴目标网址开始第一次抓取吧</p>
            </div>
          ) : (
            history.map((item) => (
              <div
                key={item.id}
                className="bg-slate-950 p-3.5 rounded-xl border border-slate-800/80 hover:border-indigo-500/50 transition-all space-y-2 group"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="truncate flex-1">
                    <h4 className="font-semibold text-slate-200 text-xs truncate group-hover:text-indigo-300">
                      {item.title || item.url}
                    </h4>
                    <span className="text-[11px] text-slate-500 font-mono block truncate mt-0.5">
                      {item.url}
                    </span>
                  </div>

                  <button
                    onClick={() => onDeleteHistoryItem(item.id)}
                    className="p-1 text-slate-600 hover:text-rose-400 transition-colors"
                    title="删除"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-900">
                  <div className="flex items-center space-x-2">
                    <span className="flex items-center text-slate-500">
                      <Clock className="w-3 h-3 mr-1" />
                      {new Date(item.timestamp).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="px-1.5 py-0.2 rounded bg-indigo-950 text-indigo-300 font-mono text-[10px]">
                      {item.mode.toUpperCase()}
                    </span>
                  </div>

                  <button
                    onClick={() => {
                      onSelectHistory(item);
                      onClose();
                    }}
                    className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-medium flex items-center space-x-1"
                  >
                    <span>载入查看</span>
                    <ArrowUpRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
