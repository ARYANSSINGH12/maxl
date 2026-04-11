export const config = {
  maxDuration: 60
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    const { mimeType, imageBase64, sessionApiKey } = req.body;
    const apiKey = sessionApiKey || process.env.GEMINI_KEY;

    if (!apiKey) {
      return res.status(401).json({
        error: "No API key configured. Add GEMINI_KEY in Vercel Environment Variables, then redeploy."
      });
    }

    if (!imageBase64 || !mimeType) {
      return res.status(400).json({ error: "No image provided." });
    }

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      }
    );

    const data = await geminiResponse.json();

    if (!geminiResponse.ok) {
      return res.status(geminiResponse.status).json({
        error: data?.error?.message || "Gemini API call failed."
      });
    }

    const text = data?.candidates?.[0]?.content?.parts
      ?.map(p => p.text || "")
      .join("")
      .trim();

    if (!text) {
      return res.status(500).json({ error: "Gemini returned an empty response." });
    }

    // Try multiple strategies to extract valid JSON
    const extraction = extractJson(text);

    if (extraction) {
      return res.json({ extraction });
    }

    // If all parsing fails, return the raw text so the frontend can show it
    return res.status(500).json({
      error: "Could not parse Gemini response as JSON.",
      raw: text
    });

  } catch (err) {
    return res.status(500).json({
      error: err.message || "Unexpected server error."
    });
  }
}

function extractJson(text) {
  // Strategy 1: direct parse
  try { return JSON.parse(text); } catch {}

  // Strategy 2: strip markdown fences
  try {
    const stripped = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/g, "")
      .trim();
    return JSON.parse(stripped);
  } catch {}

  // Strategy 3: find first { and last } and parse what's between
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
  } catch {}

  // Strategy 4: find JSON block inside markdown
  try {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (match) return JSON.parse(match[1].trim());
  } catch {}

  return null;
}
