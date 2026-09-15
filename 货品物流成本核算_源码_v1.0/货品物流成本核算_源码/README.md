# 货品物流成本核算

这是网站的完整源码，可部署到 Vercel。

## 文件说明

- `index.html`：网站页面、计算规则、PDF/Excel 导入和三语界面
- `api/product.js`：联网读取单个商品页面信息的 Vercel 接口
- `api/similar.js`：按商品名/网址搜索楽天市场同类热销商品并对比参数的 Vercel 接口
- `api/_lib/scrape.js`：两个接口共用的网页抓取/解析逻辑
- `api/fx.js`：转发 Wise 实时汇率数据的 Vercel 接口（浏览器直接调用 Wise 会被 CORS 拦截，所以走这个接口中转，不需要任何密钥）

## 部署到 Vercel

1. 将整个文件夹上传到 GitHub 仓库，或在 Vercel 选择直接导入项目。
2. Framework Preset 选择 `Other`。
3. Root Directory 保持项目根目录。
4. Build Command 和 Output Directory 均留空。
5. 在 Vercel 项目的 Settings → Environment Variables 中添加两个变量（都能在 [webservice.rakuten.co.jp](https://webservice.rakuten.co.jp/) 申请应用后的详情页里找到，用于「联网查询」页的同类商品搜索功能，缺任意一个都会报错，其余功能不受影响）：
   - `RAKUTEN_APP_ID`：应用详情页的 Application ID
   - `RAKUTEN_ACCESS_KEY`：应用详情页的 Access Key（点开眼睛图标查看）
6. 点击 Deploy。

### 关于楽天新版 Access Key（Web Application 类型）

如果注册应用时 Application Type 选的是 **Web Application**（Access Key 以 `pk_` 开头），楽天新网关要求请求必须带上与注册时「Allowed websites」一致的 `Origin` / `Referer` 请求头，否则会报 `REQUEST_CONTEXT_BODY_HTTP_REFERRER_MISSING`。`api/similar.js` 里已经写死了这两个头（`ALLOWED_WEBSITE` 常量），如果你的 Vercel 域名变了，记得同步改这个常量，并且去楽天应用详情页把「Allowed websites」也改成新域名。

## 本地预览

直接双击 `index.html` 可以查看基础页面。联网商品读取接口需要部署到 Vercel 后才能使用。

## 说明

报价和税费计算仅用于成本估算，最终金额请以承运商、报关行和税务单据为准。
