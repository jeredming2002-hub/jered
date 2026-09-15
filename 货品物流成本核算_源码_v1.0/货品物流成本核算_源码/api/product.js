const {readProduct} = require('./_lib/scrape');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=86400');
  try {
    const result = await readProduct(req.query.url);
    res.status(200).json(result);
  } catch (error) {
    res.status(422).json({error: error?.message || '读取失败'});
  }
};
