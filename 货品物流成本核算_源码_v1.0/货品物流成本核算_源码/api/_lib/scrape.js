const blockedHost = /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)/i;

function strip(value = '') {
  return String(value).replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;|&#34;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, ' ').trim();
}

function meta(html, key) {
  const safe = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${safe}["'][^>]+content=["']([^"']*)`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${safe}["']`, 'i')
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return strip(match[1]);
  }
  return '';
}

function flattenJsonLd(value, output = []) {
  if (!value || typeof value !== 'object') return output;
  if (Array.isArray(value)) value.forEach(item => flattenJsonLd(item, output));
  else {
    output.push(value);
    if (value['@graph']) flattenJsonLd(value['@graph'], output);
  }
  return output;
}

function decodeHtml(buffer, contentType) {
  let charset = (String(contentType || '').match(/charset=["']?([\w-]+)/i) || [])[1];
  if (!charset) {
    const head = buffer.slice(0, 2048).toString('ascii');
    charset = (head.match(/charset=["']?([\w-]+)/i) || [])[1];
  }
  charset = (charset || 'utf-8').toLowerCase();
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch (_) {
    return buffer.toString('utf-8');
  }
}

function numberFrom(value) {
  const match = String(value ?? '').replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function weightKgFrom(value) {
  const text = String(value ?? '');
  const match = text.match(/([\d,.]+)\s*(kg|キログラム|g|グラム)\b/i);
  if (!match) return 0;
  const amount = numberFrom(match[1]);
  return /^(g|グラム)$/i.test(match[2]) ? amount / 1000 : amount;
}

function volumeFromText(text) {
  const normalized = String(text ?? '').replace(/[×ｘxX*]/g, '×');
  const match = normalized.match(/([\d.]+)\s*×\s*([\d.]+)\s*×\s*([\d.]+)\s*(cm|センチ|mm|ミリ|m\b|メートル)/i);
  if (!match) return 0;
  const factor = /mm|ミリ/i.test(match[4]) ? 1e-9 : /^(m|メートル)/i.test(match[4]) ? 1 : 1e-6;
  return Number((numberFrom(match[1]) * numberFrom(match[2]) * numberFrom(match[3]) * factor).toFixed(6));
}

async function readProduct(rawUrl) {
  const target = new URL(String(rawUrl || ''));
  if (!/^https?:$/.test(target.protocol) || blockedHost.test(target.hostname)) throw new Error('不支持该地址');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  let response;
  try {
    response = await fetch(target, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'accept-language': 'ja,en-US;q=0.8,en;q=0.7',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-dest': 'document',
        'upgrade-insecure-requests': '1'
      }
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`商品页返回 ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const html = decodeHtml(buffer, response.headers.get('content-type')).slice(0, 1500000);
  const nodes = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { flattenJsonLd(JSON.parse(match[1]), nodes); } catch (_) {}
  }
  const product = nodes.find(node => /Product/i.test(String(node['@type']))) || {};
  const offer = Array.isArray(product.offers) ? product.offers[0] : (product.offers || {});
  const name = strip(product.name || meta(html, 'og:title') || meta(html, 'twitter:title') || (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
  const sku = strip(product.sku || product.mpn || product.gtin13 || product.gtin || '');
  const priceJpy = numberFrom(offer.price || meta(html, 'product:price:amount') || meta(html, 'og:price:amount'));
  const visible = strip(html).slice(0, 300000);
  const weightKg = weightKgFrom(product.weight?.value ? `${product.weight.value} ${product.weight.unitCode || product.weight.unitText || ''}` : product.weight) || weightKgFrom(visible);
  const volumeM3 = volumeFromText(product.size || product.depth || product.description || visible);
  if (!name && !priceJpy && !weightKg && !volumeM3) throw new Error('页面没有可识别的商品资料');
  return {name, sku, priceJpy, weightKg: weightKg || '', volumeM3: volumeM3 || '', notice: '已读取可识别信息。不同卖家的包装重量与尺寸可能不同，请核对后导入。'};
}

module.exports = {strip, meta, flattenJsonLd, numberFrom, weightKgFrom, volumeFromText, readProduct};
