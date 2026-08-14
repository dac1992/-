import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { processWebsiteCloning } from './server/cloner.js';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // API Routes
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // POST /api/clone - Core cloning endpoint
  app.post('/api/clone', async (req, res) => {
    try {
      const options = req.body;
      if (!options || !options.url) {
        return res.status(400).json({ error: '请提供有效的目标网址 URL' });
      }

      console.log(`[API] Cloning URL: ${options.url} (Mode: ${options.mode || 'zip'})`);
      const result = await processWebsiteCloning(options);
      return res.json(result);
    } catch (error: any) {
      console.error('[API Error]', error);
      return res.status(500).json({
        error: error.message || '获取或处理目标网站源码失败',
        details: String(error)
      });
    }
  });

  // GET /api/proxy - Proxy for previewing external images or assets without CORS issues
  app.get('/api/proxy', async (req, res) => {
    const targetUrl = req.query.url as string;
    if (!targetUrl) {
      return res.status(400).send('Missing url parameter');
    }

    try {
      const response = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': '*/*',
        }
      });

      if (!response.ok) {
        return res.status(response.status).send(`Failed to fetch ${targetUrl}`);
      }

      const contentType = response.headers.get('content-type');
      if (contentType) {
        res.setHeader('Content-Type', contentType);
      }
      res.setHeader('Access-Control-Allow-Origin', '*');

      const arrayBuffer = await response.arrayBuffer();
      return res.send(Buffer.from(arrayBuffer));
    } catch (err: any) {
      return res.status(500).send(`Proxy error: ${err.message}`);
    }
  });

  // Vite middleware in dev mode
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
