const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

// 🔑 Key lives safely on server — never in the Flutter app
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

// ── POST /api/ai/parse ──────────────────────────────────────────
// Flutter app sends: { "text": "logo design for ABC ₹10,000" }
// Backend calls Gemini and returns parsed invoice data
router.post('/parse', async (req, res) => {
  const { text } = req.body;

  // Basic validation
  if (!text || text.trim().length < 3) {
    return res.status(400).json({ error: 'Please provide invoice text' });
  }

  // Check key is configured on server
  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your_gemini_key_here') {
    return res.status(500).json({ error: 'Gemini API key not configured on server' });
  }

  try {
    const geminiResponse = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `You are an Indian invoice parser.
Extract invoice details from this text and return ONLY valid JSON, no markdown.

Text: "${text}"

Return exactly this JSON:
{
  "service": "professional service description",
  "amount": 10000,
  "gst_rate": 18
}

Rules:
- amount must be a plain number (no ₹ symbol)
- gst_rate must be one of: 0, 5, 12, 18, 28
- 18% for most services, 5% for food, 28% for luxury
- service should be clean and professional`,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 200,
        },
      }),
    });

    if (!geminiResponse.ok) {
      throw new Error(`Gemini error: ${geminiResponse.status}`);
    }

    const data = await geminiResponse.json();

    // Extract text from Gemini response
    const content = data.candidates[0].content.parts[0].text;

    // Strip accidental markdown backticks
    const clean = content
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    const parsed = JSON.parse(clean);

    // Validate gst_rate is a valid Indian rate
    const validRates = [0, 5, 12, 18, 28];
    if (!validRates.includes(parsed.gst_rate)) {
      parsed.gst_rate = 18; // default to 18%
    }

    // Calculate GST amounts on server side too
    const subtotal = parsed.amount || 0;
    const gstAmount = Math.round(subtotal * parsed.gst_rate) / 100;
    const total = subtotal + gstAmount;

    return res.json({
      success: true,
      data: {
        service: parsed.service,
        amount: subtotal,
        gst_rate: parsed.gst_rate,
        gst_amount: gstAmount,
        total: total,
      },
    });

  } catch (err) {
    console.error('AI parse error:', err.message);
    return res.status(500).json({
      error: 'Failed to parse invoice text',
      detail: err.message,
    });
  }
});

module.exports = router;
