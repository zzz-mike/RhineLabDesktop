#!/usr/bin/env node
/**
 * Import a local transcript/event into a running AI秘书长 service.
 * This adapter never sends data to the internet: it only talks to the
 * explicitly supplied loopback endpoint (default 127.0.0.1:8866).
 *
 * Usage:
 *   node tools/local-ai-event-importer.mjs --check
 *   node tools/local-ai-event-importer.mjs --file transcript.txt
 *   node tools/local-ai-event-importer.mjs --file event.json
 */
import {readFile} from 'node:fs/promises';
import {basename,resolve} from 'node:path';

const DEFAULT_ENDPOINT = 'http://127.0.0.1:8866';

function usage() {
  console.log(`用法：
  node tools/local-ai-event-importer.mjs --check [--endpoint URL]
  node tools/local-ai-event-importer.mjs --file transcript.txt [--endpoint URL]
  node tools/local-ai-event-importer.mjs --file event.json [--endpoint URL]

说明：
  只连接本机回环地址，默认是 ${DEFAULT_ENDPOINT}。
  文本文件会作为一条本地转录资料导入；JSON 文件必须是事件对象。
  音频不会由本脚本自动转录，先用你选择的本地转录工具生成文字或 JSON。`);
}

function args(argv) {
  const result = {endpoint: DEFAULT_ENDPOINT, check: false, file: null};
  for (let i = 2; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--help' || value === '-h') { result.help = true; continue; }
    if (value === '--check') { result.check = true; continue; }
    if (value === '--file') {
      result.file = argv[++i];
      if (!result.file) throw new Error('--file 需要文件路径');
      continue;
    }
    if (value === '--endpoint') {
      result.endpoint = argv[++i];
      if (!result.endpoint) throw new Error('--endpoint 需要 URL');
      continue;
    }
    throw new Error(`不认识的参数：${value}`);
  }
  return result;
}

function loopbackEndpoint(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('为了保护本地资料，--endpoint 只能是 http://127.0.0.1 或 http://localhost 的根地址');
  }
  return url;
}

async function json(url, options = {}) {
  const response = await fetch(url, {redirect: 'error', ...options});
  const type = response.headers.get('content-type') || '';
  const body = type.startsWith('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const code = body && typeof body === 'object' ? body.code || body.error : body;
    throw new Error(`${response.status}：${code || '本机服务返回错误'}`);
  }
  return body;
}

async function check(endpoint) {
  const health = await json(new URL('/api/health', endpoint));
  if (!health || health.service !== 'AI秘书长') {
    throw new Error('本机端点不是兼容的 AI秘书长服务');
  }
  return {ok: true, endpoint: endpoint.origin, service: health.service, version: health.version,
    ai_intake: health.ai_intake === true, semantic_analysis: health.semantic_analysis === true};
}

function payloadFromText(text, file) {
  const name = basename(file);
  const clean = text.trim();
  if (!clean) throw new Error('文本文件为空，没有可录入内容');
  return {
    source_type: 'local_ai_transcript', source_ref: name, actor: '用户', thread_key: `local:${name}`,
    content: clean, metadata: {filename: name, input_kind: 'transcript'}, interpretation_mode: 'standard'
  };
}

async function readPayload(file) {
  const text = await readFile(resolve(file), 'utf8');
  if (file.toLowerCase().endsWith('.json')) {
    let value;
    try { value = JSON.parse(text); } catch { throw new Error('JSON 文件格式无效'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('事件 JSON 必须是对象');
    return value;
  }
  return payloadFromText(text, file);
}

async function main() {
  const options = args(process.argv);
  if (options.help || (!options.check && !options.file)) { usage(); return; }
  if (options.check && options.file) throw new Error('--check 不可和 --file 一起使用');
  const endpoint = loopbackEndpoint(options.endpoint);
  const status = await check(endpoint);
  if (options.check) { console.log(JSON.stringify(status, null, 2)); return; }
  const payload = await readPayload(options.file);
  const encoded = JSON.stringify(payload);
  if (Buffer.byteLength(encoded, 'utf8') > 900_000) {
    throw new Error('转录内容接近本机服务的 1 MB 请求上限，请按会话或时间分段后再导入');
  }
  const bootstrap = await json(new URL('/api/bootstrap', endpoint));
  if (!bootstrap.action_token) throw new Error('本机服务没有返回操作令牌，不能安全录入');
  const result = await json(new URL('/api/events', endpoint), {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'X-Action-Token': bootstrap.action_token},
    body: encoded
  });
  console.log(JSON.stringify({preflight: status, imported: result}, null, 2));
}

main().catch(error => {
  console.error(`本地资料导入失败：${error.message}`);
  process.exitCode = 1;
});
