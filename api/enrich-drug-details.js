export default async function handler(req, res) {
if (req.method !== "POST") return res.status(405).end();

const { items, sessionApiKey } = req.body;
const apiKey = sessionApiKey || process.env.GEMINI_KEY;

if (!apiKey) return res.status(401).json({ error: "No API key configured." });

const response = await fetch(
`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
{
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({
contents: [{ parts: [{ text: `Map these drug names to active ingredients, uses, and brand/generic. Return only JSON with items array. Each item: name, activeIngredient, uses, genericOrBrand (brand/generic/unknown).\n\n${JSON.stringify(items)}` }]}],
generationConfig: { responseMimeType: "application/json", temperature: 0 }
})
}
);

const data = await response.json();
if (!response.ok) return res.status(response.status).json({ error: data?.error?.message || "Gemini failed." });

const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("").trim();
try {
const result = JSON.parse(text.replace(/^```json\s*/i, "").replace(/```$/,"").trim());
res.json(result);
} catch {
res.status(500).json({ error: "Could not parse response." });
}
}
