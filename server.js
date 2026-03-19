require('dotenv').config();
const express = require('express');
const cors = require('cors');
const aiRoutes = require('./routes/ai');

const app = express();

// ── Middleware ──────────────────────────────────────────────────
app.use(cors());         // allows Flutter app to call this backend
app.use(express.json()); // parse JSON bodies

// ── Routes ─────────────────────────────────────────────────────
app.use('/api/ai', aiRoutes);

// ── Health check ────────────────────────────────────────────────
// cron-job.org pings this every 10 min to keep Render awake (free)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

// ── Start ───────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ InvoiceAI backend running on port ${PORT}`);
});
