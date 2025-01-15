// routes/index.js
const express = require("express");
const router = express.Router();

// Default route for quick server-health checks
router.get("/", (req, res) => {
  res.send(`
    <html>
      <head>
        <title>API Status</title>
      </head>
      <body>
        <h1 style="color: green;">✅ Server is Running!</h1>
        <p>Everything is working as expected.</p>
      </body>
    </html>
  `);
});

module.exports = router;
