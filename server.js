require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");

// Centralized configuration
const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",")
  : ["*"];

// Debugging: Log CORS_ORIGIN and verify .env is loaded
console.log("CORS_ORIGIN (parsed):", CORS_ORIGIN);
console.log(
  "Environment variables loaded:",
  process.env.NODE_ENV,
  process.env.PORT,
  process.env.API_KEY
);

// Create Express app
const app = express();

// Middleware for logging HTTP requests
app.use(morgan("combined"));

// Explicit CORS Middleware for API
app.use(
  cors({
    origin: CORS_ORIGIN, // Allow specific origins
    methods: ["GET", "POST", "OPTIONS"], // Allow all necessary methods
    credentials: true, // Allow cookies and headers
  })
);

// API Key Validation Middleware
app.use((req, res, next) => {
  if (req.path === "/health" || req.path === "/socket.io/") return next(); // Skip validation for health checks and WebSocket

  const apiKey = req.headers["x-api-key"];
  if (apiKey !== process.env.API_KEY) {
    console.error(`Unauthorized request with API Key: ${apiKey}`);
    return res.status(403).json({ error: "Unauthorized" });
  }
  next();
});

// Serve Static Files
app.use(express.static(path.join(__dirname, "public")));

// Health Check Endpoint
app.get("/health", (req, res) => {
  res.status(200).send("Healthy");
});

// Default Route
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

// HTTP Server for Application
const httpServer = http.createServer(app);

// WebSocket Setup with CORS
const io = new Server(httpServer, {
  cors: {
    origin: CORS_ORIGIN, // Allow specific origins
    credentials: true, // Allow credentials (if needed)
  },
  pingTimeout: 60000, // Increase ping timeout
});

// Handle WebSocket connections
let userList = [];
io.on("connection", (socket) => {
  console.log(`🟢 A user connected: ${socket.id}`);

  socket.on("user name", (userName) => {
    if (!userName || typeof userName !== "string") {
      console.error(`Invalid user name: ${userName}`);
      return;
    }
    socket.userName = userName;
    userList[socket.id] = { id: socket.id, userName };
    console.log(`🔵 User ${userName} connected with socket ID: ${socket.id}`);
    io.emit("users", Object.values(userList));
  });

  socket.on("chat message", (msg) => {
    if (!msg || typeof msg !== "string") {
      console.error(`Invalid message: ${msg}`);
      return;
    }
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

// Set Keep-Alive Timeout
httpServer.keepAliveTimeout = 65000; // 65 seconds
httpServer.headersTimeout = 66000; // Ensure headers timeout is greater than keep-alive timeout

// Start HTTP Server
httpServer.listen(PORT, () => {
  console.log(`✅ HTTP Server is running on port ${PORT}`);
});

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error("❌ Unhandled Error:", {
    message: err.message,
    stack: err.stack,
    method: req.method,
    url: req.url,
    headers: req.headers,
  });
  res.status(500).json({ error: "Something went wrong!" });
});

// Graceful Shutdown
process.on("SIGTERM", () => {
  console.log("🛑 SIGTERM received. Closing server...");
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
