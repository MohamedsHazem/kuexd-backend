/************************************
 * sockets/games/agarIo.mjs
 ************************************/

/** Dimensions of the world */
const WORLD_WIDTH = 1080;
const WORLD_HEIGHT = 1080;

/** Server update rate in milliseconds */
const TICK_RATE = 30; // ~60 FPS updates

/** Import necessary utilities */
const { broadcastRooms } = require("../../utils/gameUtils");

// Initialize RBush variable
let RBush;

// Load RBush dynamically
(async () => {
  const rbushModule = await import("rbush");
  RBush = rbushModule.default;
})();

/**
 * Start the Agar.io-like room.
 *
 * @param {Object} game - The game object.
 * @param {Object} room - The room object to start.
 * @param {Object} games - The master games object.
 */
async function startAgarIoRoom(game, room, games) {
  // Wait for RBush to be loaded if not already loaded
  if (!RBush) {
    const rbushModule = await import("rbush");
    RBush = rbushModule.default;
  }

  console.log(
    `[Server] startAgarIoRoom (Agar.io) -> Setting initial positions for roomId=${room.id}`
  );

  // Initialize players as a Map for O(1) access
  room.playersMap = new Map();
  room.alivePlayers = new Set();

  room.players.forEach((player) => {
    player.x = Math.floor(Math.random() * WORLD_WIDTH);
    player.y = Math.floor(Math.random() * WORLD_HEIGHT);
    player.mass = 10;
    player.isDead = false;
    // Track last known direction for bullet firing
    player.lastDx = 0;
    player.lastDy = 0;
    // Add to playersMap and alivePlayers
    room.playersMap.set(player.socketId, player);
    room.alivePlayers.add(player.socketId);
  });

  // No food in this variant

  // Initialize bullets array and object pool
  room.bullets = [];
  room.bulletIdCounter = 1;
  room.bulletPool = []; // Object pool for bullets

  // Initialize spatial index for players
  room.playerSpatialIndex = new RBush();

  // Populate spatial index with initial player positions
  room.playersMap.forEach((player) => {
    room.playerSpatialIndex.insert({
      minX: player.x - player.mass,
      minY: player.y - player.mass,
      maxX: player.x + player.mass,
      maxY: player.y + player.mass,
      player, // Reference to the player object
    });
  });

  // Clear any existing intervals before starting a new one
  if (room.bulletInterval) {
    clearInterval(room.bulletInterval);
    console.log(
      `[Server] Cleared existing bulletInterval for roomId=${room.id}`
    );
  }

  // Periodically update bullet positions & collisions
  room.bulletInterval = setInterval(() => {
    updateBullets(game, room, games);
    broadcastGameState(game.io, game.id, room.id, room);
  }, 1000 / TICK_RATE);

  room.winner = null;
  console.log(`[Server] Started game loop for roomId=${room.id}`);
}

/**
 * Broadcast the entire Agar.io room state (players + bullets).
 */
function broadcastGameState(io, gameId, roomId, room) {
  if (!io) return;

  const channel = `${gameId}-${roomId}`;

  // Only broadcast players who are alive
  const alivePlayers = Array.from(room.alivePlayers).map((socketId) =>
    room.playersMap.get(socketId)
  );

  // Minimize data
  const playersData = alivePlayers.map((p) => ({
    socketId: p.socketId,
    userName: p.userName,
    x: p.x,
    y: p.y,
    mass: p.mass,
  }));

  const bulletsData = room.bullets.map((b) => ({
    id: b.id,
    ownerId: b.ownerId,
    x: b.x,
    y: b.y,
    radius: b.radius,
  }));

  io.to(channel).emit("gameStateUpdate", {
    roomId,
    players: playersData,
    bullets: bulletsData,
    winner: room.winner || null,
    worldSize: { width: WORLD_WIDTH, height: WORLD_HEIGHT },
  });
}

/**
 * Handle player movement from the client.
 */
function handlePlayerMove(io, games, data) {
  const { gameId, roomId, socket, direction } = data;
  const game = games[gameId];
  if (!game) return;

  let room = game.activeRooms[roomId] || game.rooms[roomId];
  if (!room) return;

  const player = room.playersMap?.get(socket.id);
  if (!player || player.isDead) return;

  const step = 4; // movement speed
  let dx = 0;
  let dy = 0;

  switch (direction) {
    case "up-left":
      dx = -step;
      dy = -step;
      break;
    case "up-right":
      dx = step;
      dy = -step;
      break;
    case "down-left":
      dx = -step;
      dy = step;
      break;
    case "down-right":
      dx = step;
      dy = step;
      break;
    case "up":
      dy = -step;
      break;
    case "down":
      dy = step;
      break;
    case "left":
      dx = -step;
      break;
    case "right":
      dx = step;
      break;
    default:
      dx = 0;
      dy = 0;
  }

  // Clamp to world boundaries
  const oldX = player.x;
  const oldY = player.y;
  player.x = clamp(player.x + dx, 0, WORLD_WIDTH);
  player.y = clamp(player.y + dy, 0, WORLD_HEIGHT);

  // Update spatial index if position changed
  if (dx !== 0 || dy !== 0) {
    room.playerSpatialIndex.remove(
      {
        minX: oldX - player.mass,
        minY: oldY - player.mass,
        maxX: oldX + player.mass,
        maxY: oldY + player.mass,
        player,
      },
      (a, b) => a.player.socketId === b.player.socketId
    );

    room.playerSpatialIndex.insert({
      minX: player.x - player.mass,
      minY: player.y - player.mass,
      maxX: player.x + player.mass,
      maxY: player.y + player.mass,
      player,
    });

    // Store last direction for bullet logic
    player.lastDx = dx;
    player.lastDy = dy;
  }

  broadcastGameState(io, gameId, roomId, room);
}

/**
 * Handle shooting bullets.
 */
function handleShootBullet(io, games, data) {
  const { gameId, roomId, socket, bulletType, direction, speed } = data;
  const game = games[gameId];
  if (!game) return;

  let room = game.activeRooms[roomId] || game.rooms[roomId];
  if (!room) return;

  const player = room.playersMap?.get(socket.id);
  if (!player || player.isDead) return;

  // Basic validation
  if (
    !direction ||
    typeof direction.x !== "number" ||
    typeof direction.y !== "number" ||
    !["charged", "fullyCharged"].includes(bulletType)
  ) {
    return; // Invalid data
  }

  let speedValue, radius, rangeLimit;
  switch (bulletType) {
    case "fullyCharged":
      speedValue = 30;
      radius = 25;
      rangeLimit = Infinity;
      break;
    case "charged":
      speedValue = 30;
      radius = 5;
      rangeLimit = Infinity;
      break;
    default:
      // "small" or unknown bullet type, ignoring for this example
      return;
  }

  // Ensure the direction is normalized
  const length =
    Math.sqrt(direction.x * direction.x + direction.y * direction.y) || 1;
  const vx = (direction.x / length) * speedValue;
  const vy = (direction.y / length) * speedValue;

  // Object Pool
  let bullet;
  if (room.bulletPool.length > 0) {
    bullet = room.bulletPool.pop();
    bullet.id = room.bulletIdCounter++;
    bullet.ownerId = player.socketId;
    bullet.x = player.x;
    bullet.y = player.y;
    bullet.vx = vx;
    bullet.vy = vy;
    bullet.radius = radius;
    bullet.traveled = 0;
    bullet.rangeLimit = rangeLimit;
    bullet.type = bulletType;
  } else {
    bullet = {
      id: room.bulletIdCounter++,
      ownerId: player.socketId,
      x: player.x,
      y: player.y,
      vx,
      vy,
      radius,
      traveled: 0,
      rangeLimit,
      type: bulletType,
    };
  }

  room.bullets.push(bullet);

  // Notify all clients in the room about the new bullet
  io.to(`${game.id}-${room.id}`).emit("bulletCreated", bullet);
}

/**
 * Ends the Agar.io room by performing cleanup.
 */
function endAgarIoRoom(game, room, games) {
  console.log(`[Server] Ending Agar.io room: ${room.id}`);

  // 1. Clear the bullet update interval
  if (room.bulletInterval) {
    clearInterval(room.bulletInterval);
    room.bulletInterval = null;
    console.log(`[Server] Cleared bulletInterval for roomId=${room.id}`);
  }

  // 2. Remove all bullets and recycle them
  if (room.bullets) {
    room.bullets.forEach((bullet) => {
      room.bulletPool.push(bullet);
    });
    room.bullets = [];
    console.log(`[Server] Removed all bullets for roomId=${room.id}`);
  }

  // 3. Reset player states and update spatial index
  if (room.playersMap) {
    room.playersMap.forEach((player) => {
      player.isDead = false;
      player.mass = 10;
      player.x = Math.floor(Math.random() * WORLD_WIDTH);
      player.y = Math.floor(Math.random() * WORLD_HEIGHT);
      player.lastDx = 0;
      player.lastDy = 0;

      // Remove old positions & re-insert if needed
      room.playerSpatialIndex.remove(
        {
          minX: player.x - player.mass,
          minY: player.y - player.mass,
          maxX: player.x + player.mass,
          maxY: player.y + player.mass,
          player,
        },
        (a, b) => a.player.socketId === b.player.socketId
      );

      room.playerSpatialIndex.insert({
        minX: player.x - player.mass,
        minY: player.y - player.mass,
        maxX: player.x + player.mass,
        maxY: player.y + player.mass,
        player,
      });
    });
    room.alivePlayers = new Set(room.playersMap.keys());
    console.log(`[Server] Reset player states for roomId=${room.id}`);
  }

  // 4. Remove the room from activeRooms
  if (game.activeRooms && game.activeRooms[room.id]) {
    delete game.activeRooms[room.id];
    console.log(`[Server] Removed roomId=${room.id} from activeRooms`);
  }

  // 5. Emit an event to notify clients that the game has ended
  game.io
    .to(`${game.id}-${room.id}`)
    .emit("gameEnded", { roomId: room.id, winner: room.winner });

  // 6. Broadcast the updated room list
  if (typeof broadcastRooms === "function") {
    broadcastRooms(game.id, games, game.io);
  }
}

/**
 * Periodically called to update all bullets (position, collisions, etc).
 */
function updateBullets(game, room, games) {
  if (!room.bullets || !room.playersMap) return;

  // For convenience
  const alivePlayers = Array.from(room.alivePlayers).map((id) =>
    room.playersMap.get(id)
  );

  // Iterate over bullets in reverse to safely remove items
  for (let i = room.bullets.length - 1; i >= 0; i--) {
    const b = room.bullets[i];

    // Move bullet
    b.x += b.vx;
    b.y += b.vy;

    // Increase traveled distance (use sqrt to add to traveled)
    const distTraveledSq = b.vx * b.vx + b.vy * b.vy;
    b.traveled += Math.sqrt(distTraveledSq);

    // Out-of-bounds or range limit
    if (
      b.x < 0 ||
      b.x > WORLD_WIDTH ||
      b.y < 0 ||
      b.y > WORLD_HEIGHT ||
      (b.rangeLimit !== Infinity && b.traveled >= b.rangeLimit)
    ) {
      // Recycle bullet
      room.bulletPool.push(b);
      room.bullets.splice(i, 1);
      continue;
    }

    // Spatial query: potential collisions
    const potentialPlayers = room.playerSpatialIndex.search({
      minX: b.x - b.radius,
      minY: b.y - b.radius,
      maxX: b.x + b.radius,
      maxY: b.y + b.radius,
    });

    let collisionDetected = false;

    for (const item of potentialPlayers) {
      const player = item.player;
      // Skip the bullet owner or dead players
      if (player.socketId === b.ownerId || player.isDead) continue;

      const dx = b.x - player.x;
      const dy = b.y - player.y;
      const distSq = dx * dx + dy * dy;
      const collisionDist = b.radius + player.mass;
      const collisionDistSq = collisionDist * collisionDist;

      if (distSq < collisionDistSq) {
        // Kill player
        player.isDead = true;
        room.alivePlayers.delete(player.socketId);
        console.log(
          `[Server] Player ${player.userName} was killed by bullet ${b.id}`
        );

        // Recycle bullet
        room.bulletPool.push(b);
        room.bullets.splice(i, 1);

        // Remove player from spatial index
        room.playerSpatialIndex.remove(
          {
            minX: player.x - player.mass,
            minY: player.y - player.mass,
            maxX: player.x + player.mass,
            maxY: player.y + player.mass,
            player,
          },
          (a, b) => a.player.socketId === b.player.socketId
        );

        collisionDetected = true;
        break;
      }
    }

    if (collisionDetected) {
      continue;
    }
  }

  // Check if only 1 or 0 players are alive => game over
  const stillAlive = Array.from(room.alivePlayers).map((id) =>
    room.playersMap.get(id)
  );

  if (stillAlive.length === 1 && !room.winner) {
    room.winner = stillAlive[0].userName;
    console.log(`[Server] Player ${room.winner} has won roomId=${room.id}`);
    // End the game
    endAgarIoRoom(game, room, games);
  } else if (stillAlive.length === 0 && !room.winner) {
    room.winner = null;
    console.log(`[Server] No players left alive in roomId=${room.id}`);
    // End the game
    endAgarIoRoom(game, room, games);
  }
}

/** Utility: clamp a value between min & max. */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

module.exports = {
  startAgarIoRoom,
  broadcastGameState,
  handlePlayerMove,
  handleShootBullet,
  endAgarIoRoom,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  TICK_RATE,
};
