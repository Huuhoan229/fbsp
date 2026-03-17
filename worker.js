/**
 * ╔══════════════════════════════════════════╗
 * ║  Shopee Short Link Resolver              ║
 * ║  Cloudflare Worker — worker.js           ║
 * ║                                          ║
 * ║  Nhận: GET /?url=https://s.shopee.vn/xx  ║
 * ║  Trả:  { "resolved": "https://shopee..." }║
 * ╚══════════════════════════════════════════╝
 *
 * Deploy miễn phí tại: https://workers.cloudflare.com
 * Free plan: 100,000 request/ngày
 */

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type':                 'application/json',
};

const ALLOWED_HOSTS = ['s.shopee.vn', 'shopee.vn', 'shope.ee'];

export default {
  async fetch(request) {

    // ── Preflight ──
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const { searchParams } = new URL(request.url);
    const targetUrl = searchParams.get('url');

    if (!targetUrl) {
      return json({ error: 'Missing ?url= parameter' }, 400);
    }

    // ── Validate: chỉ nhận link Shopee ──
    let parsed;
    try { parsed = new URL(targetUrl); } catch {
      return json({ error: 'Invalid URL' }, 400);
    }

    const allowed = ALLOWED_HOSTS.some(h =>
      parsed.hostname === h || parsed.hostname.endsWith('.' + h)
    );
    if (!allowed) {
      return json({ error: 'Only Shopee URLs are allowed' }, 403);
    }

    try {
      // ── Follow redirect (server-side, không bị CORS) ──
      const res = await fetch(targetUrl, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          // Giả lập mobile browser để Shopee không chặn
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'vi-VN,vi;q=0.9',
        },
      });

      let resolved = res.url; // URL sau khi follow hết redirect

      // Nếu vẫn còn ở domain rút gọn → đọc og:url từ HTML
      const stillShort = ALLOWED_HOSTS
        .filter(h => h !== 'shopee.vn')
        .some(h => resolved.includes(h));

      if (stillShort) {
        const html = await res.text();
        const og = html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i)
                || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:url["']/i);
        if (og) resolved = og[1];
      }

      return json({ resolved });

    } catch (err) {
      return json({ error: 'Fetch failed', detail: err.message }, 500);
    }
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}
