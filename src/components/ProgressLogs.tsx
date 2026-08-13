import React from 'react';
import { Terminal, CheckCircle2, AlertTriangle, Info, Loader2 } from 'lucide-react';
import { ProgressLog } from '../types';

interface ProgressLogsProps {
  logs: ProgressLog[];
  isLoading: boolean;
  error?: string | null;
}

export const ProgressLogs: React.FC<ProgressLogsProps> = ({ logs, isLoading, error }) => {
  if (!isLoading && !logs.length && !error) return null;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 my-6">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="bg-slate-800/80 px-4 py-3 border-b border-slate-700/80 flex items-center justify-between">
          <div className="flex items-center space-x-2 text-slate-200 text-sm font-semibold">
            <Terminal className="w-4 h-4 text-indigo-400" />
            <span>实时抓取与打包日志</span>
            {isLoading && (
              <span className="inline-flex items-center text-xs text-indigo-400 font-normal ml-2">
                <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> 处理中...
              </span>
            )}
          </div>
          <span className="text-xs text-slate-400">{logs.length} 条日志记录</span>
        </div>

        <div className="p-4 bg-slate-950 font-mono text-xs max-h-48 overflow-y-auto space-y-1.5 scrollbar-thin scrollbar-thumb-slate-800">
          {logs.map((log, index) => {
            let Icon = Info;
            let textColor = 'text-slate-300';
            if (log.level === 'success') {
              Icon = CheckCircle2;
              textColor = 'text-emerald-400 font-medium';
            } else if (log.level === 'warn') {
              Icon = AlertTriangle;
              textColor = 'text-amber-400';
            } else if (log.level === 'error') {
              Icon = AlertTriangle;
              textColor = 'text-rose-400 font-bold';
            }

            return (
              <div key={index} className="flex items-start space-x-2 animate-fadeIn">
                <span className="text-slate-600 shrink-0">[{log.timestamp}]</span>
                <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${
                  log.level === 'success' ? 'text-emerald-400' : log.level === 'error' ? 'text-rose-400' : 'text-indigo-400'
                }`} />
                <span className={`break-all ${textColor}`}>{log.message}</span>
              </div>
            );
          })}

          {error && (
            <div className="p-3 my-2 rounded-lg bg-rose-950/60 border border-rose-800/80 text-rose-300 text-xs flex items-start space-x-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold block mb-0.5">抓取任务异常中断:</span>
                <span>{error}</span>
                <p className="mt-1 text-[11px] text-rose-400/80">
                  建议排查：目标网址是否可访问、是否含有严格防爬虫机制、或拼写是否正确。
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
