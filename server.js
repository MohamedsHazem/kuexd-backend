require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");
const PORT = process.env.PORT || 3000;
const app = express();
const currentUserFullDataAsFlyObject = {};

// CORS configuration
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    credentials: false,
  })
);

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// Default route
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

// Create HTTP server
const httpServer = http.createServer(app);

// Setup Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    credentials: false,
  },
  pingTimeout: 60000, // Increase ping timeout if needed
});

// ======================================================================
// In-memory storage: Games & Rooms
// ======================================================================
const games = {};
// games structure example:
// {
//   "someGameId": {
//     rooms: {
//       "someRoomId": {
//         id: "someRoomId",
//         name: "Room someRoomId",
//         maxPlayers: 4,
//         players: [
//           { socketId: '...', userName: '...', isReady: false }
//         ],
//         isActive: false
//       }
//     }
//   }
// }

// Utility to generate unique Room IDs
function generateRoomId() {
  return Math.random().toString(36).substring(2, 9);
}

// Helper: Get or initialize a game object
function getGame(gameId) {
  if (!games[gameId]) {
    games[gameId] = { rooms: {} };
  }
  return games[gameId];
}

// ======================================================================
// Store all connected users here (by socketId)
// ======================================================================
let userList = {}; // IMPORTANT: Use an object, not an array

// ======================================================================
// Helper methods for Room Management
// ======================================================================

// Ensure exactly one empty room per game
function ensureSingleEmptyRoom(gameId) {
  const game = getGame(gameId);
  const roomsList = Object.values(game.rooms);

  // Find all empty rooms
  const emptyRooms = roomsList.filter((room) => room.players.length === 0);

  // If more than 1 empty room, remove extras
  while (emptyRooms.length > 1) {
    const roomToRemove = emptyRooms.pop();
    delete game.rooms[roomToRemove.id];
  }

  // If 0 empty rooms, create one
  if (emptyRooms.length === 0) {
    const newRoomId = generateRoomId();
    game.rooms[newRoomId] = {
      id: newRoomId,
      name: `Room ${newRoomId}`,
      maxPlayers: 4,
      players: [],
      isActive: false,
    };
  }
}

// Broadcast room list to everyone in the specific game "room"
function broadcastRooms(gameId) {
  const game = getGame(gameId);
  const roomsArray = Object.values(game.rooms);
  io.to(gameId).emit("roomsList", roomsArray);
}

// Check if all players in a room are ready
function allPlayersReady(room) {
  if (room.players.length === 0) return false;
  return room.players.every((p) => p.isReady);
}

// Start a countdown and notify all clients in the game
function startCountdown(gameId, roomId) {
  let countdown = 10;
  const intervalId = setInterval(() => {
    countdown--;

    // Broadcast countdown each second
    io.to(gameId).emit("countdownUpdate", { roomId, countdown });

    if (countdown === 0) {
      clearInterval(intervalId);

      // Mark room as active
      const game = getGame(gameId);
      const room = game.rooms[roomId];
      if (room) {
        room.isActive = true;
      }

      // Notify all clients that this room's game is starting
      io.to(gameId).emit("gameStart", { roomId });
    }
  }, 1000);
}

// ======================================================================
// SOCKET.IO HANDLERS
// ======================================================================
io.on("connection", (socket) => {
  console.log(`🟢 A user connected: ${socket.id}`);

  // 1) Track users for chat or global user list
  socket.on("user name", (userName) => {
    if (typeof userName !== "string") return;
    socket.userName = userName;

    // Store user in userList, keyed by socket.id
    userList[socket.id] = { id: socket.id, userName };

    // Emit the current full list of users to everyone
    io.emit("users", Object.values(userList));
  });

  // Basic chat example
  socket.on("chat message", (msg) => {
    socket.broadcast.emit("chat message", msg);
  });
  // ====================================================================
  // User-MANAGEMENT EVENTS
  // ====================================================================

  socket.emit("currentUserData", { id: socket.id });

  // ====================================================================
  // ROOM-MANAGEMENT EVENTS
  // ====================================================================

  // A) Client requests rooms for a gameId
  socket.on("requestRooms", (gameId) => {
    // Join socket.io "room" named after the gameId
    socket.join(gameId);

    // Ensure exactly one empty room
    ensureSingleEmptyRoom(gameId);

    // Send updated room list
    broadcastRooms(gameId);
  });

  // B) Join a specific room
  socket.on("joinRoom", ({ gameId, roomId, userName }) => {
    const game = getGame(gameId);
    const room = game.rooms[roomId];
    if (!room) return;

    const existingPlayer = room.players.find((p) => p.socketId === socket.id);
    if (!existingPlayer) {
      // Add player to this room
      room.players.push({ socketId: socket.id, userName, isReady: false });

      // If room was empty, now it’s occupied => ensure there's another empty room
      if (room.players.length === 1) {
        ensureSingleEmptyRoom(gameId);
      }
    }

    // Broadcast updated rooms
    broadcastRooms(gameId);
  });

  // C) Leave a specific room
  socket.on("leaveRoom", ({ gameId, roomId }) => {
    const game = getGame(gameId);
    const room = game.rooms[roomId];
    if (!room) return;

    // Remove the player from room
    room.players = room.players.filter((p) => p.socketId !== socket.id);

    // If room is now empty
    const emptyRooms = Object.values(game.rooms).filter(
      (r) => r.players.length === 0
    );
    if (room.players.length === 0) {
      // If there's another empty room, remove this one
      if (emptyRooms.length > 1) {
        delete game.rooms[roomId];
      }
    }

    // Broadcast updated rooms
    broadcastRooms(gameId);
  });

  // D) Toggle readiness
  socket.on("toggleReady", ({ gameId, roomId, isReady }) => {
    const game = getGame(gameId);
    const room = game.rooms[roomId];
    if (!room) return;

    const player = room.players.find((p) => p.socketId === socket.id);
    if (player) {
      player.isReady = isReady;
    }

    // If all players are ready => start countdown
    if (allPlayersReady(room)) {
      startCountdown(gameId, roomId);
    }
    // else we could reset/cancel countdown if we want that logic

    broadcastRooms(gameId);
  });

  // E) Handle disconnection
  socket.on("disconnect", () => {
    // Remove user from all rooms
    for (const [gId, game] of Object.entries(games)) {
      for (const [rId, room] of Object.entries(game.rooms)) {
        room.players = room.players.filter((p) => p.socketId !== socket.id);

        // If a room is empty now, remove it or keep one empty
        const emptyRooms = Object.values(game.rooms).filter(
          (r) => r.players.length === 0
        );
        if (room.players.length === 0) {
          if (emptyRooms.length > 1) {
            delete game.rooms[rId];
          }
        }
      }
    }

    // Remove user from userList
    delete userList[socket.id];

    // Emit updated user list
    io.emit("users", Object.values(userList));

    console.log(`🔴 A user disconnected: ${socket.id}`);
  });
});

// Start HTTP Server
httpServer.listen(PORT, () => {
  console.log(`✅ HTTP Server is running on port ${PORT}`);
});
