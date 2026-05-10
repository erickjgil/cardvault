// netlify/functions/ebay-auth.js
// Proxies eBay OAuth token requests to avoid CORS issues

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { code, refresh_token, app_id, cert_id, ru_name, grant_type } = JSON.parse(event.body || '{}');

    if (!app_id || !cert_id) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing app_id or cert_id' }) };
    }

    const credentials = Buffer.from(`${app_id}:${cert_id}`).toString('base64');

    let body;
    if (grant_type === 'refresh_token') {
      body = `grant_type=refresh_token&refresh_token=${encodeURIComponent(refresh_token)}&scope=https://api.ebay.com/oauth/api_scope/sell.inventory`;
    } else {
      body = `grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(ru_name)}`;
    }

    const resp = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`,
      },
      body,
    });

    const data = await resp.json();
    return { statusCode: resp.status, headers, body: JSON.stringify(data) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
