const {readProduct, weightKgFrom, volumeFromText} = require('./_lib/scrape');

const RAKUTEN_SEARCH_ENDPOINT = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701';
const ALLOWED_WEBSITE = 'https://jp-shanghai-landed-cost-wens-en.vercel.app/';

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=86400');
  try {
    const appId = process.env.RAKUTEN_APP_ID;
    const accessKey = process.env.RAKUTEN_ACCESS_KEY;
    if (!appId) throw new Error('服务未配置 RAKUTEN_APP_ID');
    if (!accessKey) throw new Error('服务未配置 RAKUTEN_ACCESS_KEY');

    let keyword = String(req.query.name || '').trim();
    const sourceUrl = String(req.query.url || '').trim();
    if (!keyword && sourceUrl) {
      const source = await readProduct(sourceUrl);
      keyword = source.name;
    }
    if (!keyword) throw new Error('请输入商品名称或粘贴商品链接');

    const params = new URLSearchParams({
      applicationId: appId,
      accessKey,
      keyword,
      hits: '10',
      sort: '-reviewCount',
      imageFlag: '1',
      formatVersion: '2'
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    let response;
    try {
      response = await fetch(`${RAKUTEN_SEARCH_ENDPOINT}?${params.toString()}`, {
        signal: controller.signal,
        headers: {origin: new URL(ALLOWED_WEBSITE).origin, referer: ALLOWED_WEBSITE}
      });
    } finally {
      clearTimeout(timer);
    }
    const data = await response.json().catch(() => null);
    const errorDetail = data && (data.error_description || data.error || data.errors?.errorMessage);
    if (!response.ok || !data || errorDetail) {
      throw new Error(`楽天接口返回 ${response.status}${errorDetail ? `：${errorDetail}` : ''}`);
    }

    const items = (data.Items || data.items || [])
      .map(it => it.Item || it.item || it)
      .map(it => {
        const text = `${it.itemName || ''} ${it.catchcopy || ''} ${it.itemCaption || ''}`;
        return {
          name: it.itemName || '',
          shop: it.shopName || '',
          priceJpy: Number(it.itemPrice) || 0,
          url: it.itemUrl || '',
          image: it.mediumImageUrls?.[0]?.imageUrl || '',
          reviewCount: Number(it.reviewCount) || 0,
          reviewAverage: Number(it.reviewAverage) || 0,
          weightKg: weightKgFrom(text) || '',
          volumeM3: volumeFromText(text) || ''
        };
      })
      .filter(x => x.name && x.url);

    if (!items.length) throw new Error('未找到同类商品，请更换关键词');
    res.status(200).json({keyword, items});
  } catch (error) {
    res.status(422).json({error: error?.message || '查询失败'});
  }
};
