const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const UPSTREAM_TIMEOUT_MS = 55000;

async function handler(req, res) {
  const rawApiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  const apiKey = normalizeApiKey(rawApiKey);
  const keyStatus = getKeyStatus(rawApiKey, apiKey);

  if (req.method === 'GET') {
    return res.status(200).json({
      ok: keyStatus.hasKey && keyStatus.hasAnthropicPrefix,
      keyStatus
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }

  if (!apiKey) {
    return res.status(500).json({
      error: {
        message: 'Missing ANTHROPIC_API_KEY. Add it to .env locally and to Vercel Environment Variables.'
      }
    });
  }

  if (!apiKey.startsWith('sk-ant-api')) {
    return res.status(500).json({
      error: {
        message: 'ANTHROPIC_API_KEY is set, but it does not look like a valid Anthropic API key. In Vercel, set only the key value, not "ANTHROPIC_API_KEY=...".',
        keyStatus
      }
    });
  }

  try {
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    };

    const betaHeader = req.headers['anthropic-beta'];
    if (betaHeader) {
      headers['anthropic-beta'] = Array.isArray(betaHeader) ? betaHeader.join(',') : betaHeader;
    }

    const requestBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    const response = await fetchWithRetry(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers,
      body: requestBody
    });

    const text = await response.text();

    if (response.status === 401) {
      return res.status(401).json({
        error: {
          message: 'Anthropic rejected the server API key. Replace ANTHROPIC_API_KEY in Vercel with a fresh active key, then redeploy.',
          upstreamStatus: response.status,
          upstreamBody: parseJsonSafely(text),
          keyStatus
        }
      });
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: {
          message: getUpstreamErrorMessage(response.status, text),
          upstreamStatus: response.status,
          upstreamBody: parseJsonSafely(text)
        }
      });
    }

    res.status(response.status);
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
    return res.send(text);
  } catch (error) {
    return res.status(502).json({
      error: {
        message: error instanceof Error ? error.message : 'Unable to reach Claude API',
        hint: 'If this happens only with Opus, the request may be timing out or the model may be unavailable for this API key.'
      }
    });
  }
}

module.exports = handler;
module.exports.config = {
  maxDuration: 60
};

function normalizeApiKey(value) {
  if (!value) return '';

  let key = String(value).trim();
  key = key.replace(/^['"]|['"]$/g, '').trim();

  if (key.includes('=') && key.split('=')[0].trim() === 'ANTHROPIC_API_KEY') {
    key = key.slice(key.indexOf('=') + 1).trim();
    key = key.replace(/^['"]|['"]$/g, '').trim();
  }

  return key;
}

function getKeyStatus(rawValue, normalizedValue) {
  return {
    hasKey: Boolean(normalizedValue),
    source: process.env.ANTHROPIC_API_KEY ? 'ANTHROPIC_API_KEY' : (process.env.CLAUDE_API_KEY ? 'CLAUDE_API_KEY' : 'none'),
    rawHadEquals: typeof rawValue === 'string' && rawValue.includes('='),
    normalizedLength: normalizedValue.length,
    hasAnthropicPrefix: normalizedValue.startsWith('sk-ant-api')
  };
}

function parseJsonSafely(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function fetchWithRetry(url, options) {
  const first = await fetchWithTimeout(url, options);
  if (![500, 502, 503, 504].includes(first.status)) {
    return first;
  }

  await new Promise(resolve => setTimeout(resolve, 750));
  return fetchWithTimeout(url, options);
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error('Claude API request timed out. Opus can take longer for PDFs; retry once, or use a faster model if this repeats.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function getUpstreamErrorMessage(status, text) {
  const parsed = parseJsonSafely(text);
  const upstreamMessage = parsed && typeof parsed === 'object'
    ? parsed.error?.message || parsed.message
    : '';

  if (upstreamMessage) {
    return `Claude API error ${status}: ${upstreamMessage}`;
  }

  if ([500, 502, 503, 504].includes(status)) {
    return `Claude API upstream error ${status}. This is often temporary, or the Opus PDF request is taking too long. Retry after a moment.`;
  }

  return `Claude API error ${status}`;
}
