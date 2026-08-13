import React from 'react';
import { Download, MonitorCheck, HelpCircle, CheckCircle, ShieldCheck } from 'lucide-react';

export const UsageTips: React.FC = () => {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 my-10">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl text-white">
        <div className="flex items-center space-x-2 text-indigo-400 font-bold text-base mb-4 border-b border-slate-800 pb-3">
          <HelpCircle className="w-5 h-5" />
          <span>本地离线打开与运行指南</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs text-slate-300">
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/80 space-y-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 text-indigo-400 flex items-center justify-center font-bold text-sm">
              1
            </div>
            <h4 className="font-bold text-slate-100 text-sm">下载 ZIP 镜像包并解压</h4>
            <p className="text-slate-400 leading-relaxed">
              输入目标网址后点击「获取目标源码」，等待系统解析并将 CSS/JS/图片打成 Zip 压缩包，点击「下载完整的 ZIP 离线镜像包」存至本地。
            </p>
          </div>

          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/80 space-y-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-600/20 text-emerald-400 flex items-center justify-center font-bold text-sm">
              2
            </div>
            <h4 className="font-bold text-slate-100 text-sm">解压后双击 index.html</h4>
            <p className="text-slate-400 leading-relaxed">
              在电脑上解压压缩包，你可以看到 <code className="text-indigo-300 font-mono">index.html</code> 以及包含样式与图片的目录。双击 <code className="text-indigo-300 font-mono">index.html</code> 即可在 Chrome, Edge, Safari 本地打开！
            </p>
          </div>

          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/80 space-y-2">
            <div className="w-8 h-8 rounded-lg bg-cyan-600/20 text-cyan-400 flex items-center justify-center font-bold text-sm">
              3
            </div>
            <h4 className="font-bold text-slate-100 text-sm">一模一样的还原渲染</h4>
            <p className="text-slate-400 leading-relaxed">
              抓取器已自动将所有的相对路径、网络防盗链 CSP 与内联标签进行了重写适配，哪怕处于无网/离线状态下，本地打开依然呈现一致的效果。
            </p>
          </div>
        </div>

        <div className="mt-5 pt-4 border-t border-slate-800 text-slate-400 text-xs flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-2 text-emerald-400">
            <ShieldCheck className="w-4 h-4" />
            <span>无任何广告弹窗，纯净离线提取</span>
          </div>

          <div className="text-slate-500 text-[11px]">
            * 提示：对于依赖后台 API 数据库交互的复杂网页，本地静态离线包可呈现 100% 一致的 UI 页面与前端样式。
          </div>
        </div>
      </div>
    </div>
  );
};
