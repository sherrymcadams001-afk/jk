/* Cloudflare Worker version of SMTP2GO Sender Pro (No Python)
   NOTE: Workers have CPU time limits per request; bulk 'interval' sending is simulated by scheduling
   using Durable Object state + alarm API (or manual polling). This simplified version:
   - Accepts single send (immediate outbound fetch to SMTP2GO)
   - Accepts bulk job creation: stores recipients + templates in Durable Object
   - Durable Object processes recipients in timed batches using alarms (emulating interval)
   - Status endpoint polls job progress

   Caveats:
   - Attachments limited to per-request size (~10MB total) and are kept transiently
   - No persistence beyond Durable Object volatile storage (survives some reboots but not guaranteed long-term)
*/

export default {
  fetch: (request, env, ctx) => router.handle(request, env, ctx)
};

// ---------------- Router ----------------
const router = new (class {
  async handle(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;
    try {
      if (request.method === 'GET' && pathname === '/') {
        return new Response('Worker API: /api/send-email, /api/send-bulk, /api/bulk-status/:id', { status: 200 });
      }
      if (pathname === '/api/send-email' && request.method === 'POST') {
        return singleSend(request, env);
      }
      if (pathname === '/api/send-bulk' && request.method === 'POST') {
        return bulkCreate(request, env);
      }
      if (pathname.startsWith('/api/bulk-status/') && request.method === 'GET') {
        const jobId = pathname.split('/').pop();
        return bulkStatus(jobId, env);
      }
      return json({ success: false, error: 'Not found' }, 404);
    } catch (e) {
      return json({ success: false, error: 'Internal error', detail: e.message }, 500);
    }
  }
})();

// --------------- Utility Helpers -----------------
function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function isValidEmail(email) {
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email || '');
}

async function parseFormData(request) {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await request.json();
    return { fields: data, files: [] };
  }
  if (contentType.startsWith('multipart/form-data')) {
    const form = await request.formData();
    const fields = {}; const files = [];
    for (const [key, value] of form.entries()) {
      if (value instanceof File) {
        files.push({ key, file: value });
      } else {
        fields[key] = value;
      }
    }
    return { fields, files };
  }
  // Fallback: urlencoded
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const text = await request.text();
    const params = new URLSearchParams(text);
    const fields = {}; for (const [k, v] of params.entries()) fields[k] = v;
    return { fields, files: [] };
  }
  return { fields: {}, files: [] };
}

function processTemplate(tmpl, ctx) {
  if (typeof tmpl !== 'string') return '';
  return tmpl.replace(/{{\s*([\w\s.-]+?)\s*}}/g, (m, p1) => {
    const key = normalizeColumnName(p1.trim());
    return ctx[key] != null ? String(ctx[key]) : m; // leave placeholder if missing
  });
}

function normalizeColumnName(name) {
  return name.toString().trim().replace(/\W|^(?=\d)/g, '_').replace(/^_+|_+$/g, '') || 'col';
}

async function fetchSMTP2GO(env, payload) {
  const apiUrl = (env.SMTP2GO_API_URL || '').replace(/\/$/, '') + '/email/send';
  if (!env.SMTP2GO_API_KEY) throw new Error('Missing SMTP2GO_API_KEY');
  payload.api_key = env.SMTP2GO_API_KEY;
  const res = await fetch(apiUrl, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(payload) });
  const txt = await res.text();
  let body; try { body = JSON.parse(txt); } catch { body = { raw: txt }; }
  if (!res.ok) {
    throw new Error(`SMTP2GO Error ${res.status}: ${body.message || txt.slice(0,120)}`);
  }
  return body;
}

// -------------- Single Send ------------------
async function singleSend(request, env) {
  const { fields, files } = await parseFormData(request);
  const to = (fields.to_email || '').trim();
  const subject = (fields.subject || '').trim();
  const html = (fields.html_content || '').trim();
  if (!(to && subject && html)) return json({ success: false, error: 'Missing required fields.' }, 400);
  if (!isValidEmail(to)) return json({ success: false, error: 'Invalid recipient email.' }, 400);

  const fromEmail = (fields.from_email || env.DEFAULT_SENDER_EMAIL || '').trim();
  const fromName = (fields.from_name || env.DEFAULT_SENDER_NAME || '').trim();
  if (!isValidEmail(fromEmail)) return json({ success: false, error: 'Invalid From email.' }, 400);

  // Attachments (simplified: inline base64 in one request; size guard ~5MB)
  let attachments = [];
  let totalBytes = 0;
  for (const { file } of files.filter(f => f.key === 'attachments')) {
    totalBytes += file.size;
    if (totalBytes > 5 * 1024 * 1024) return json({ success: false, error: 'Attachments exceed 5MB limit.' }, 413);
    const buf = new Uint8Array(await file.arrayBuffer());
    const b64 = btoa(String.fromCharCode(...buf));
    attachments.push({ filename: file.name, fileblob: b64, mimetype: file.type || 'application/octet-stream' });
  }

  const senderValue = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
  const payload = { to: [to], sender: senderValue, subject, html_body: html };
  if (attachments.length) payload.attachments = attachments;

  try {
    const resp = await fetchSMTP2GO(env, payload);
    return json({ success: true, message: 'Email sent', response: resp });
  } catch (e) {
    return json({ success: false, error: e.message }, 502);
  }
}

// --------------- Bulk Create -----------------
async function bulkCreate(request, env) {
  const { fields } = await parseFormData(request);
  if (!fields.recipients) return json({ success: false, error: 'Missing recipients JSON.' }, 400);
  let recipients; try { recipients = JSON.parse(fields.recipients); } catch { return json({ success: false, error: 'Invalid recipients JSON.' }, 400); }
  if (!Array.isArray(recipients) || recipients.length === 0) return json({ success: false, error: 'Recipients must be a non-empty array.' }, 400);
  if (recipients.length > 1000) return json({ success: false, error: 'Max 1000 recipients.' }, 400);
  const subjectTmpl = fields.subject || ''; const htmlTmpl = fields.html_content || '';
  const interval = Math.min(Math.max(parseInt(fields.interval || '4', 10), 1), 20);
  const fromEmailTmpl = fields.from_email_template || ''; const fromNameTmpl = fields.from_name_template || '';

  const id = crypto.randomUUID();
  const stub = env.JOB_STORE.get(env.JOB_STORE.idFromName(id));
  const init = await stub.fetch('https://do/job/init', { method: 'POST', body: JSON.stringify({ id, recipients, subjectTmpl, htmlTmpl, interval, fromEmailTmpl, fromNameTmpl }) });
  if (!init.ok) return json({ success: false, error: 'Failed to initialize job.' }, 500);
  return json({ success: true, job_id: id, details: { total_emails: recipients.length, interval } });
}

// --------------- Bulk Status -----------------
async function bulkStatus(jobId, env) {
  const stub = env.JOB_STORE.get(env.JOB_STORE.idFromName(jobId));
  const res = await stub.fetch('https://do/job/status');
  if (res.status === 404) return json({ success: false, error: 'Job not found' }, 404);
  const data = await res.json();
  return json({ success: true, status: data });
}

// -------------- Durable Object ----------------
export class JobStore {
  constructor(state, env) {
    this.state = state; this.env = env;
    this.intervalMs = 1000; // base alarm tick granularity
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/job/init' && request.method === 'POST') return this.init(request);
    if (url.pathname === '/job/status') return this.status();
    if (url.pathname === '/job/alarm') return new Response('OK');
    return new Response('Not found', { status: 404 });
  }

  async init(request) {
    const body = await request.json();
    const { id, recipients, subjectTmpl, htmlTmpl, interval, fromEmailTmpl, fromNameTmpl } = body;
    const job = {
      id,
      created: Date.now(),
      total: recipients.length,
      recipients,
      processed: 0,
      success: 0,
      failed: 0,
      failures: [],
      interval, // seconds
      subjectTmpl, htmlTmpl, fromEmailTmpl, fromNameTmpl,
      in_progress: true,
      current: 'Initializing...',
      last_tick: 0
    };
    await this.state.storage.put('job', job);
    // Schedule first alarm
    await this.state.storage.setAlarm(Date.now() + interval * 1000);
    return json({ ok: true });
  }

  async status() {
    const job = await this.state.storage.get('job');
    if (!job) return json({ error: 'Missing' }, 404);
    const copy = { ...job }; delete copy.recipients; // hide full list for bandwidth
    copy.completion_percentage = job.total ? Math.floor((job.processed / job.total) * 100) : 0;
    return json(copy);
  }

  async alarm() {
    let job = await this.state.storage.get('job');
    if (!job || !job.in_progress) return;
    // Process one recipient per alarm for simplicity
    if (job.processed >= job.total) {
      job.in_progress = false;
      await this.state.storage.put('job', job);
      return;
    }
    const idx = job.processed;
    const recipient = job.recipients[idx];
    let emailAddress = recipient?.Email || recipient?.email || '';
    if (!isValidEmail(emailAddress)) {
      job.failed += 1;
      job.failures.push({ i: idx, email: emailAddress || '(missing)', error: 'Invalid email' });
    } else {
      try {
        // Template context normalization
        const ctx = {}; for (const [k, v] of Object.entries(recipient)) ctx[normalizeColumnName(k)] = v;
        const subject = processTemplate(job.subjectTmpl, ctx);
        const html_body = processTemplate(job.htmlTmpl, ctx);
        const senderEmail = job.fromEmailTmpl ? processTemplate(job.fromEmailTmpl, ctx) : this.env.DEFAULT_SENDER_EMAIL;
        const senderName = job.fromNameTmpl ? processTemplate(job.fromNameTmpl, ctx) : this.env.DEFAULT_SENDER_NAME;
        const senderVal = senderName ? `${senderName} <${senderEmail}>` : senderEmail;
        const payload = { to: [emailAddress], sender: senderVal, subject, html_body };
        await fetchSMTP2GO(this.env, payload);
        job.success += 1;
      } catch (e) {
        job.failed += 1;
        job.failures.push({ i: idx, email: emailAddress, error: e.message.slice(0,180) });
      }
    }
    job.processed += 1;
    job.current = emailAddress || 'N/A';
    await this.state.storage.put('job', job);
    if (job.processed < job.total) {
      await this.state.storage.setAlarm(Date.now() + job.interval * 1000);
    }
  }
}

JobStore.prototype.alarm = JobStore.prototype.alarm; // ensure method is retained
