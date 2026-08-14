import * as cheerio from 'cheerio';
import JSZip from 'jszip';
import { CloneOptions, CloneResult, AssetItem, SubpageItem, ProgressLog } from '../src/types.js';

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MOBILE_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1';

// Helper to normalize page URLs while preserving directory slashes
function normalizePageUrl(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    u.hash = ''; // Remove anchor hash
    // Strip common tracking query params
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'];
    trackingParams.forEach(p => u.searchParams.delete(p));
    return u.href;
  } catch {
    return urlStr;
  }
}

// Generate key variations for URL matching
function getUrlVariations(urlStr: string): string[] {
  const vars: string[] = [];
  try {
    const norm = normalizePageUrl(urlStr);
    vars.push(norm);

    const u = new URL(norm);
    
    // Trailing slash variant
    if (u.pathname.endsWith('/')) {
      const noSlash = new URL(norm);
      noSlash.pathname = noSlash.pathname.slice(0, -1);
      vars.push(noSlash.href);
    } else {
      const withSlash = new URL(norm);
      withSlash.pathname = withSlash.pathname + '/';
      vars.push(withSlash.href);
    }

    // Protocol swap variant (http <-> https)
    const altProto = new URL(norm);
    altProto.protocol = altProto.protocol === 'https:' ? 'http:' : 'https:';
    vars.push(altProto.href);

    // Pathname only
    vars.push(u.pathname);
    if (u.pathname.endsWith('/')) {
      vars.push(u.pathname.slice(0, -1));
    }
  } catch {
    vars.push(urlStr);
  }
  return Array.from(new Set(vars));
}

// Extract root domain for cross-subdomain matching (e.g. www.site.com -> site.com, blog.site.com -> site.com)
function getRootDomain(hostname: string): string {
  const parts = hostname.toLowerCase().split('.');
  if (parts.length <= 2) return hostname.toLowerCase();
  // Check for common 2-level ccTLDs like .co.uk, .com.cn
  if (parts.length >= 3 && ['com', 'co', 'edu', 'gov', 'org', 'net'].includes(parts[parts.length - 2])) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

function isSameDomain(urlA: string, urlB: string): boolean {
  try {
    const hostA = new URL(urlA).hostname;
    const hostB = new URL(urlB).hostname;
    if (hostA === hostB) return true;
    return getRootDomain(hostA) === getRootDomain(hostB);
  } catch {
    return false;
  }
}

// Score URLs to prioritize article/detail pages over generic menu/footer noise
function getLinkPriorityScore(urlStr: string): number {
  try {
    const u = new URL(urlStr);
    const path = u.pathname.toLowerCase();
    const search = u.search.toLowerCase();

    // High priority: Article detail pages (.html, /detail/, /article/, /show/, /view/, /p/, ?id=, ?p=)
    if (/\d+\.html$/i.test(path) || /\/\d+$/i.test(path) || path.includes('/detail') || path.includes('/article') || path.includes('/show/') || path.includes('/view/') || path.includes('/content/') || search.includes('id=') || search.includes('p=')) {
      return 100;
    }

    // Medium priority: Categories and lists
    if (path.includes('/list') || path.includes('/cat') || path.includes('/shiti') || path.includes('/honor') || path.includes('/certificate') || path.includes('/news') || path.includes('/column')) {
      return 50;
    }

    // Low priority: Auth, cart, user profile
    if (path.includes('login') || path.includes('register') || path.includes('member') || path.includes('user') || path.includes('cart')) {
      return -50;
    }

    return 10;
  } catch {
    return 0;
  }
}

// Calculate relative path between two local zip file paths
function getRelativePath(fromPath: string, toPath: string): string {
  if (fromPath === toPath) {
    const fileName = toPath.split('/').pop() || 'index.html';
    return './' + fileName;
  }
  const fromParts = fromPath.split('/');
  fromParts.pop(); // Remove filename to get directory
  const toParts = toPath.split('/');

  let i = 0;
  while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) {
    i++;
  }

  const upCount = fromParts.length - i;
  const upStr = upCount > 0 ? '../'.repeat(upCount) : './';
  const downStr = toParts.slice(i).join('/');

  return (upStr + downStr).replace(/^\.\/\.\//, './');
}

// Clean raw CSS url string by stripping HTML entities, outer quotes, and extra whitespace
function cleanCssUrlString(raw: string): string {
  if (!raw) return '';
  let s = raw.trim();
  s = s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  s = s.replace(/^['"]+|['"]+$/g, '').trim();
  return s;
}

// Determine asset type by extension
function getAssetTypeFromUrl(urlStr: string): 'css' | 'image' | 'font' | 'js' | 'other' {
  try {
    const pathname = new URL(urlStr).pathname.toLowerCase();
    if (pathname.endsWith('.css')) return 'css';
    if (pathname.endsWith('.js')) return 'js';
    if (pathname.endsWith('.woff') || pathname.endsWith('.woff2') || pathname.endsWith('.ttf') || pathname.endsWith('.eot') || pathname.endsWith('.otf')) return 'font';
    if (pathname.endsWith('.png') || pathname.endsWith('.jpg') || pathname.endsWith('.jpeg') || pathname.endsWith('.gif') || pathname.endsWith('.svg') || pathname.endsWith('.webp') || pathname.endsWith('.bmp') || pathname.endsWith('.ico') || pathname.endsWith('.avif')) return 'image';
  } catch {}
  return 'image';
}

interface CssUrlReference {
  raw: string;
  cleanUrl: string;
  abs: string;
  type: 'css' | 'image' | 'font' | 'js' | 'other';
}

// Extract all url(...) and @import references from CSS or style attributes
function extractAllFromCss(cssText: string, cssBaseUrl: string): CssUrlReference[] {
  const list: CssUrlReference[] = [];
  const seen = new Set<string>();

  // 1. url(...) pattern
  const urlRegex = /url\s*\(\s*([^\)]+?)\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = urlRegex.exec(cssText)) !== null) {
    const rawInner = match[1];
    const clean = cleanCssUrlString(rawInner);
    if (!clean || clean.startsWith('data:') || clean.startsWith('about:') || clean.startsWith('#') || clean.startsWith('blob:') || clean.startsWith('javascript:')) {
      continue;
    }
    try {
      const abs = new URL(clean, cssBaseUrl).href;
      if (!seen.has(abs)) {
        seen.add(abs);
        list.push({
          raw: rawInner,
          cleanUrl: clean,
          abs,
          type: getAssetTypeFromUrl(abs)
        });
      }
    } catch {}
  }

  // 2. @import "..." and @import '...' pattern (without url())
  const importRegex = /@import\s+(['"])([^'"]+?)\1/gi;
  while ((match = importRegex.exec(cssText)) !== null) {
    const clean = match[2].trim();
    if (!clean || clean.startsWith('data:') || clean.startsWith('about:') || clean.startsWith('#')) continue;
    try {
      const abs = new URL(clean, cssBaseUrl).href;
      if (!seen.has(abs)) {
        seen.add(abs);
        list.push({
          raw: match[0],
          cleanUrl: clean,
          abs,
          type: 'css'
        });
      }
    } catch {}
  }

  return list;
}

// Match asset from downloadedAssetsMap with exact or fuzzy (ignoring query/hash) fallback
function findDownloadedAsset(absUrl: string, map: Map<string, AssetItem>): AssetItem | undefined {
  if (map.has(absUrl)) return map.get(absUrl);
  const cleanUrl = absUrl.split('?')[0].split('#')[0];
  if (map.has(cleanUrl)) return map.get(cleanUrl);
  for (const [key, val] of map.entries()) {
    if (key.split('?')[0].split('#')[0] === cleanUrl) {
      return val;
    }
  }
  return undefined;
}

// Rewrite CSS text using precise regex replacement (NEVER corrupting property names or class selectors)
function rewriteCssText(
  cssText: string,
  cssBaseUrl: string,
  cssLocalPath: string,
  downloadedAssetsMap: Map<string, AssetItem>
): string {
  // A. Replace url(...)
  let rewritten = cssText.replace(/url\s*\(\s*([^\)]+?)\s*\)/gi, (fullMatch, rawInner) => {
    const clean = cleanCssUrlString(rawInner);
    if (!clean || clean.startsWith('data:') || clean.startsWith('about:') || clean.startsWith('#') || clean.startsWith('blob:') || clean.startsWith('javascript:')) {
      return fullMatch;
    }
    try {
      const abs = new URL(clean, cssBaseUrl).href;
      const matchedAsset = findDownloadedAsset(abs, downloadedAssetsMap);
      if (matchedAsset) {
        const relPath = getRelativePath(cssLocalPath, matchedAsset.path);
        return `url("${relPath}")`;
      } else {
        // Fallback: If not downloaded, turn relative to absolute online URL so it won't break with local 404 (file:///C:/...)
        if (!clean.startsWith('http://') && !clean.startsWith('https://') && !clean.startsWith('//')) {
          return `url("${abs}")`;
        }
      }
    } catch {}
    return fullMatch;
  });

  // B. Replace @import "..."
  rewritten = rewritten.replace(/@import\s+(['"])([^'"]+?)\1/gi, (fullMatch, quote, importUrl) => {
    const clean = importUrl.trim();
    try {
      const abs = new URL(clean, cssBaseUrl).href;
      const matchedAsset = findDownloadedAsset(abs, downloadedAssetsMap);
      if (matchedAsset) {
        const relPath = getRelativePath(cssLocalPath, matchedAsset.path);
        return `@import "${relPath}"`;
      } else {
        if (!clean.startsWith('http://') && !clean.startsWith('https://') && !clean.startsWith('//')) {
          return `@import "${abs}"`;
        }
      }
    } catch {}
    return fullMatch;
  });

  return rewritten;
}

// Concurrency helper for high-speed parallel fetching with error isolation
async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  const workerCount = Math.min(concurrency, items.length);
  if (workerCount <= 0) return [];

  const workers = Array.from({ length: workerCount }, async () => {
    while (index < items.length) {
      const i = index++;
      try {
        results[i] = await fn(items[i], i);
      } catch {
        // Individual task errors handled in callback
      }
    }
  });

  await Promise.all(workers);
  return results;
}

export async function processWebsiteCloning(options: CloneOptions): Promise<CloneResult> {
  const startTime = Date.now();
  const logs: ProgressLog[] = [];

  const addLog = (level: 'info' | 'warn' | 'error' | 'success', message: string) => {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    logs.push({ timestamp: time, level, message });
    console.log(`[Cloner ${level.toUpperCase()}] ${message}`);
  };

  addLog('info', `开始深度分析并抓取目标网站: ${options.url}`);

  let targetUrlStr = options.url.trim();
  if (!/^https?:\/\//i.test(targetUrlStr)) {
    targetUrlStr = 'https://' + targetUrlStr;
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(targetUrlStr);
  } catch (err) {
    addLog('error', `无效的网址格式: ${options.url}`);
    throw new Error(`无效的网址格式: ${options.url}`);
  }

  const selectedUserAgent = options.userAgent === 'mobile' ? MOBILE_USER_AGENT : DEFAULT_USER_AGENT;
  const crawlDepth = Math.min(Math.max(options.crawlDepth || 3, 1), 5); // 1 to 5 depth
  const maxPages = Math.min(Math.max(options.maxPages || 20, 1), 100); // 1 to 100 pages

  // Global time deadline safety: default 35 seconds to guarantee response before proxy 60s timeout
  const globalTimeoutMs = Math.min(options.timeoutMs || 35000, 45000);
  const globalDeadline = startTime + globalTimeoutMs;

  addLog('info', `克隆配置: [${options.mode.toUpperCase()}] | 抓取层级: ${crawlDepth}层 | 最大包含页面数: ${maxPages}页`);

  // Queue and Visited Tracking for Priority Multi-page Crawl
  const visitedUrls = new Set<string>();
  interface QueueItem {
    url: string;
    depth: number;
    priority: number;
  }
  const pageQueue: QueueItem[] = [];

  const initialNormalized = normalizePageUrl(targetUrl.href);
  pageQueue.push({ url: initialNormalized, depth: 1, priority: 1000 });
  getUrlVariations(initialNormalized).forEach(v => visitedUrls.add(v));

  interface ProcessedPage {
    url: string;
    finalUrl: string;
    title: string;
    localPath: string;
    $: cheerio.CheerioAPI;
    rawHtml: string;
    depth: number;
    size: number;
  }

  const downloadedPagesMap = new Map<string, ProcessedPage>();
  
  const registerDownloadedPage = (page: ProcessedPage) => {
    const vars = [
      page.url,
      page.finalUrl,
      ...getUrlVariations(page.url),
      ...getUrlVariations(page.finalUrl)
    ];
    for (const v of vars) {
      downloadedPagesMap.set(v, page);
    }
  };

  const findDownloadedPage = (urlStr: string): ProcessedPage | undefined => {
    if (downloadedPagesMap.has(urlStr)) return downloadedPagesMap.get(urlStr);
    const vars = getUrlVariations(urlStr);
    for (const v of vars) {
      if (downloadedPagesMap.has(v)) return downloadedPagesMap.get(v);
    }
    return undefined;
  };

  let homepageTitle = '';
  let homepageDescription = '';
  let homepageFavicon = `${targetUrl.origin}/favicon.ico`;
  let finalHomepageUrl = targetUrl.href;
  let homepageResponseStatus = 200;
  let homepageHeaders: Record<string, string> = {};

  let pageIndexCounter = 1;

  const getSubpageLocalPath = (pageUrlStr: string, isHome: boolean): string => {
    if (isHome) return 'index.html';
    try {
      const u = new URL(pageUrlStr);
      let pathname = u.pathname.replace(/^\/+|\/+$/g, '');
      const searchStr = u.search ? '_' + u.search.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 15) : '';

      if (!pathname) return `pages/page_${pageIndexCounter++}${searchStr}.html`;

      let safeName = pathname.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
      if (safeName.length > 40) safeName = safeName.substring(0, 40);

      if (!safeName.endsWith('.html') && !safeName.endsWith('.htm')) {
        safeName += '.html';
      }
      return `pages/${pageIndexCounter++}_${safeName}`;
    } catch {
      return `pages/page_${pageIndexCounter++}.html`;
    }
  };

  const isEligibleSubpageLink = (absUrl: string, rootUrl: URL): boolean => {
    try {
      if (!isSameDomain(absUrl, rootUrl.href)) return false;
      const u = new URL(absUrl);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;

      const pathname = u.pathname.toLowerCase();
      const ignoredExts = [
        '.css', '.js', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico',
        '.mp4', '.mp3', '.pdf', '.zip', '.rar', '.7z', '.woff', '.woff2', '.ttf', '.eot',
        '.xml', '.json', '.rss', '.apk', '.exe', '.dmg'
      ];
      if (ignoredExts.some(ext => pathname.endsWith(ext))) {
        return false;
      }
      
      const lowerFull = absUrl.toLowerCase();
      if (lowerFull.includes('logout') || lowerFull.includes('signout') || lowerFull.includes('add-to-cart')) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  };

  const uniqueDownloadedPagesSet = new Set<ProcessedPage>();

  // Helper function to fetch single HTML page safely with HTTPS retry
  const fetchSinglePage = async (current: QueueItem, isHome: boolean) => {
    addLog('info', `[网页抓取 ${uniqueDownloadedPagesSet.size + 1}/${maxPages}] (${current.depth}层) 正在分析: ${current.url}`);

    let response: Response | null = null;
    let urlToFetch = current.url;

    // Automatic HTTPS upgrade if target host is HTTPS and sublink is HTTP
    if (targetUrl.protocol === 'https:' && urlToFetch.startsWith('http://')) {
      urlToFetch = urlToFetch.replace('http://', 'https://');
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), isHome ? 12000 : 8000);

      try {
        response = await fetch(urlToFetch, {
          headers: {
            'User-Agent': selectedUserAgent,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Cache-Control': 'no-cache',
          },
          signal: controller.signal,
          redirect: 'follow',
        });
      } catch (firstErr) {
        // Retry with alternative protocol if first attempt failed
        if (urlToFetch.startsWith('http://')) {
          const altUrl = urlToFetch.replace('http://', 'https://');
          const altController = new AbortController();
          const altTimeout = setTimeout(() => altController.abort(), isHome ? 10000 : 6000);
          response = await fetch(altUrl, {
            headers: {
              'User-Agent': selectedUserAgent,
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
              'Cache-Control': 'no-cache',
            },
            signal: altController.signal,
            redirect: 'follow',
          });
          clearTimeout(altTimeout);
        } else if (urlToFetch.startsWith('https://')) {
          const altUrl = urlToFetch.replace('https://', 'http://');
          const altController = new AbortController();
          const altTimeout = setTimeout(() => altController.abort(), isHome ? 10000 : 6000);
          response = await fetch(altUrl, {
            headers: {
              'User-Agent': selectedUserAgent,
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
              'Cache-Control': 'no-cache',
            },
            signal: altController.signal,
            redirect: 'follow',
          });
          clearTimeout(altTimeout);
        } else {
          throw firstErr;
        }
      }
      clearTimeout(timeout);

      if (!response.ok && isHome) {
        addLog('warn', `主页返回 HTTP 状态码 ${response.status}`);
      }

      const finalUrl = response.url || current.url;
      const currentBaseUrl = new URL(finalUrl);

      if (isHome) {
        finalHomepageUrl = finalUrl;
        homepageResponseStatus = response.status;
        response.headers.forEach((v, k) => { homepageHeaders[k] = v; });
      }

      const contentType = response.headers.get('content-type') || '';
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      let encoding = 'utf-8';
      if (contentType.includes('charset=')) {
        encoding = contentType.split('charset=')[1].split(';')[0].trim().toLowerCase();
      } else {
        const initialText = buffer.slice(0, 2000).toString('binary');
        const charsetMatch = initialText.match(/<meta[^>]*charset=["']?([\w-]+)/i);
        if (charsetMatch && charsetMatch[1]) {
          encoding = charsetMatch[1].toLowerCase();
        }
      }

      let rawHtml = '';
      try {
        const decoder = new TextDecoder(encoding.includes('gb') ? 'gbk' : 'utf-8');
        rawHtml = decoder.decode(buffer);
      } catch {
        rawHtml = buffer.toString('utf-8');
      }

      const $ = cheerio.load(rawHtml);

      // Clean security headers
      $('meta[http-equiv="Content-Security-Policy"]').remove();
      $('meta[http-equiv="content-security-policy"]').remove();

      const pageTitle = $('title').first().text().trim() || currentBaseUrl.pathname || currentBaseUrl.hostname;
      if (isHome) {
        homepageTitle = pageTitle;
        homepageDescription = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '';
        const favAttr = $('link[rel*="icon"]').attr('href');
        if (favAttr) {
          try { homepageFavicon = new URL(favAttr, currentBaseUrl.href).href; } catch { /* ignore */ }
        }
      }

      const localPath = getSubpageLocalPath(current.url, isHome);

      const processedPage: ProcessedPage = {
        url: current.url,
        finalUrl,
        title: pageTitle,
        localPath,
        $,
        rawHtml,
        depth: current.depth,
        size: buffer.byteLength,
      };

      uniqueDownloadedPagesSet.add(processedPage);
      registerDownloadedPage(processedPage);

      addLog('success', `成功离线保存页面 [${pageTitle.substring(0, 22)}] -> ${localPath}`);

      // Discover subpage links if depth permits
      if (current.depth < crawlDepth && uniqueDownloadedPagesSet.size + pageQueue.length < maxPages && Date.now() < globalDeadline) {
        let discoveredInThisPage = 0;
        
        // Scan standard a[href], data-href, data-url, area[href], and onclick strings
        const candidateElements = $('a[href], a[data-href], a[data-url], a[data-link], area[href], [onclick]');

        candidateElements.each((_, el) => {
          const $el = $(el);
          let rawUrls: string[] = [];

          const href = $el.attr('href') || $el.attr('data-href') || $el.attr('data-url') || $el.attr('data-link');
          if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
            rawUrls.push(href);
          }

          const onclick = $el.attr('onclick');
          if (onclick) {
            const match = onclick.match(/(?:location\.href|window\.open)\s*=\s*['"]([^'"]+)['"]/i) ||
                          onclick.match(/(?:location\.href|window\.open)\s*\(\s*['"]([^'"]+)['"]/i);
            if (match && match[1]) {
              rawUrls.push(match[1]);
            }
          }

          for (const rawUrl of rawUrls) {
            try {
              const absUrl = new URL(rawUrl, currentBaseUrl.href).href;
              const normUrl = normalizePageUrl(absUrl);
              const variations = getUrlVariations(normUrl);

              if (
                isEligibleSubpageLink(normUrl, targetUrl) &&
                !variations.some(v => visitedUrls.has(v)) &&
                uniqueDownloadedPagesSet.size + pageQueue.length < maxPages
              ) {
                variations.forEach(v => visitedUrls.add(v));
                
                const score = getLinkPriorityScore(normUrl);
                pageQueue.push({ url: normUrl, depth: current.depth + 1, priority: score });
                discoveredInThisPage++;
              }
            } catch {
              // ignore invalid URL
            }
          }
        });

        if (discoveredInThisPage > 0) {
          addLog('info', `在页面 [${pageTitle.substring(0, 15)}] 中识别到 ${discoveredInThisPage} 个下级页面链接`);
        }
      }
    } catch (err: any) {
      addLog('warn', `页面抓取跳过 [${current.url}]: ${err.message || '访问超时'}`);
      if (isHome) {
        throw new Error(`主页面读取失败: ${err.message || '网络连接失败'}`);
      }
    }
  };

  // --- Step 1: Multi-Page Priority HTML Crawling (Parallel Batches) ---
  // A. Fetch Home Page first
  if (pageQueue.length > 0) {
    const homeItem = pageQueue.shift()!;
    await fetchSinglePage(homeItem, true);
  }

  // B. Fetch subpages in concurrent batches of 5
  while (pageQueue.length > 0 && uniqueDownloadedPagesSet.size < maxPages) {
    if (Date.now() >= globalDeadline) {
      addLog('warn', `触发运行时间保护机制，停止抓取剩余 ${pageQueue.length} 个排队页面`);
      break;
    }

    pageQueue.sort((a, b) => b.priority - a.priority || a.depth - b.depth);

    const batchSize = Math.min(5, maxPages - uniqueDownloadedPagesSet.size, pageQueue.length);
    const batch = pageQueue.splice(0, batchSize);

    await runWithConcurrency(batch, 5, async (item) => {
      if (Date.now() < globalDeadline) {
        await fetchSinglePage(item, false);
      }
    });
  }

  addLog('success', `完成多层级网页离线抓取！共捕获 ${uniqueDownloadedPagesSet.size} 个有效 HTML 页面`);

  // --- Step 2: Extract ALL Static Assets (CSS, JS, Images, Lazy-Images, Backgrounds, Fonts) ---
  const baseUrl = new URL(finalHomepageUrl);

  const toAbsoluteUrl = (rel: string | undefined, currentBase: string): string | null => {
    if (!rel || rel.startsWith('data:') || rel.startsWith('javascript:') || rel.startsWith('#') || rel.startsWith('mailto:') || rel.startsWith('tel:')) {
      return null;
    }
    try {
      if (rel.startsWith('//')) {
        return `${baseUrl.protocol}${rel}`;
      }
      return new URL(rel, currentBase).href;
    } catch {
      return null;
    }
  };

  const assetsToDownloadMap = new Map<string, { url: string; type: 'css' | 'js' | 'image' | 'font' | 'other' }>();

  const addAssetToDownload = (url: string | null, type: 'css' | 'js' | 'image' | 'font' | 'other') => {
    if (url && !assetsToDownloadMap.has(url)) {
      assetsToDownloadMap.set(url, { url, type });
    }
  };

  // Inspect DOM across all downloaded pages
  for (const page of uniqueDownloadedPagesSet) {
    const $ = page.$;
    const pageBaseUrl = page.finalUrl;

    // A. CSS Files
    if (options.downloadCss !== false) {
      $('link[rel="stylesheet"]').each((_, el) => {
        addAssetToDownload(toAbsoluteUrl($(el).attr('href'), pageBaseUrl), 'css');
      });
    }

    // B. JS Files
    if (options.downloadJs !== false) {
      $('script[src]').each((_, el) => {
        addAssetToDownload(toAbsoluteUrl($(el).attr('src'), pageBaseUrl), 'js');
      });
    }

    // C. Images & Lazy Images
    if (options.downloadImages !== false) {
      $('img, image').each((_, el) => {
        const $img = $(el);
        const realSrcCandidate = 
          $img.attr('data-src') || 
          $img.attr('data-original') || 
          $img.attr('data-lazy-src') || 
          $img.attr('data-url') || 
          $img.attr('data-actualsrc') || 
          $img.attr('src') ||
          $img.attr('href') ||
          $img.attr('xlink:href');

        const abs = toAbsoluteUrl(realSrcCandidate, pageBaseUrl);
        addAssetToDownload(abs, 'image');

        // Promote lazy src
        const currentSrc = $img.attr('src');
        if (realSrcCandidate && (!currentSrc || currentSrc.startsWith('data:') || currentSrc.includes('placeholder') || currentSrc.includes('blank'))) {
          $img.attr('src', realSrcCandidate);
        }

        // srcset
        const srcset = $img.attr('srcset') || $img.attr('data-srcset');
        if (srcset) {
          srcset.split(',').forEach(item => {
            const parts = item.trim().split(/\s+/);
            if (parts[0]) {
              addAssetToDownload(toAbsoluteUrl(parts[0], pageBaseUrl), 'image');
            }
          });
        }
      });

      // Picture source elements
      $('picture source').each((_, el) => {
        const srcset = $(el).attr('srcset') || $(el).attr('data-srcset');
        if (srcset) {
          srcset.split(',').forEach(item => {
            const parts = item.trim().split(/\s+/);
            if (parts[0]) {
              addAssetToDownload(toAbsoluteUrl(parts[0], pageBaseUrl), 'image');
            }
          });
        }
      });

      // Favicons & Apple Touch Icons
      $('link[rel*="icon"], link[rel*="apple-touch-icon"]').each((_, el) => {
        addAssetToDownload(toAbsoluteUrl($(el).attr('href'), pageBaseUrl), 'image');
      });

      // D. Inline style background images
      $('[style]').each((_, el) => {
        const styleText = $(el).attr('style');
        if (styleText && styleText.toLowerCase().includes('url(')) {
          const bgUrls = extractAllFromCss(styleText, pageBaseUrl);
          bgUrls.forEach(u => addAssetToDownload(u.abs, u.type));
        }
      });

      // E. Embedded <style> tags
      $('style').each((_, el) => {
        const cssContent = $(el).html();
        if (cssContent && (cssContent.toLowerCase().includes('url(') || cssContent.includes('@import'))) {
          const styleUrls = extractAllFromCss(cssContent, pageBaseUrl);
          styleUrls.forEach(u => addAssetToDownload(u.abs, u.type));
        }
      });
    }
  }

  addLog('info', `去重汇总全站所需静态资源: 共计 ${assetsToDownloadMap.size} 个 CSS/JS/图片/字体文件`);

  // --- Step 3: Download Static Assets & Parse CSS Files for Background Images ---
  const downloadedAssetsMap = new Map<string, AssetItem>();
  const assetContentMap = new Map<string, Buffer>();
  const assetItemsList: AssetItem[] = [];
  const zip = new JSZip();

  let cssCount = 0;
  let jsCount = 0;
  let imageCount = 0;
  let fontCount = 0;
  let totalAssetsSize = 0;

  let cssIdx = 1;
  let jsIdx = 1;
  let imgIdx = 1;
  let fontIdx = 1;

  const getLocalAssetPath = (urlStr: string, type: string): string => {
    try {
      const u = new URL(urlStr);
      const pathname = u.pathname;
      const rawExt = (pathname.split('.').pop() || '').toLowerCase();
      const cleanExt = /^[a-z0-9]{2,5}$/.test(rawExt) && !['php', 'jsp', 'asp', 'aspx', 'do', 'action', 'cgi', 'html', 'htm'].includes(rawExt) ? rawExt : '';

      if (type === 'css') return `css/style_${cssIdx++}.${cleanExt || 'css'}`;
      if (type === 'js') return `js/script_${jsIdx++}.${cleanExt || 'js'}`;
      if (type === 'image') {
        let guessedExt = cleanExt;
        if (!guessedExt) {
          const lowerUrl = urlStr.toLowerCase();
          if (lowerUrl.includes('.png')) guessedExt = 'png';
          else if (lowerUrl.includes('.svg')) guessedExt = 'svg';
          else if (lowerUrl.includes('.webp')) guessedExt = 'webp';
          else if (lowerUrl.includes('.gif')) guessedExt = 'gif';
          else if (lowerUrl.includes('.ico')) guessedExt = 'ico';
          else if (lowerUrl.includes('.avif')) guessedExt = 'avif';
          else guessedExt = 'jpg';
        }
        return `images/img_${imgIdx++}.${guessedExt}`;
      }
      if (type === 'font') return `fonts/font_${fontIdx++}.${cleanExt || 'woff2'}`;
      return `assets/asset_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    } catch {
      return `${type}/res_${Date.now()}`;
    }
  };

  if (options.mode === 'zip' || options.mode === 'inlined') {
    const assetsList = Array.from(assetsToDownloadMap.values());
    addLog('info', `正在以 12 线程并发下载 ${assetsList.length} 个静态资源...`);

    // Download initial static assets concurrently
    await runWithConcurrency(assetsList, 12, async (item) => {
      if (Date.now() >= globalDeadline) return;
      const localAssetPath = getLocalAssetPath(item.url, item.type);

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);
        const res = await fetch(item.url, {
          headers: {
            'User-Agent': selectedUserAgent,
            'Referer': baseUrl.href,
            'Accept': item.type === 'image' ? 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8' : '*/*'
          },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (res.ok) {
          const ab = await res.arrayBuffer();
          let buf = Buffer.from(ab);
          const mime = res.headers.get('content-type') || 'application/octet-stream';

          if (item.type === 'css') cssCount++;
          else if (item.type === 'js') jsCount++;
          else if (item.type === 'image') imageCount++;
          else if (item.type === 'font') fontCount++;

          totalAssetsSize += buf.byteLength;

          const assetInfo: AssetItem = {
            path: localAssetPath,
            originalUrl: item.url,
            type: item.type,
            size: buf.byteLength,
            status: 'success',
            mimeType: mime,
          };

          downloadedAssetsMap.set(item.url, assetInfo);
          assetContentMap.set(localAssetPath, buf);
          assetItemsList.push(assetInfo);
        } else {
          assetItemsList.push({
            path: item.url,
            originalUrl: item.url,
            type: item.type,
            size: 0,
            status: 'failed',
            error: `HTTP ${res.status}`,
          });
        }
      } catch (err: any) {
        assetItemsList.push({
          path: item.url,
          originalUrl: item.url,
          type: item.type,
          size: 0,
          status: 'failed',
          error: err.message || '网络读取超时',
        });
      }
    });

    // Multi-pass CSS dependency resolution (supports nested @import and background images up to 3 levels deep)
    let pendingCssAssets = Array.from(downloadedAssetsMap.entries()).filter(
      ([_, assetInfo]) => assetInfo.type === 'css' && assetInfo.status === 'success'
    );

    let cssDepth = 0;
    while (pendingCssAssets.length > 0 && cssDepth < 3 && Date.now() < globalDeadline) {
      cssDepth++;
      const nextRoundAssets: { url: string; type: 'css' | 'image' | 'font' | 'js' | 'other'; origCssUrl: string }[] = [];

      for (const [origUrl, assetInfo] of pendingCssAssets) {
        const cssBuffer = assetContentMap.get(assetInfo.path);
        if (!cssBuffer) continue;

        const cssText = cssBuffer.toString('utf-8');
        const embeddedRefs = extractAllFromCss(cssText, origUrl);

        for (const ref of embeddedRefs) {
          if (!downloadedAssetsMap.has(ref.abs) && !assetsToDownloadMap.has(ref.abs)) {
            nextRoundAssets.push({
              url: ref.abs,
              type: ref.type,
              origCssUrl: origUrl
            });
          }
        }
      }

      if (nextRoundAssets.length === 0) break;

      addLog('info', `第 ${cssDepth} 轮 CSS 深度分析: 发现 ${nextRoundAssets.length} 个嵌套背景图/字体/@import 资源...`);

      const newDownloadedCss: [string, AssetItem][] = [];

      await runWithConcurrency(nextRoundAssets, 10, async (item) => {
        if (Date.now() >= globalDeadline) return;
        const localAssetPath = getLocalAssetPath(item.url, item.type);

        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 6000);
          const res = await fetch(item.url, {
            headers: {
              'User-Agent': selectedUserAgent,
              'Referer': item.origCssUrl || baseUrl.href,
              'Accept': item.type === 'image' ? 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8' : '*/*'
            },
            signal: controller.signal,
          });
          clearTimeout(timeout);

          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            const mime = res.headers.get('content-type') || 'application/octet-stream';

            if (item.type === 'css') cssCount++;
            else if (item.type === 'image') imageCount++;
            else if (item.type === 'font') fontCount++;

            totalAssetsSize += buf.byteLength;

            const assetInfo: AssetItem = {
              path: localAssetPath,
              originalUrl: item.url,
              type: item.type,
              size: buf.byteLength,
              status: 'success',
              mimeType: mime,
            };

            downloadedAssetsMap.set(item.url, assetInfo);
            assetContentMap.set(localAssetPath, buf);
            assetItemsList.push(assetInfo);

            if (item.type === 'css') {
              newDownloadedCss.push([item.url, assetInfo]);
            }
          }
        } catch {
          // Ignore individual background image download failure
        }
      });

      pendingCssAssets = newDownloadedCss;
    }

    // Rewrite ALL CSS files with precise regex URL replacement (never corrupting syntax)
    for (const [origUrl, assetInfo] of Array.from(downloadedAssetsMap.entries())) {
      if (assetInfo.type === 'css' && assetInfo.status === 'success') {
        const cssBuffer = assetContentMap.get(assetInfo.path);
        if (!cssBuffer) continue;

        const cssText = cssBuffer.toString('utf-8');
        const rewrittenCss = rewriteCssText(cssText, origUrl, assetInfo.path, downloadedAssetsMap);
        assetContentMap.set(assetInfo.path, Buffer.from(rewrittenCss, 'utf-8'));
      }
    }

    // Add all asset buffers to zip
    for (const [path, buf] of assetContentMap.entries()) {
      zip.file(path, buf);
    }
  }

  // --- Step 4: DOM Rewriting across ALL Downloaded Pages ---
  for (const page of uniqueDownloadedPagesSet) {
    const $ = page.$;
    const pageLocalPath = page.localPath;
    const pageBaseUrl = page.finalUrl;

    // A. Stylesheets
    $('link[rel="stylesheet"]').each((_, el) => {
      const href = $(el).attr('href');
      const abs = toAbsoluteUrl(href, pageBaseUrl);
      if (abs) {
        const assetObj = findDownloadedAsset(abs, downloadedAssetsMap);
        if (assetObj) {
          $(el).attr('href', getRelativePath(pageLocalPath, assetObj.path));
        } else {
          $(el).attr('href', abs);
        }
      }
    });

    // B. Scripts
    $('script[src]').each((_, el) => {
      const src = $(el).attr('src');
      const abs = toAbsoluteUrl(src, pageBaseUrl);
      if (abs) {
        const assetObj = findDownloadedAsset(abs, downloadedAssetsMap);
        if (assetObj) {
          $(el).attr('src', getRelativePath(pageLocalPath, assetObj.path));
        } else {
          $(el).attr('src', abs);
        }
      }
    });

    // C. Images & Lazy Images
    $('img, image').each((_, el) => {
      const $img = $(el);
      const candidates = [
        $img.attr('src'),
        $img.attr('data-src'),
        $img.attr('data-original'),
        $img.attr('data-lazy-src'),
        $img.attr('data-url'),
        $img.attr('data-actualsrc'),
        $img.attr('href'),
        $img.attr('xlink:href')
      ];

      let matchedLocalPath: string | null = null;
      for (const cand of candidates) {
        const abs = toAbsoluteUrl(cand, pageBaseUrl);
        if (abs) {
          const matched = findDownloadedAsset(abs, downloadedAssetsMap);
          if (matched) {
            matchedLocalPath = matched.path;
            break;
          }
        }
      }

      if (matchedLocalPath) {
        const relPath = getRelativePath(pageLocalPath, matchedLocalPath);
        $img.attr('src', relPath);
        if ($img.attr('href')) $img.attr('href', relPath);
        if ($img.attr('xlink:href')) $img.attr('xlink:href', relPath);
        $img.removeAttr('loading');
        if ($img.attr('data-src')) $img.attr('data-src', relPath);
        if ($img.attr('data-original')) $img.attr('data-original', relPath);
      } else {
        const primaryAbs = toAbsoluteUrl(candidates.find(c => c && !c.startsWith('data:')), pageBaseUrl);
        if (primaryAbs) {
          $img.attr('src', primaryAbs);
        }
      }
    });

    // Picture sources
    $('picture source').each((_, el) => {
      const srcset = $(el).attr('srcset') || $(el).attr('data-srcset');
      if (srcset) {
        const firstUrl = srcset.trim().split(/\s+/)[0];
        const abs = toAbsoluteUrl(firstUrl, pageBaseUrl);
        if (abs) {
          const matched = findDownloadedAsset(abs, downloadedAssetsMap);
          if (matched) {
            const relPath = getRelativePath(pageLocalPath, matched.path);
            $(el).attr('srcset', relPath);
          }
        }
      }
    });

    // Favicons
    $('link[rel*="icon"]').each((_, el) => {
      const href = $(el).attr('href');
      const abs = toAbsoluteUrl(href, pageBaseUrl);
      if (abs) {
        const matched = findDownloadedAsset(abs, downloadedAssetsMap);
        if (matched) {
          $(el).attr('href', getRelativePath(pageLocalPath, matched.path));
        }
      }
    });

    // Inline style background-image
    $('[style]').each((_, el) => {
      const styleText = $(el).attr('style');
      if (styleText && styleText.toLowerCase().includes('url(')) {
        const rewrittenStyle = rewriteCssText(styleText, pageBaseUrl, pageLocalPath, downloadedAssetsMap);
        $(el).attr('style', rewrittenStyle);
      }
    });

    // Embedded <style> tags
    $('style').each((_, el) => {
      const cssText = $(el).html();
      if (cssText && (cssText.toLowerCase().includes('url(') || cssText.includes('@import'))) {
        const rewrittenCss = rewriteCssText(cssText, pageBaseUrl, pageLocalPath, downloadedAssetsMap);
        $(el).html(rewrittenCss);
      }
    });

    // D. Multi-Page Hyperlink Rewriting (<a href="...">, <a data-href="...">, area[href])
    $('a[href], a[data-href], a[data-url], area[href]').each((_, el) => {
      const $a = $(el);
      const rawHref = $a.attr('href') || $a.attr('data-href') || $a.attr('data-url');
      if (!rawHref || rawHref.startsWith('javascript:') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:')) {
        return;
      }

      // If it's a pure in-page hash like href="#section" or href="#", keep it directly
      if (rawHref.startsWith('#')) {
        return;
      }

      try {
        const parsed = new URL(rawHref, pageBaseUrl);
        const currentBaseParsed = new URL(pageBaseUrl);
        const hash = parsed.hash || '';
        const normUrl = normalizePageUrl(parsed.href);

        const targetPageObj = findDownloadedPage(normUrl);

        if (targetPageObj) {
          if (pageLocalPath === targetPageObj.localPath) {
            // Same page anchor or home link
            if (hash) {
              $a.attr('href', hash);
            } else {
              const selfFileName = targetPageObj.localPath.split('/').pop() || 'index.html';
              $a.attr('href', './' + selfFileName);
            }
          } else {
            // Point to downloaded offline subpage!
            const relativePageLink = getRelativePath(pageLocalPath, targetPageObj.localPath);
            $a.attr('href', relativePageLink + hash);
          }
        } else {
          // If on single page mode, check if link was pointing to a hash on current page
          if (parsed.origin === currentBaseParsed.origin && (parsed.pathname === currentBaseParsed.pathname || parsed.pathname === '/' || parsed.pathname === '') && hash) {
            $a.attr('href', hash);
          } else {
            // Link was not downloaded (exceeded maxPages limit or external)
            $a.attr('href', parsed.href);
            $a.attr('target', '_blank');
            $a.attr('rel', 'noopener noreferrer');
          }
        }
      } catch {
        // Keep original
      }
    });
  }

  // --- Step 5: Standalone HTML Fallback ---
  const homepageObj = findDownloadedPage(initialNormalized) || Array.from(uniqueDownloadedPagesSet)[0];
  const processedHomepageHtml = homepageObj.$.html();

  const standalone$ = cheerio.load(homepageObj.rawHtml);
  standalone$('meta[http-equiv="Content-Security-Policy"]').remove();
  if (standalone$('head').length) {
    standalone$('head').prepend(`<base href="${baseUrl.href}">`);
  } else {
    standalone$('html').prepend(`<head><base href="${baseUrl.href}"></head>`);
  }
  const standaloneHtml = standalone$.html();

  // --- Step 6: Package into ZIP ---
  let zipBase64: string | undefined = undefined;
  const subpagesSummaryList: SubpageItem[] = [];

  let totalHtmlSize = 0;

  if (options.mode === 'zip') {
    const pageListArray = Array.from(uniqueDownloadedPagesSet);
    addLog('info', `准备打包 ${pageListArray.length} 个多层级网页...`);

    for (const page of pageListArray) {
      const pageHtmlContent = page.$.html();
      const pageSizeBytes = Buffer.byteLength(pageHtmlContent, 'utf-8');
      totalHtmlSize += pageSizeBytes;

      zip.file(page.localPath, pageHtmlContent);

      subpagesSummaryList.push({
        url: page.url,
        title: page.title,
        localPath: page.localPath,
        size: pageSizeBytes,
        depth: page.depth,
      });
    }

    const subpagesTextList = subpagesSummaryList
      .map(p => ` - [${p.depth}层] ${p.title} (${p.localPath}) -> ${p.url}`)
      .join('\n');

    zip.file(
      'README.txt',
      `网页离线完整多页面镜像包\n====================\n目标主页: ${finalHomepageUrl}\n生成时间: ${new Date().toLocaleString('zh-CN')}\n抓取层级: ${crawlDepth} 层 | 包含页面: ${pageListArray.length} 页\n\n` +
      `已下载页面清单:\n${subpagesTextList}\n\n` +
      `使用说明:\n` +
      `1. 直接解压本压缩包，双击 index.html 即可在本地浏览器中开始离线浏览！\n` +
      `2. 页面内部所有已下载的导航栏、列表页与文章详情页超链接均已完成离线关联跳转。\n` +
      `3. 所有静态资源（包括样式表、图像、CSS背景图、图标字体）均已离线存储并在本地关联绑定。`
    );

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    zipBase64 = zipBuffer.toString('base64');
    addLog('success', `ZIP 离线多页面镜像制作完成！包含 ${pageListArray.length} 个 HTML 页面 + ${downloadedAssetsMap.size} 个离线资源，压缩包大小: ${(zipBuffer.byteLength / 1024).toFixed(1)} KB`);
  } else {
    totalHtmlSize = Buffer.byteLength(processedHomepageHtml, 'utf-8');
  }

  const loadTimeMs = Date.now() - startTime;
  addLog('success', `全流程成功完成，耗时 ${loadTimeMs}ms`);

  return {
    id: `clone_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    url: targetUrlStr,
    finalUrl: finalHomepageUrl,
    title: homepageTitle,
    favicon: homepageFavicon,
    description: homepageDescription,
    timestamp: Date.now(),
    mode: options.mode,
    stats: {
      htmlSize: totalHtmlSize,
      totalAssetsSize,
      assetCount: assetItemsList.length,
      pagesCount: uniqueDownloadedPagesSet.size,
      cssCount,
      jsCount,
      imageCount,
      fontCount,
      loadTimeMs,
      statusCode: homepageResponseStatus,
    },
    processedHtml: processedHomepageHtml,
    standaloneHtml,
    assets: assetItemsList,
    subpages: subpagesSummaryList,
    zipBase64,
    responseHeaders: homepageHeaders,
    logs,
  };
}
