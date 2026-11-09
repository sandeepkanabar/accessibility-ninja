const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const PORT = Number(process.env.PORT || 8080);
const MAX_UPLOAD = 15 * 1024 * 1024;
const INDEX = process.env.ELASTICSEARCH_INDEX || 'accessibility-ninja-slides';
const records = new Map(); // local-only fallback; Elasticsearch is the intended data layer.
let uploadCounter, searchCounter;
try {
  const { metrics } = require('@opentelemetry/api');
  const meter = metrics.getMeter('accessibility-ninja');
  uploadCounter = meter.createCounter('accessibility_ninja_uploads', { description: 'PPTX uploads processed; no file content is recorded.' });
  searchCounter = meter.createCounter('accessibility_ninja_searches', { description: 'Slide search requests processed; query text is not recorded.' });
} catch { /* OpenTelemetry is optional for local development. */ }
function appLog(message, attributes = {}, level = 'INFO') {
  const safeAttrs = Object.entries(attributes).map(([key, value]) => ({ key, value: typeof value === 'number' ? { intValue: String(value) } : { stringValue: String(value) } }));
  console.log(JSON.stringify({ severity: level, message, ...attributes }));
  const explicitLogsEndpoint = process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT;
  const base = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!base && !explicitLogsEndpoint) return;
  const headers = { 'content-type': 'application/json' };
  for (const pair of (process.env.OTEL_EXPORTER_OTLP_HEADERS || '').split(',')) {
    const [key, ...value] = pair.split('='); if (key && value.length) headers[key.trim()] = value.join('=').trim();
  }
  const severity = level === 'ERROR' ? 17 : level === 'WARN' ? 13 : 9;
  const body = { resourceLogs: [{ resource: { attributes: [{ key: 'service.name', value: { stringValue: process.env.OTEL_SERVICE_NAME || 'accessibility-ninja' } }] }, scopeLogs: [{ scope: { name: 'accessibility-ninja' }, logRecords: [{ timeUnixNano: String(BigInt(Date.now()) * 1000000n), severityNumber: severity, severityText: level, body: { stringValue: message }, attributes: safeAttrs }] }] }] };
  fetch(explicitLogsEndpoint || `${base.replace(/\/$/, '')}/v1/logs`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(2000) }).catch(() => {});
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body));
}
function readBody(req, max = MAX_UPLOAD) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > max) { reject(new Error('Upload exceeds 15 MB')); req.destroy(); } else chunks.push(chunk); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function decodeXml(s = '') { return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"); }
function textRuns(xml) { return [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(m => decodeXml(m[1])).filter(Boolean); }
function parseSlide(xml, number) {
  const shapes = [];
  const blocks = [...xml.matchAll(/<(p:sp|p:pic|p:graphicFrame)\b[\s\S]*?<\/\1>/g)];
  for (const m of blocks) {
    const block = m[0], texts = textRuns(block);
    const nv = block.match(/<p:cNvPr\b([^>]*)\/?\s*>/);
    const attrs = nv?.[1] || '';
    const name = decodeXml(attrs.match(/\bname="([^"]*)"/)?.[1] || '');
    const descr = decodeXml(attrs.match(/\bdescr="([^"]*)"/)?.[1] || '');
    const phType = block.match(/<p:ph\b[^>]*\btype="([^"]+)"/)?.[1];
    const sizeMatches = [...block.matchAll(/<a:rPr\b[^>]*\bsz="(\d+)"/g)].map(x => Number(x[1]) / 100);
    if (texts.length || /<p:pic\b/.test(block)) shapes.push({ kind: /<p:pic\b/.test(block) ? 'image' : /graphicFrame/.test(block) ? 'graphic' : 'text', name, text: texts.join(' '), description: descr, isTitle: phType === 'title' || phType === 'ctrTitle', minFontPt: sizeMatches.length ? Math.min(...sizeMatches) : null });
  }
  const title = shapes.find(s => s.isTitle && s.text)?.text || shapes.find(s => s.text)?.text || `Slide ${number}`;
  const findings = [];
  if (!shapes.some(s => s.isTitle && s.text)) findings.push({ severity: 'review', code: 'title', message: 'No explicit title placeholder found; confirm this slide has a useful screen-reader landmark.' });
  for (const shape of shapes.filter(s => s.kind === 'image' && !s.description)) findings.push({ severity: 'review', code: 'missing-description', target: shape.name || 'Image', message: 'This image has no description. Add a speaker-approved explanation or mark it decorative.' });
  for (const shape of shapes.filter(s => s.minFontPt && s.minFontPt < 24)) findings.push({ severity: 'check', code: 'small-text', target: shape.name || 'Text', message: `Detected text at ${shape.minFontPt} pt, below the 24 pt body-text recommendation. Check it at presentation size; this estimate may miss inherited font sizes, and code snippets use a different threshold.` });
  return { number, title, shapes, findings, speakerExplanation: '' };
}
async function extractDeck(buffer, filename) {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'accessibility-ninja-'));
  try {
    const file = path.join(tmp, 'deck.pptx'); await fs.promises.writeFile(file, buffer);
    const { stdout } = await execFileAsync('unzip', ['-Z1', file], { maxBuffer: 2 * 1024 * 1024 });
    const names = stdout.split('\n').filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/slide(\d+)/)[1]) - Number(b.match(/slide(\d+)/)[1]));
    if (!names.length) throw new Error('No PowerPoint slides found. Upload a .pptx file.');
    const slides = [];
    for (let i = 0; i < names.length; i++) {
      const { stdout: xml } = await execFileAsync('unzip', ['-p', file, names[i]], { maxBuffer: 3 * 1024 * 1024 });
      slides.push(parseSlide(xml, i + 1));
    }
    return { id: crypto.randomUUID(), filename: path.basename(filename).slice(0, 120), createdAt: new Date().toISOString(), slides };
  } finally { await fs.promises.rm(tmp, { recursive: true, force: true }); }
}
async function elastic(method, endpoint, body) {
  const base = process.env.ELASTICSEARCH_URL;
  if (!base) return null;
  const headers = { 'content-type': 'application/json' };
  if (process.env.ELASTICSEARCH_API_KEY) headers.authorization = `ApiKey ${process.env.ELASTICSEARCH_API_KEY}`;
  const response = await fetch(`${base.replace(/\/$/, '')}/${endpoint}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(4000) });
  if (!response.ok) throw new Error(`Elasticsearch returned HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}
async function persistDeck(deck) {
  const docs = deck.slides.map(s => ({ deckId: deck.id, filename: deck.filename, slideNumber: s.number, title: s.title, text: s.shapes.map(x => x.text).filter(Boolean).join(' '), visualExplanation: s.speakerExplanation, content: [s.title, s.shapes.map(x => x.text).filter(Boolean).join(' '), s.speakerExplanation].filter(Boolean).join(' '), findings: s.findings }));
  for (const doc of docs) records.set(`${deck.id}:${doc.slideNumber}`, doc);
  if (!process.env.ELASTICSEARCH_URL) return { mode: 'local-demo', count: docs.length };
  await elastic('PUT', `/${INDEX}`, { mappings: { properties: { deckId: { type: 'keyword' }, filename: { type: 'keyword' }, slideNumber: { type: 'integer' }, title: { type: 'text' }, text: { type: 'text' }, visualExplanation: { type: 'text' }, content: { type: 'text', copy_to: 'content_semantic' }, content_semantic: { type: 'semantic_text' } } } }).catch(e => { if (!String(e.message).includes('resource_already_exists_exception')) throw e; });
  for (const doc of docs) await elastic('PUT', `/${INDEX}/_doc/${doc.deckId}-${doc.slideNumber}?refresh=wait_for`, doc);
  return { mode: 'elasticsearch', count: docs.length };
}
async function searchSlides(q) {
  if (process.env.ELASTICSEARCH_URL) {
    const result = await elastic('POST', `/${INDEX}/_search`, { size: 10, retriever: { rrf: { retrievers: [
      { standard: { query: { multi_match: { query: q, fields: ['title^3', 'visualExplanation^2', 'text', 'content'] } } } },
      { standard: { query: { match: { content_semantic: q } } } }
    ] } } });
    return result.hits.hits.map(h => h._source);
  }
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  return [...records.values()].filter(d => terms.some(t => `${d.title} ${d.text} ${d.visualExplanation}`.toLowerCase().includes(t))).slice(0, 10);
}
async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && ['/health', '/healthz', '/readyz'].includes(url.pathname)) return send(res, 200, { ok: true, search: process.env.ELASTICSEARCH_URL ? 'elasticsearch' : 'local-demo' });
  if (req.method === 'POST' && url.pathname === '/api/upload') {
    try {
      const body = await readBody(req); const boundary = req.headers['content-type']?.match(/boundary=(.+)$/)?.[1];
      if (!boundary) return send(res, 400, { error: 'Expected multipart .pptx upload' });
      const marker = Buffer.from(`--${boundary}`); let start = body.indexOf(marker); let pptx = null; let filename = 'presentation.pptx';
      while (start >= 0) {
        const headerStart = start + marker.length + 2; const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), headerStart); if (headerEnd < 0) break;
        const headers = body.subarray(headerStart, headerEnd).toString(); const next = body.indexOf(marker, headerEnd + 4); if (next < 0) break;
        if (/name="file"/.test(headers)) { filename = headers.match(/filename="([^"]+)"/)?.[1] || filename; pptx = body.subarray(headerEnd + 4, next - 2); break; }
        start = next;
      }
      if (!pptx) return send(res, 400, { error: 'Choose a .pptx file first' });
      const deck = await extractDeck(pptx, filename); const storage = await persistDeck(deck); deck.storage = storage; uploadCounter?.add(1, { storage: storage.mode, slide_count: deck.slides.length }); appLog('presentation processed', { slide_count: deck.slides.length, storage: storage.mode });
      return send(res, 200, deck);
    } catch (e) { return send(res, 400, { error: e.message }); }
  }
  if (req.method === 'POST' && url.pathname.startsWith('/api/deck/')) {
    const id = url.pathname.split('/').pop();
    try { const update = JSON.parse((await readBody(req, 256 * 1024)).toString()); const doc = records.get(`${id}:${update.number}`); if (!doc) return send(res, 404, { error: 'Slide not found' });
      doc.visualExplanation = String(update.explanation || '').slice(0, 3000); doc.content = [doc.title, doc.text, doc.visualExplanation].filter(Boolean).join(' ');
      await elastic('PUT', `/${INDEX}/_doc/${id}-${update.number}?refresh=wait_for`, doc); return send(res, 200, { ok: true });
    } catch (e) { return send(res, 502, { error: e.message }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/search') {
    try { const payload = JSON.parse((await readBody(req, 4096)).toString()); const query = String(payload.q || '').slice(0, 300); searchCounter?.add(1); const results = await searchSlides(query); appLog('slide search completed', { result_count: results.length }); return send(res, 200, { results }); }
    catch (e) { appLog('slide search failed', { error_type: e.name || 'Error' }, 'ERROR'); return send(res, 502, { error: 'Search service unavailable' }); }
  }
  if (req.method === 'GET') {
    let pathname;
    try { pathname = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname); }
    catch { return send(res, 400, 'Bad path', 'text/plain; charset=utf-8'); }
    const name = pathname.replace(/^\//, '');
    if (!['index.html', 'app.js', 'style.css'].includes(name)) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    const file = path.join(__dirname, name);
    try { const data = await fs.promises.readFile(file); const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'; return send(res, 200, data, `${type}; charset=utf-8`); }
    catch { return send(res, 404, 'Not found', 'text/plain; charset=utf-8'); }
  }
  return send(res, 404, { error: 'Not found' });
}

http.createServer((req, res) => { handle(req, res).catch(e => send(res, 500, { error: e.message })); }).listen(PORT, () => console.log(`Accessibility Ninja listening on ${PORT}`));
