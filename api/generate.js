const https = require('https');
const http = require('http');

// ============================================
// CẤU HÌNH
// ============================================
const DEFAULT_AFFILIATE_ID = process.env.AFFILIATE_ID || '17359570151';
// ============================================

/**
 * BƯỚC 1: Resolve link rút gọn bằng cách follow HTTP redirect
 * s.shopee.vn/8Kkq6gk3R0 → shopee.vn/product/388966325/6779525116?...
 */
async function resolveUrl(url, maxRedirects = 10) {
  if (maxRedirects <= 0) throw new Error('Quá nhiều redirect');

  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(url);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;

      const req = protocol.request(
        {
          hostname: parsedUrl.hostname,
          path: parsedUrl.pathname + parsedUrl.search,
          method: 'HEAD',
          headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
            'Accept-Language': 'vi-VN,vi;q=0.9',
          },
          timeout: 10000,
        },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            let nextUrl = res.headers.location;
            if (!nextUrl.startsWith('http')) {
              nextUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}${nextUrl}`;
            }
            res.resume();
            resolve(resolveUrl(nextUrl, maxRedirects - 1));
          } else {
            res.resume();
            resolve(url);
          }
        }
      );

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * BƯỚC 2: Trích xuất shopid + itemid từ URL Shopee đầy đủ
 *
 * Hỗ trợ:
 * - shopee.vn/product/388966325/6779525116
 * - shopee.vn/ten-san-pham-i.388966325.6779525116
 * - shopee.vn/<slug>/388966325/6779525116
 */
function extractShopeeIds(url) {
  // Format 1: /product/SHOPID/ITEMID
  const m1 = url.match(/\/product\/(\d+)\/(\d+)/);
  if (m1) return { shopid: m1[1], itemid: m1[2] };

  // Format 2: i.SHOPID.ITEMID (trong slug tên sản phẩm)
  const m2 = url.match(/[.-]i\.(\d+)\.(\d+)/);
  if (m2) return { shopid: m2[1], itemid: m2[2] };

  // Format 3: /shopname/SHOPID/ITEMID — 2 dãy số dài cuối path
  const m3 = url.match(/\/(\d{6,})\/(\d{8,})(?:[/?#]|$)/);
  if (m3) return { shopid: m3[1], itemid: m3[2] };

  return null;
}

/**
 * BƯỚC 3: Build affiliate link đúng format Shopee Affiliate
 *
 * Input:  shopid=388966325, itemid=6779525116, affiliateId=17359570151
 * Output: https://s.shopee.vn/an_redir
 *           ?origin_link=https%3A%2F%2Fshopee.vn%2Fproduct%2F388966325%2F6779525116
 *           &share_channel_code=4
 *           &affiliate_id=17359570151
 *           &sub_id=addlivetag----
 */
function buildAffiliateLink(ids, resolvedUrl, affiliateId) {
  let originLink;

  if (ids && ids.shopid && ids.itemid) {
    originLink = `https://shopee.vn/product/${ids.shopid}/${ids.itemid}`;
  } else {
    // Fallback: bỏ query params
    try {
      const p = new URL(resolvedUrl);
      originLink = `${p.protocol}//${p.hostname}${p.pathname}`;
    } catch {
      originLink = resolvedUrl.split('?')[0];
    }
  }

  const encoded = encodeURIComponent(originLink);
  return `https://s.shopee.vn/an_redir?origin_link=${encoded}&share_channel_code=4&affiliate_id=${affiliateId}&sub_id=addlivetag----`;
}

/**
 * BƯỚC 4 (optional): Lấy thông tin sản phẩm từ Shopee public API
 */
async function fetchProductInfo(shopid, itemid) {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'shopee.vn',
        path: `/api/v4/item/get?itemid=${itemid}&shopid=${shopid}`,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://shopee.vn/',
          'X-API-SOURCE': 'pc',
          'If-None-Match-': '*',
        },
        timeout: 8000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json && json.data) {
              const item = json.data;
              const rawPrice = item.price_min || item.price || 0;
              const imageId = item.image || (item.images && item.images[0]);
              resolve({
                productName: item.name || 'N/A',
                price: Math.round(rawPrice / 100000),
                imageUrl: imageId ? `https://cf.shopee.vn/file/${imageId}_tn` : null,
                shopName: item.shop_name || 'N/A',
                rating: item.item_rating && item.item_rating.rating_star
                  ? parseFloat(item.item_rating.rating_star).toFixed(1)
                  : 'N/A',
                sales: item.sold || 0,
              });
            } else {
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// ============================================
// MAIN HANDLER
// ============================================
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url } = req.query;
  const affiliateId = req.query.affiliate_id || DEFAULT_AFFILIATE_ID;

  if (!url) {
    return res.status(400).json({ success: false, message: 'Thiếu tham số url' });
  }

  try { new URL(url); } catch {
    return res.status(400).json({ success: false, message: 'URL không hợp lệ' });
  }

  try {
    // ── Bước 1: Resolve nếu là link rút gọn ──
    const isShort =
      url.includes('shope.ee') ||
      url.includes('s.shopee.vn') ||
      /shopee\.vn\/[A-Za-z0-9]{4,12}$/.test(url);

    const resolvedUrl = isShort ? await resolveUrl(url) : url;

    // ── Kiểm tra link Shopee ──
    if (!resolvedUrl.includes('shopee.vn')) {
      return res.json({
        success: false,
        message: 'Link không phải từ Shopee. Vui lòng kiểm tra lại.',
      });
    }

    // ── Bước 2: Lấy shopid + itemid ──
    const ids = extractShopeeIds(resolvedUrl);

    // ── Bước 3: Tạo affiliate link ──
    const affiliateLink = buildAffiliateLink(ids, resolvedUrl, affiliateId);

    // ── Bước 4: Lấy thông tin sản phẩm ──
    let productInfo = null;
    if (ids) {
      productInfo = await fetchProductInfo(ids.shopid, ids.itemid);
    }

    return res.json({
      success: true,
      affiliateLinks: [{ affiliate_link: affiliateLink, affiliate_id: affiliateId }],
      productInfo,
      _debug: { resolvedUrl, ids }, // bỏ dòng này sau khi test xong
    });
  } catch (error) {
    console.error('[generate] Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Có lỗi xảy ra khi xử lý link. Vui lòng thử lại.',
    });
  }
};
