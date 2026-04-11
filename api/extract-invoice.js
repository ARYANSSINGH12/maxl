export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== "POST") return res.status(405).end();

  try {
    const { mimeType, imageBase64, fileName, sessionApiKey } = req.body;

    // Use key from request OR from Vercel environment variable
    const apiKey = sessionApiKey || process.env.GEMINI_KEY;

    // If no key found anywhere, return clear error
    if (!apiKey) {
      return res.status(401).json({
        error: "No API key configured. Add GEMINI_KEY in Vercel Environment Variables, then redeploy."
      });
    }

    // If no image was sent
    if (!imageBase64 || !mimeType) {
      return res.status(400).json({ error: "No image provided." });
    }

    // Call Gemini API
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                text: `Extract structured invoice data as JSON with fields: providerName, invoiceDate, providerType, taxMode, rawText, notes, items (array with name, activeIngredient, uses, genericOrBrand, category, amountBefore, discount, amountAfter, taxIncluded, taxRate, taxAmount, rawLine). Return only JSON.`
              },
              {
                inlineData: { mimeType, data: imageBase64 }
              }
            ]
          }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.1
          }
        })
      }
    );

    const data = await geminiResponse.json();

    // If Gemini itself returned an error
    if (!geminiResponse.ok) {
      return res.status(geminiResponse.status).json({
        error: data?.error?.message || "Gemini API call failed."
      });
    }

    // Extract the text from Gemini's response
    const text = data?.candidates?.[0]?.content?.parts
      ?.map(p => p.text || "")
      .join("")
      .trim();

    if (!text) {
      return res.status(500).json({ error: "Gemini returned an empty response." });
    }

    // Parse the JSON that Gemini returned
    try {
      const cleaned = text
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```$/g, "")
        .trim();

      const extraction = JSON.parse(cleaned);
      return res.json({ extraction });

    } catch (parseError) {
      return res.status(500).json({
        error: "Could not parse Gemini response as JSON.",
        raw: text.slice(0, 300) // send first 300 chars for debugging
      });
    }

  } catch (err) {
    // Catch any unexpected errors
    return res.status(500).json({
      error: err.message || "Unexpected server error."
    });
  }
}
