const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }

  const apiKey = normalizeApiKey(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);

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
        message: 'ANTHROPIC_API_KEY is set, but it does not look like a valid Anthropic API key. In Vercel, set only the key value, not "ANTHROPIC_API_KEY=...".'
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

    const response = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers,
      body: typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {})
    });

    const text = await response.text();
    res.status(response.status);
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
    return res.send(text);
  } catch (error) {
    return res.status(502).json({
      error: {
        message: error instanceof Error ? error.message : 'Unable to reach Claude API'
      }
    });
  }
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
