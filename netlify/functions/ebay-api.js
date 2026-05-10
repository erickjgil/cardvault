// netlify/functions/ebay-api.js
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };

  try {
    const body = JSON.parse(event.body || '{}');
    const { call_name, app_id, xml_body, image_base64, image_mime } = body;

    // Image upload via multipart — avoids XML base64 corruption
    if (call_name === 'UploadPicture' && image_base64 && app_id) {
      const imgBuffer = Buffer.from(image_base64, 'base64');
      const mime = image_mime || 'image/jpeg';
      const ext = mime.includes('png') ? 'png' : 'jpg';
      const boundary = 'CardVaultBoundary' + Date.now();

      const xmlPart = `<?xml version="1.0" encoding="utf-8"?><UploadSiteHostedPicturesRequest xmlns="urn:ebay:apis:eBLBaseComponents"><PictureSet>Supersize</PictureSet></UploadSiteHostedPicturesRequest>`;

      // Build multipart body: XML part + image part
      const multipart = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="XML Payload"\r\nContent-Type: text/xml;charset=utf-8\r\n\r\n${xmlPart}\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="dummy"; filename="card.${ext}"\r\nContent-Type: ${mime}\r\n\r\n`),
        imgBuffer,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);

      // Need the auth token in XML — extract it from the XML payload passed or use xml_body
      const tokenXml = xml_body || '';
      const tokenMatch = tokenXml.match(/<eBayAuthToken>(.*?)<\/eBayAuthToken>/);
      const token = tokenMatch ? tokenMatch[1] : '';

      const xmlWithToken = `<?xml version="1.0" encoding="utf-8"?><UploadSiteHostedPicturesRequest xmlns="urn:ebay:apis:eBLBaseComponents"><RequesterCredentials><eBayAuthToken>${token}</eBayAuthToken></RequesterCredentials><PictureSet>Supersize</PictureSet></UploadSiteHostedPicturesRequest>`;

      const multipartWithToken = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="XML Payload"\r\nContent-Type: text/xml;charset=utf-8\r\n\r\n${xmlWithToken}\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="dummy"; filename="card.${ext}"\r\nContent-Type: ${mime}\r\n\r\n`),
        imgBuffer,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);

      const resp = await fetch('https://api.ebay.com/ws/api.dll', {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
          'X-EBAY-API-CALL-NAME': 'UploadSiteHostedPictures',
          'X-EBAY-API-SITEID': '0',
          'X-EBAY-API-APP-NAME': app_id,
        },
        body: multipartWithToken,
      });

      const text = await resp.text();
      return { statusCode: resp.status, headers: { ...headers, 'Content-Type': 'text/xml' }, body: text };
    }

    // Standard XML Trading API call
    if (!call_name || !app_id || !xml_body) {
      return { statusCode: 400, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Missing fields' }) };
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
    return { statusCode: resp.status, headers: { ...headers, 'Content-Type': 'text/xml' }, body: text };

  } catch (err) {
    return { statusCode: 500, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message }) };
  }
};
