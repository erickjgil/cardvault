// netlify/functions/ebay-api.js
// Proxies eBay Trading API calls to avoid CORS issues

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Method not allowed' };
  }

  try {
    const { call_name, app_id, xml_body } = JSON.parse(event.body || '{}');

    if (!call_name || !app_id || !xml_body) {
      return { statusCode: 400, headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing required fields: call_name, app_id, xml_body' }) };
    }

    const resp = await fetch('https://api.ebay.com/ws/api.dll', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
        'X-EBAY-API-CALL-NAME': call_name,
        'X-EBAY-API-SITEID': '0',
        'X-EBAY-API-APP-NAME': app_id,
      },
      body: xml_body,
    });

    const text = await resp.text();
    return {
      statusCode: resp.status,
      headers: { ...headers, 'Content-Type': 'text/xml' },
      body: text,
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
