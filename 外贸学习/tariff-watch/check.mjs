// 每日关税检查：对比官方数据源和上次记录，发现变化就输出报告，由 GitHub Actions 开 Issue 等人工确认。
// 只读官方来源，不会改 site/tariffs.json；网站数据要人工确认后再改。
// 用法：node check.mjs            （正常检查）
//       node check.mjs --init     （首次运行，只记录基线，不报告）
import { readFile, writeFile } from "node:fs/promises";

const DIR = new URL(".", import.meta.url);
const STATE = new URL("state.json", DIR);
const REPORT = new URL("report.md", DIR);
const init = process.argv.includes("--init");

const state = JSON.parse(await readFile(STATE, "utf8").catch(() => "{}"));
state.values ??= {};
state.seenDocs ??= [];
const today = new Date().toISOString().slice(0, 10);
const since = state.lastRun ?? new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
const findings = [];
const errors = [];

async function getJSON(url) {
  const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "tariff-watch (study site)" } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

function compare(key, label, value, source) {
  const old = state.values[key];
  if (old !== undefined && old !== value) findings.push(`- **${label}**：${old} → **${value}**（[来源](${source})）`);
  state.values[key] = value;
}

// 1. 英国：第三国关税（地理区域 1011 = ERGA OMNES，适用于中国）
for (const code of ["9401610000", "9401710000"]) {
  const src = `https://www.trade-tariff.service.gov.uk/commodities/${code}`;
  try {
    const j = await getJSON(`https://www.trade-tariff.service.gov.uk/api/v2/commodities/${code}`);
    const inc = j.included ?? [];
    const found = [];
    for (const m of inc.filter((x) => x.type === "measure")) {
      const type = inc.find((x) => x.type === "measure_type" && x.id === m.relationships.measure_type.data.id);
      const desc = type?.attributes.description ?? "";
      const geo = m.relationships.geographical_area.data.id;
      const applies = geo === "1011" || geo === "CN";
      if (applies && /third country duty|anti-dumping|countervailing|additional duty/i.test(desc)) {
        const de = m.relationships.duty_expression && inc.find((x) => x.id === m.relationships.duty_expression.data.id);
        found.push(`${desc}: ${de?.attributes.base ?? "?"}`);
      }
    }
    compare(`uk:${code}`, `英国 ${code} 适用于中国的关税`, found.sort().join(" | ") || "无", src);
  } catch (e) { errors.push(`英国 ${code}：${e.message}`); }
}

// 2. 美国：HTS 基础税率（MFN）
for (const code of ["9401.61.40", "9401.61.60", "9401.71.00"]) {
  const src = `https://hts.usitc.gov/search?query=${code}`;
  try {
    const rows = await getJSON(`https://hts.usitc.gov/reststop/search?keyword=${code}`);
    const row = rows.find((x) => x.htsno === code);
    compare(`us-mfn:${code}`, `美国 HTS ${code} 基础税率`, row?.general ?? "未找到", src);
  } catch (e) { errors.push(`美国 HTS ${code}：${e.message}`); }
}

// 3. 美国：联邦公报（Federal Register）新公告
const TERMS = [
  '"upholstered furniture"',
  '"upholstered wooden"',
  '"9401.61"',
  '"9401.71"',
  '"timber, lumber" 232',
  '"section 301" China tariff',
  '"section 301" "forced labor"',
];
for (const term of TERMS) {
  const q = new URLSearchParams({ "conditions[term]": term, "conditions[publication_date][gte]": since, per_page: "50", order: "newest" });
  for (const f of ["title", "html_url", "publication_date", "document_number", "type", "agencies"]) q.append("fields[]", f);
  try {
    const j = await getJSON(`https://www.federalregister.gov/api/v1/documents.json?${q}`);
    for (const d of j.results ?? []) {
      if (state.seenDocs.includes(d.document_number)) continue;
      state.seenDocs.push(d.document_number);
      const ag = (d.agencies ?? []).map((a) => a.name).join(", ");
      findings.push(`- 联邦公报新文件（${d.publication_date}，${d.type}，${ag}）：[${d.title}](${d.html_url})　关键词：${term}`);
    }
  } catch (e) { errors.push(`联邦公报「${term}」：${e.message}`); }
}
state.seenDocs = state.seenDocs.slice(-500);

// 4. 欧盟：没有好用的公开 API，每周一在报告里提醒人工核对
const monday = new Date().getUTCDay() === 1;
const euReminder = monday
  ? `\n### 欧盟（每周人工核对）\n- [TARIC 9401610000](https://ec.europa.eu/taxation_customs/dds2/taric/measures.jsp?Lang=en&Taric=9401610000&LangDescr=en)、[TARIC 9401710000](https://ec.europa.eu/taxation_customs/dds2/taric/measures.jsp?Lang=en&Taric=9401710000&LangDescr=en)：确认第三国关税仍为 0%，没有新的反倾销措施\n- [EUDR 最新动态](https://environment.ec.europa.eu/topics/forests/deforestation/regulation-deforestation-free-products_en)：确认 2026-12-30 的适用日期没有再变\n`
  : "";

state.lastRun = today;
await writeFile(STATE, JSON.stringify(state, null, 2) + "\n");

if (init) { console.log("基线已记录，共", Object.keys(state.values).length, "项税率、", state.seenDocs.length, "份文件"); process.exit(0); }

const hasNews = findings.length > 0 || errors.length > 0 || euReminder;
if (!hasNews) { console.log("没有变化"); await writeFile(REPORT, ""); process.exit(0); }

const md = `## 关税检查报告 ${today}

${findings.length ? `### 发现的变化（需要人工确认）\n${findings.join("\n")}\n` : "### 税率和公告：没有发现变化\n"}${euReminder}${errors.length ? `\n### 检查失败（数据源暂时无法访问，明天会重试）\n${errors.map((e) => `- ${e}`).join("\n")}\n` : ""}
---
**怎么处理**：逐条打开原文，确认是否影响软体座椅（9401.61 / 9401.71）。
- 影响网站数据：修改 \`外贸学习/site/tariffs.json\`（或把这个 Issue 发给 Claude），并把 \`asOf\` 改成今天，然后关闭 Issue。
- 不相关：直接关闭 Issue。
`;
await writeFile(REPORT, md);
console.log(md);
