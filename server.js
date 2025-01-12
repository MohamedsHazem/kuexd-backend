require("dotenv").config();
const express = require("express");
const fs = require("fs");
const https = require("https");
const { Server } = require("socket.io");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");
const http = require("http");

// Centralized configuration
const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const CORS_ORIGIN = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",")
  : ["*"];
const SSL_KEY_PATH = process.env.SSL_KEY_PATH || "/etc/ssl/my-app/privkey.pem";
const SSL_CERT_PATH =
  process.env.SSL_CERT_PATH || "/etc/ssl/my-app/fullchain.pem";

// Create Express app
const app = express();

// Middleware for logging HTTP requests
app.use(morgan("combined"));

// CORS Configuration
app.use(
  cors({
    origin: CORS_ORIGIN,
    methods: ["GET", "POST"],
  })
);

// API Key Validation Middleware
app.use((req, res, next) => {
  if (req.path === "/health") return next();

  const apiKey = req.headers["x-api-key"];
  if (apiKey !== process.env.API_KEY) {
    console.error(`Unauthorized request with API Key: ${apiKey}`);
    return res.status(403).json({ error: "Unauthorized" });
  }
  next();
});

// Serve Static Files
app.use(express.static(path.join(__dirname, "public")));

// Health Check Endpoints
app.get("/", (req, res) => {
  res.status(200).send(`
    <html>
      <head>
        <title>API Status</title>
      </head>
      <body>
        <h1 style="color: green;">✅ Server is Running!</h1>
        <p>Everything is working as expected.</p>
        <p><strong>Version:</strong> 1.0.0</p>
        <p><strong>Environment:</strong> ${
          process.env.NODE_ENV || "development"
        }</p>
        <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
      </body>
    </html>
  `);
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "Healthy",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  });
});

// WebSocket Setup
let userList = [];
const io = new Server({
  cors: {
    origin: CORS_ORIGIN,
    methods: ["GET", "POST"],
  },
  pingTimeout: 60000,
});

io.on("connection", (socket) => {
  console.log(`🟢 A user connected: ${socket.id}`);

  socket.on("user name", (userName) => {
    socket.userName = userName;
    userList[socket.id] = { id: socket.id, userName };
    console.log(`🔵 User ${userName} connected with socket ID: ${socket.id}`);
    io.emit("users", Object.values(userList));
  });

  socket.on("chat message", (msg) => {
    console.log(`✉️ Message received: ${msg}`);
    socket.broadcast.emit("chat message", msg);
  });

  socket.on("disconnect", () => {
    console.log(`🔴 User ${socket.userName || "Unknown"} disconnected.`);
    delete userList[socket.id];
    io.emit("users", Object.values(userList));
  });

  socket.on("error", (err) => {
    console.error(
      `❌ WebSocket error for user ${socket.userName || "Unknown"}:`,
      err
    );
  });
});

// HTTPS Server Setup
let httpsServer;
try {
  const sslOptions = {
    key: fs.readFileSync(SSL_KEY_PATH),
    cert: fs.readFileSync(SSL_CERT_PATH),
  };

  httpsServer = https.createServer(sslOptions, app);
  io.attach(httpsServer);

  httpsServer.listen(HTTPS_PORT, () => {
    console.log(`✅ HTTPS Server is running on port ${HTTPS_PORT}`);
  });
} catch (error) {
  console.error("❌ Error setting up HTTPS:", error.message);
}

// HTTP Server for redirection or fallback
const httpServer = http.createServer(app);

httpServer.listen(PORT, () => {
  console.log(`✅ HTTP Server is running on port ${PORT}`);
});

httpServer.on("request", (req, res) => {
  if (!req.secure) {
    const host = req.headers.host.split(":")[0];
    const redirectUrl = `https://${host}${req.url}`;
    res.writeHead(301, { Location: redirectUrl });
    res.end();
  }
});

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error("❌ Unhandled Error:", err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

// Graceful Shutdown
process.on("SIGTERM", () => {
  console.log("🛑 SIGTERM received. Closing servers...");
  httpsServer?.close(() => console.log("HTTPS Server closed."));
  httpServer.close(() => console.log("HTTP Server closed."));
  process.exit(0);
});

process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled Promise Rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err.stack);
  process.exit(1); // Exit to restart via process manager
});
