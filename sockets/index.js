// sockets/index.js
const {
  generateRoomId,
  getGame,
  ensureSingleEmptyRoom,
  updateRoomCountForEveryone,
  broadcastRooms,
  allPlayersReady,
  startCountdown,
  updateRoomCountForSingleUser,
} = require("../utils/gameUtils");

module.exports = (io) => {
  const games = {};
  let userList = {};

  io.on("connection", (socket) => {
    console.log(`🟢 A user connected: ${socket.id}`);

    // Update room counts for the connected user
    if (Object.keys(games).length > 0) {
      Object.entries(games).forEach(([key, game]) => {
        updateRoomCountForSingleUser(Number(key), socket, games);
      });
    }

    // Track user info
    socket.on("user name", (userName, callback) => {
      if (typeof userName !== "string") {
        callback({ success: false, error: "Invalid user name." });
        return;
      }

      socket.userName = userName;
      userList[socket.id] = { id: socket.id, userName };
      io.emit("users", Object.values(userList));
    });

    // Chat message event
    socket.on("chat message", (msg) => {
      socket.broadcast.emit("chat message", msg);
    });

    // Request rooms for a game
    socket.on("requestRooms", (gameId) => {
      socket.join(gameId);
      ensureSingleEmptyRoom(gameId, games);
      broadcastRooms(gameId, games, io);
    });

    // Join a room
    socket.on("joinRoom", ({ gameId, roomId, userName }) => {
      const game = getGame(gameId, games);
      const room = game.rooms[roomId];
      if (!room) return;

      const existingPlayer = room.players.find((p) => p.socketId === socket.id);
      if (!existingPlayer) {
        room.players.push({ socketId: socket.id, userName, isReady: false });
        const uniqueRoomChannel = `${gameId}-${roomId}`;
        socket.join(uniqueRoomChannel);

        if (room.players.length === 1) {
          ensureSingleEmptyRoom(gameId, games);
        }
      }

      broadcastRooms(gameId, games, io);
    });

    // Leave a room
    socket.on("leaveRoom", ({ gameId, roomId }) => {
      const game = getGame(gameId, games);
      const room = game.rooms[roomId];
      if (!room) return;

      const uniqueRoomChannel = `${gameId}-${roomId}`;
      socket.leave(uniqueRoomChannel);

      room.players = room.players.filter((p) => p.socketId !== socket.id);

      const emptyRooms = Object.values(game.rooms).filter(
        (r) => r.players.length === 0
      );
      if (room.players.length === 0 && emptyRooms.length > 1) {
        delete game.rooms[roomId];
        updateRoomCountForEveryone(gameId, games, io);
      }

      broadcastRooms(gameId, games, io);
    });

    // Toggle player readiness
    socket.on("toggleReady", ({ gameId, roomId, isReady }) => {
      const game = getGame(gameId, games);
      const room = game.rooms[roomId];
      if (!room) return;

      const player = room.players.find((p) => p.socketId === socket.id);
      if (player) {
        player.isReady = isReady;
      }

      if (allPlayersReady(room)) {
        startCountdown(gameId, roomId, io);
      }

      broadcastRooms(gameId, games, io);
    });

    // Handle disconnection
    socket.on("disconnect", () => {
      console.log(`🔴 A user disconnected: ${socket.id}`);
      delete userList[socket.id];
      io.emit("users", Object.values(userList));
    });
  });
};
