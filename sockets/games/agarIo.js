/************************************
 * sockets/games/agarIo.js
 ************************************/

/** Dimensions of the world */
const WORLD_WIDTH = 1080;
const WORLD_HEIGHT = 1080;

/** Server update rate in milliseconds */
const TICK_RATE = 45; // ~60 FPS updates

// We'll dynamically load RBush:
let RBush;
(async () => {
  const rbushModule = await import("rbush");
  RBush = rbushModule.default;
})();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Start the Agar.io-like room.
 *
 * @param {Object} game - The game object.
 * @param {Object} room - The room object to start.
 * @param {Object} games - The master games object.
 */
async function startAgarIoRoom(game, room, games) {
  // Wait for RBush to be loaded if not already
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
    player.lastDx = 0;
    player.lastDy = 0;

    room.playersMap.set(player.socketId, player);
    room.alivePlayers.add(player.socketId);
  });

  // No food in this variant

  // Initialize bullets array and object pool
  room.bullets = [];
  room.bulletIdCounter = 1;
  room.bulletPool = [];

  // Initialize spatial index
  room.playerSpatialIndex = new RBush();
  room.playersMap.forEach((player) => {
    room.playerSpatialIndex.insert({
      minX: player.x - player.mass,
      minY: player.y - player.mass,
      maxX: player.x + player.mass,
      maxY: player.y + player.mass,
      player,
    });
  });

  // Clear any existing intervals
  if (room.bulletInterval) {
    clearInterval(room.bulletInterval);
    console.log(
      `[Server] Cleared existing bulletInterval for roomId=${room.id}`
    );
  }

  // Start the bullet update loop
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

  const alivePlayers = Array.from(room.alivePlayers).map((socketId) =>
    room.playersMap.get(socketId)
  );

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
 * Handle player movement from the client (Agar.io).
 */
function handlePlayerMove(io, games, data) {
  const { gameId, roomId, socket, direction } = data;
  const game = games[gameId];
  if (!game) return;

  const room = game.activeRooms[roomId] || game.rooms[roomId];
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

  const oldX = player.x;
  const oldY = player.y;
  player.x = clamp(player.x + dx, 0, WORLD_WIDTH);
  player.y = clamp(player.y + dy, 0, WORLD_HEIGHT);

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
 * Handle shooting bullets (Agar.io).
 */
function handleShootBullet(io, games, data) {
  const { gameId, roomId, socket, bulletType, direction } = data;
  const game = games[gameId];
  if (!game) return;

  const room = game.activeRooms[roomId] || game.rooms[roomId];
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
      return;
  }

  // Normalize direction
  const length =
    Math.sqrt(direction.x * direction.x + direction.y * direction.y) || 1;
  const vx = (direction.x / length) * speedValue;
  const vy = (direction.y / length) * speedValue;

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

  io.to(`${game.id}-${room.id}`).emit("bulletCreated", bullet);
}

/**
 * Periodic bullet updates: movement, collisions, etc.
 */
function updateBullets(game, room, games) {
  if (!room.bullets || !room.playersMap) return;

  for (let i = room.bullets.length - 1; i >= 0; i--) {
    const b = room.bullets[i];
    b.x += b.vx;
    b.y += b.vy;

    // Distance traveled
    const distSq = b.vx * b.vx + b.vy * b.vy;
    b.traveled += Math.sqrt(distSq);

    // Out of bounds or range limit
    if (
      b.x < 0 ||
      b.x > WORLD_WIDTH ||
      b.y < 0 ||
      b.y > WORLD_HEIGHT ||
      (b.rangeLimit !== Infinity && b.traveled >= b.rangeLimit)
    ) {
      room.bulletPool.push(b);
      room.bullets.splice(i, 1);
      continue;
    }

    // Potential collisions
    const hits = room.playerSpatialIndex.search({
      minX: b.x - b.radius,
      minY: b.y - b.radius,
      maxX: b.x + b.radius,
      maxY: b.y + b.radius,
    });

    let collisionDetected = false;
    for (const item of hits) {
      const player = item.player;
      if (player.socketId === b.ownerId || player.isDead) continue;

      const dx = b.x - player.x;
      const dy = b.y - player.y;
      const distSq = dx * dx + dy * dy;
      const collisionDist = b.radius + player.mass;
      if (distSq < collisionDist * collisionDist) {
        player.isDead = true;
        room.alivePlayers.delete(player.socketId);

        room.bulletPool.push(b);
        room.bullets.splice(i, 1);

        // Remove from spatial index
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
        console.log(
          `[Server] Player ${player.userName} was killed by bullet ${b.id}`
        );
        break;
      }
    }
    if (collisionDetected) {
      continue;
    }
  }

  // Check if 0 or 1 players left
  if (room.alivePlayers.size <= 1 && !room.winner) {
    if (room.alivePlayers.size === 1) {
      const winnerId = [...room.alivePlayers][0];
      const winnerPlayer = room.playersMap.get(winnerId);
      room.winner = winnerPlayer ? winnerPlayer.userName : null;
      console.log(`[Server] Player ${room.winner} has won roomId=${room.id}`);
    } else {
      room.winner = null;
      console.log(`[Server] No players left alive in roomId=${room.id}`);
    }

    endAgarIoRoom(game, room, games);
  }
}

/**
 * Cleanup function for Agar.io
 */
function endAgarIoRoom(game, room, games) {
  console.log(`[Server] Ending Agar.io room: ${room.id}`);

  if (room.bulletInterval) {
    clearInterval(room.bulletInterval);
    room.bulletInterval = null;
    console.log(`[Server] Cleared bulletInterval for roomId=${room.id}`);
  }

  if (room.bullets) {
    room.bullets.forEach((bullet) => room.bulletPool.push(bullet));
    room.bullets = [];
  }

  if (room.playersMap) {
    // Optionally reset states, or just remove everything
    room.playersMap.forEach((player) => {
      player.isDead = false;
      player.mass = 10;
    });
  }

  // Remove from activeRooms
  if (game.activeRooms[room.id]) {
    delete game.activeRooms[room.id];
    console.log(`[Server] Removed roomId=${room.id} from activeRooms`);
  }

  // Notify clients
  game.io
    .to(`${game.id}-${room.id}`)
    .emit("gameEnded", { roomId: room.id, winner: room.winner });
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
