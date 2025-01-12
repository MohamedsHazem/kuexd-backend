require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");

// Centralized configuration
const PORT = process.env.PORT || 3000;

// Create Express app
const app = express();

// Middleware for CORS - Allow all origins
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    credentials: false,
  })
);

// Serve Static Files
app.use(express.static(path.join(__dirname, "public")));

// Default Route
app.get("/", (req, res) => {
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

// HTTP Server for Application
const httpServer = http.createServer(app);

// WebSocket Setup with CORS - Allow all origins
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    credentials: false,
  },
  pingTimeout: 60000, // Increase ping timeout
});

// Handle WebSocket connections
let userList = [];
io.on("connection", (socket) => {
  console.log(`🟢 A user connected: ${socket.id}`);

  socket.on("user name", (userName) => {
    if (typeof userName !== "string") return;
    socket.userName = userName;
    userList[socket.id] = { id: socket.id, userName };
    io.emit("users", Object.values(userList));
  });

  socket.on("chat message", (msg) => {
    socket.broadcast.emit("chat message", msg);
  });

  socket.on("disconnect", () => {
    delete userList[socket.id];
    io.emit("users", Object.values(userList));
  });
});

// Start HTTP Server
httpServer.listen(PORT, () => {
  console.log(`✅ HTTP Server is running on port ${PORT}`);
});
