const https = require('https');
const http = require('http');

// ============================================
// CẤU HÌNH AFFILIATE ID
// ============================================
const DEFAULT_AFFILIATE_ID = process.env.AFFILIATE_ID || '17359570151';
// ============================================

/**
 * Resolve short URL (shope.ee, bit.ly, ...) bằng cách theo redirect
 * Giới hạn tối đa 10 bước redirect để tránh vòng lặp
 */
async function resolveUrl(url, maxRedirects = 10) {
  if (maxRedirects <= 0) throw new Error('Quá nhiều redirect');

  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(url);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;

      const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'vi-VN,vi;q=0.9',
        },
        timeout: 10000,
      };

      const req = protocol.request(options, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          // Xử lý relative redirect
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
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Trích xuất shopid và itemid từ URL Shopee
 * Hỗ trợ các dạng:
 * - shopee.vn/ten-san-pham-i.SHOPID.ITEMID
 * - shopee.vn/product/SHOPID/ITEMID
 */
function extractShopeeIds(url) {
  // Dạng: i.SHOPID.ITEMID
  const match1 = url.match(/i\.(\d+)\.(\d+)/);
  if (match1) {
    return { shopid: match1[1], itemid: match1[2] };
  }

  // Dạng: /product/SHOPID/ITEMID
  const match2 = url.match(/\/product\/(\d+)\/(\d+)/);
  if (match2) {
    return { shopid: match2[1], itemid: match2[2] };
  }

  return null;
}

/**
 * Lấy thông tin sản phẩm từ Shopee public API
 */
async function fetchProductInfo(shopid, itemid) {
  return new Promise((resolve) => {
    const apiPath = `/api/v4/item/get?itemid=${itemid}&shopid=${shopid}`;

    const options = {
      hostname: 'shopee.vn',
      path: apiPath,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://shopee.vn/',
        'X-API-SOURCE': 'pc',
        'If-None-Match-': '*',
      },
      timeout: 8000,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json && json.data) {
            const item = json.data;

            // Price: Shopee lưu giá dạng integer, chia 100000 ra VND
            const rawPrice = item.price_min || item.price || 0;
            const price = Math.round(rawPrice / 100000);

            const imageId = item.image || (item.images && item.images[0]);
            const imageUrl = imageId
              ? `https://cf.shopee.vn/file/${imageId}_tn`
              : null;

            const rating = item.item_rating?.rating_star;

            resolve({
              productName: item.name || 'N/A',
              price,
              imageUrl,
              shopName: item.shop_name || 'N/A',
              rating: rating ? parseFloat(rating).toFixed(1) : 'N/A',
              sales: item.sold || 0,
            });
          } else {
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });

    req.end();
  });
}

/**
 * Tạo affiliate link từ product URL
 * Format: clean URL + affiliate tracking params
 */
function buildAffiliateLink(productUrl, affiliateId) {
  try {
    const parsed = new URL(productUrl);
    // Giữ lại path, thêm affiliate params
    const cleanUrl = `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`;
    return `${cleanUrl}?af_source=AN&aff_n=1&aff_unique_id=${affiliateId}&aff_platform=default`;
  } catch {
    // Nếu parse URL lỗi, append thẳng
    const base = productUrl.split('?')[0];
    return `${base}?af_source=AN&aff_n=1&aff_unique_id=${affiliateId}&aff_platform=default`;
  }
}

// ============================================
// MAIN HANDLER
// ============================================
module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { url } = req.query;
  const affiliateId = req.query.affiliate_id || DEFAULT_AFFILIATE_ID;

  if (!url) {
    return res.status(400).json({ success: false, message: 'Thiếu tham số url' });
  }

  // Validate URL cơ bản
  try {
    new URL(url);
  } catch {
    return res.status(400).json({ success: false, message: 'URL không hợp lệ' });
  }

  try {
    // BƯỚC 1: Resolve link rút gọn
    let resolvedUrl = url;
    const isShortLink =
      url.includes('shope.ee') ||
      url.includes('s.shopee') ||
      !url.includes('shopee.vn/') ||
      url.match(/shopee\.vn\/[^/]{1,10}$/);

    if (isShortLink) {
      resolvedUrl = await resolveUrl(url);
    }

    // BƯỚC 2: Kiểm tra đây có phải link Shopee không
    if (!resolvedUrl.includes('shopee.vn') && !resolvedUrl.includes('shopee.')) {
      return res.json({
        success: false,
        message: 'Link không phải từ Shopee. Vui lòng kiểm tra lại.',
      });
    }

    // BƯỚC 3: Trích xuất IDs
    const ids = extractShopeeIds(resolvedUrl);

    // BƯỚC 4: Tạo affiliate link
    const affiliateLink = buildAffiliateLink(resolvedUrl, affiliateId);

    // BƯỚC 5: Lấy thông tin sản phẩm (song song, không block)
    let productInfo = null;
    if (ids) {
      productInfo = await fetchProductInfo(ids.shopid, ids.itemid);
    }

    return res.json({
      success: true,
      affiliateLinks: [
        {
          affiliate_link: affiliateLink,
          affiliate_id: affiliateId,
        },
      ],
      productInfo,
      resolvedUrl,
    });
  } catch (error) {
    console.error('Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Có lỗi xảy ra khi xử lý link. Vui lòng thử lại.',
    });
  }
};
