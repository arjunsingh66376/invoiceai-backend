const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

// ── Helper: wait ms milliseconds ───────────────────────────────────
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Helper: call Gemini with 1 retry on 429 ───────────────────────
async function callGemini(prompt, retries = 2) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.0,
          maxOutputTokens: 300,
        },
      }),
    });

    // ✅ 429 = rate limited — wait 5 seconds and retry
    if (response.status === 429) {
      console.log(`Rate limited (429). Attempt ${attempt}/${retries}. Waiting 5s...`);
      if (attempt < retries) {
        await wait(5000);
        continue;
      }
      throw new Error('Gemini error: 429 — rate limit, try again in a moment');
    }

    if (!response.ok) {
      const errBody = await response.text();
      console.error('Gemini raw error:', errBody);
      throw new Error(`Gemini error: ${response.status}`);
    }

    return response.json();
  }
}

// ── POST /api/ai/parse ─────────────────────────────────────────────
router.post('/parse', async (req, res) => {
  const { text } = req.body;

  if (!text || text.trim().length < 3) {
    return res.status(400).json({ error: 'Please provide invoice text' });
  }

  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your_gemini_key_here') {
    return res.status(500).json({ error: 'Gemini API key not configured' });
  }

  const prompt = `You are an invoice data extractor. Extract data from the text below.

Text: "${text}"

Rules:
- "amount" = the main price number (digits only, no symbols). Examples:
    "logo design ₹10000" → amount: 10000
    "website for ABC Rs 50,000" → amount: 50000
    "consulting 8000/day" → amount: 8000
    "design work 15k" → amount: 15000
- "service" = clean description of the work, remove client name and amount
- "gst_rate" = 18 for services, 5 for food/restaurant, 28 for luxury/alcohol
- "client_name" = company or person name if mentioned, else null

Return ONLY this JSON (no markdown, no explanation):
{
  "service": "string",
  "amount": number,
  "gst_rate": number,
  "client_name": "string or null"
}`;

  try {
    const data = await callGemini(prompt);
    const content = data.candidates[0].content.parts[0].text;

    // Strip markdown if any
    const clean = content
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    const parsed = JSON.parse(clean);

    // Validate GST rate
    const validRates = [0, 5, 12, 18, 28];
    if (!validRates.includes(parsed.gst_rate)) parsed.gst_rate = 18;

    // Handle "15k" string amounts
    let amount = typeof parsed.amount === 'string'
      ? parseFloat(parsed.amount.replace(/[^0-9.]/g, ''))
      : (parsed.amount || 0);

    const subtotal = amount;
    const gstAmount = Math.round(subtotal * parsed.gst_rate) / 100;
    const total = subtotal + gstAmount;

    return res.json({
      success: true,
      data: {
        service: parsed.service || '',
        client_name: parsed.client_name || null,
        amount: subtotal,
        gst_rate: parsed.gst_rate,
        gst_amount: gstAmount,
        total: total,
      },
    });

  } catch (err) {
    console.error('AI parse error:', err.message);

    // ✅ Give user friendly message for rate limit
    if (err.message.includes('429')) {
      return res.status(429).json({
        error: 'Too many requests. Please wait a moment and try again.',
        detail: 'Gemini free tier: 15 requests/minute limit',
      });
    }

    return res.status(500).json({
      error: 'Failed to parse invoice text',
      detail: err.message,
    });
  }
});

module.exports = router;
