export const config = {
  maxDuration: 60
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    const { mimeType, imageBase64, sessionApiKey } = req.body;

    // Get access token from Google service account
    const accessToken = await getAccessToken();

    const projectId = process.env.VERTEX_PROJECT_ID;
    const location = process.env.VERTEX_LOCATION || "us-central1";
    const model = "gemini-2.0-flash";

    if (!projectId) {
      return res.status(401).json({ error: "VERTEX_PROJECT_ID environment variable not set." });
    }

    if (!imageBase64 || !mimeType) {
      return res.status(400).json({ error: "No image provided." });
    }

    const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

    const geminiResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              text: `You are an invoice data extractor. Look at this invoice image and return a single JSON object.

The JSON must have these fields:
{
  "providerName": "name of hospital or pharmacy",
  "invoiceDate": "date on invoice",
  "providerType": "pharmacy or hospital or unknown",
  "taxMode": "included or not_included or mixed or unknown",
  "rawText": "all text you can read from the invoice",
  "notes": "",
  "items": [
    {
      "name": "medicine name",
      "activeIngredient": "",
      "uses": "",
      "genericOrBrand": "brand or generic or unknown",
      "category": "medicine or vitamin or daily",
      "amountBefore": 0,
      "discount": 0,
      "amountAfter": 0,
      "taxIncluded": false,
      "taxRate": 0,
      "taxAmount": 0,
      "rawLine": "original line from invoice"
    }
  ]
}

IMPORTANT: Return ONLY the JSON object. No markdown. No backticks. No explanation. Start your response with { and end with }`
            },
            {
              inlineData: { mimeType, data: imageBase64 }
            }
          ]
        }],
        generationConfig: {
          temperature: 0.1
        }
      })
    });

    const data = await geminiResponse.json();

    if (!geminiResponse.ok) {
      return res.status(geminiResponse.status).json({
        error: data?.error?.message || "Vertex AI call failed.",
        detail: data
      });
    }

    const text = data?.candidates?.[0]?.content?.parts
      ?.map(p => p.text || "")
      .join("")
      .trim();

    if (!text) {
      return res.status(500).json({ error: "Vertex AI returned an empty response." });
    }

    const extraction = extractJson(text);

    if (extraction) {
      return res.json({ extraction });
    }

    return res.status(500).json({
      error: "Could not parse response as JSON.",
      raw: text
    });

  } catch (err) {
    return res.status(500).json({
      error: err.message || "Unexpected server error."
    });
  }
}

// ---- Google Service Account JWT Auth ----

async function getAccessToken() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON environment variable not set.");

  const sa = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);

  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));

  const signingInput = `${header}.${payload}`;
  const signature = await signWithRsaKey(sa.private_key, signingInput);
  const jwt = `${signingInput}.${signature}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    })
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error("Failed to get access token: " + JSON.stringify(tokenData));
  }
  return tokenData.access_token;
}

function base64url(str) {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function signWithRsaKey(pemKey, data) {
  const crypto = await import("crypto");

  const sign = crypto.createSign("RSA-SHA256");
  sign.update(data);
  sign.end();

  const signature = sign.sign(pemKey);
  return signature
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ---- JSON extraction helpers ----

function extractJson(text) {
  try { return JSON.parse(text); } catch {}

  try {
    const stripped = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/g, "")
      .trim();
    return JSON.parse(stripped);
  } catch {}

  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
  } catch {}

  try {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (match) return JSON.parse(match[1].trim());
  } catch {}

  return null;
}
