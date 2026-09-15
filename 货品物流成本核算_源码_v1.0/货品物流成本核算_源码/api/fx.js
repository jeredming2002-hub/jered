module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
  try {
    const from = String(req.query.from || 'JPY').toUpperCase();
    const to = String(req.query.to || 'CNY').toUpperCase();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let response;
    try {
      response = await fetch(
        `https://wise.com/rates/history+live?source=${from}&target=${to}&length=1&resolution=hourly&unit=day`,
        {signal: controller.signal}
      );
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new Error(`汇率接口返回 ${response.status}`);
    const data = await response.json();
    const last = Array.isArray(data) ? data[data.length - 1] : null;
    if (!last || !last.value) throw new Error('未获取到汇率数据');
    res.status(200).json({from, to, rate: last.value, time: last.time, source: 'wise'});
  } catch (error) {
    res.status(422).json({error: error?.message || '汇率读取失败'});
  }
};
