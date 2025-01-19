/************************************
 * sockets/games/agarIo.js
 ************************************/

/** Dimensions of the world */
const WORLD_WIDTH = 900;
const WORLD_HEIGHT = 900;

/** Server update rate in milliseconds */
const TICK_RATE = 30; // ~30 FPS updates

/** Import necessary utilities */
const { broadcastRooms } = require("../../utils/gameUtils");

/**
 * Start the Agar.io-like room.
 * We remove the old food logic and add bullets.
 *
 * @param {Object} game - The game object.
 * @param {Object} room - The room object to start.
 * @param {Object} games - The master games object.
 */
function startAgarIoRoom(game, room, games) {
  console.log(
    `[Server] startAgarIoRoom (Agar.io) -> Setting initial positions for roomId=${room.id}`
  );

  // Spawn each player randomly with a default mass=10
  room.players.forEach((player) => {
    player.x = Math.floor(Math.random() * WORLD_WIDTH);
    player.y = Math.floor(Math.random() * WORLD_HEIGHT);
    player.mass = 10;
    player.isDead = false;
    // Track the player's last movement direction (dx/dy)
    // so we know which direction to fire bullets.
    player.lastDx = 0;
    player.lastDy = 0;
  });

  // No food in this variant — so we skip food initialization

  // Initialize bullets array
  room.bullets = [];
  // A simple incremental ID for each bullet
  room.bulletIdCounter = 1;

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
 *
 * @param {Object} io - The Socket.io server instance.
 * @param {Number} gameId - The ID of the game.
 * @param {Number} roomId - The ID of the room.
 * @param {Object} room - The room object containing game state.
 */
function broadcastGameState(io, gameId, roomId, room) {
  const channel = `${gameId}-${roomId}`;
  // We only broadcast players who are not "dead."
  // But you can also send them all if you prefer, marking dead players differently.
  const alivePlayers = room.players.filter((p) => !p.isDead);

  io.to(channel).emit("gameStateUpdate", {
    roomId,
    players: alivePlayers.map((p) => ({
      socketId: p.socketId,
      userName: p.userName,
      x: p.x,
      y: p.y,
      mass: p.mass,
    })),
    bullets: room.bullets.map((b) => ({
      id: b.id,
      ownerId: b.ownerId,
      x: b.x,
      y: b.y,
      radius: b.radius,
    })),
    winner: room.winner || null,
    worldSize: { width: WORLD_WIDTH, height: WORLD_HEIGHT },
  });
}

/**
 * Handle player movement from the client.
 * We store the last direction to know where to shoot bullets.
 *
 * @param {Object} io - The Socket.io server instance.
 * @param {Object} games - The master games object.
 * @param {Object} data - The data object containing movement information.
 */
function handlePlayerMove(io, games, data) {
  const { gameId, roomId, socket, direction } = data;
  const game = games[gameId];
  if (!game) return;

  let room = game.activeRooms[roomId] || game.rooms[roomId];
  if (!room) return;

  const player = room.players.find((p) => p.socketId === socket.id);
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
      dx = 0;
      dy = -step;
      break;
    case "down":
      dx = 0;
      dy = step;
      break;
    case "left":
      dx = -step;
      dy = 0;
      break;
    case "right":
      dx = step;
      dy = 0;
      break;
    default:
      dx = 0;
      dy = 0;
  }

  // Update player's position with clamp to keep within world bounds
  player.x = clamp(player.x + dx, 0, WORLD_WIDTH);
  player.y = clamp(player.y + dy, 0, WORLD_HEIGHT);

  // Track last direction (for bullet firing)
  if (dx !== 0 || dy !== 0) {
    player.lastDx = dx;
    player.lastDy = dy;
  }

  // Then broadcast new state
  broadcastGameState(io, gameId, roomId, room);
}

/**
 * Handle the event when a client shoots a bullet.
 * bulletType can be 'small', 'charged', or 'fullyCharged'.
 *
 * @param {Object} io - The Socket.io server instance.
 * @param {Object} games - The master games object.
 * @param {Object} data - The data object containing bullet information.
 */
function handleShootBullet(io, games, data) {
  const { gameId, roomId, socket, bulletType, direction, speed } = data;
  const game = games[gameId];
  if (!game) return;

  let room = game.activeRooms[roomId] || game.rooms[roomId];
  if (!room) return;

  const player = room.players.find((p) => p.socketId === socket.id);
  if (!player || player.isDead) return;

  // Basic validation
  if (
    !direction ||
    typeof direction.x !== "number" ||
    typeof direction.y !== "number" ||
    !["small", "charged", "fullyCharged"].includes(bulletType)
  ) {
    return; // Invalid data
  }

  // Determine bullet properties based on bulletType
  let speedValue = 10;
  let radius = 5;
  let rangeLimit = 200; // small bullet has short range

  switch (bulletType) {
    case "fullyCharged":
      speedValue = 26; // Customize as needed
      radius = 16; // Larger radius
      rangeLimit = Infinity; // Or set a very high limit
      break;
    case "charged":
      speedValue = 16;
      radius = 8;
      rangeLimit = Infinity;
      break;
    case "small":
    default:
      speedValue = 10;
      radius = 5;
      rangeLimit = 200;
      break;
  }

  // Use the direction sent by the client
  let dx = direction.x;
  let dy = direction.y;

  // Ensure the direction is normalized
  const length = Math.sqrt(dx * dx + dy * dy) || 1;
  const normalizedDx = dx / length;
  const normalizedDy = dy / length;

  // Apply speed
  const vx = normalizedDx * speedValue;
  const vy = normalizedDy * speedValue;

  // Create bullet
  const bullet = {
    id: room.bulletIdCounter++,
    ownerId: player.socketId,
    x: player.x,
    y: player.y,
    vx,
    vy,
    radius,
    traveled: 0,
    rangeLimit,
    type: bulletType, // Add type for client-side rendering
  };

  room.bullets.push(bullet);

  // Notify all clients in the room about the new bullet
  io.to(`${game.id}-${room.id}`).emit("bulletCreated", bullet);
}

/**
 * Ends the Agar.io room by performing cleanup.
 *
 * @param {Object} game - The game object.
 * @param {Object} room - The room object to clean up.
 * @param {Object} games - The master games object.
 */
function endAgarIoRoom(game, room, games) {
  console.log(`[Server] Ending Agar.io room: ${room.id}`);

  // 1. Clear the bullet update interval
  if (room.bulletInterval) {
    clearInterval(room.bulletInterval);
    room.bulletInterval = null;
    console.log(`[Server] Cleared bulletInterval for roomId=${room.id}`);
  }

  // 2. Remove all bullets
  if (room.bullets) {
    room.bullets = [];
    console.log(`[Server] Removed all bullets for roomId=${room.id}`);
  }

  // 3. Reset player states
  if (room.players) {
    room.players.forEach((player) => {
      player.isDead = false;
      player.mass = 10; // Reset to default mass or as needed
      player.x = Math.floor(Math.random() * WORLD_WIDTH);
      player.y = Math.floor(Math.random() * WORLD_HEIGHT);
      player.lastDx = 0;
      player.lastDy = 0;
    });
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

  // 6. Broadcast the updated room list to all clients
  if (typeof broadcastRooms === "function") {
    broadcastRooms(game.id, games, game.io);
  }
}

/**
 * Periodically called to update all bullets (position, collisions).
 * If a bullet collides with a player (not owner), that player is "killed."
 * Also checks if bullet has traveled beyond range or out of bounds.
 *
 * @param {Object} game - The game object.
 * @param {Object} room - The room object containing game state.
 * @param {Object} games - The master games object.
 */
function updateBullets(game, room, games) {
  if (!room.bullets) return;
  if (!room.players) return;

  const alivePlayers = room.players.filter((p) => !p.isDead);

  // Update bullet positions
  for (let i = room.bullets.length - 1; i >= 0; i--) {
    const b = room.bullets[i];

    // Move bullet
    b.x += b.vx;
    b.y += b.vy;

    // Increase traveled distance
    const distTraveled = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    b.traveled += distTraveled;

    // Check out-of-bounds or range limit
    if (
      b.x < 0 ||
      b.x > WORLD_WIDTH ||
      b.y < 0 ||
      b.y > WORLD_HEIGHT ||
      (b.rangeLimit !== Infinity && b.traveled >= b.rangeLimit)
    ) {
      // Remove this bullet
      room.bullets.splice(i, 1);
      continue;
    }

    // Check collision with players
    for (let j = 0; j < alivePlayers.length; j++) {
      const player = alivePlayers[j];
      if (player.socketId === b.ownerId) continue; // don't hit the owner

      const dist = distance(b.x, b.y, player.x, player.y);
      const collisionDist = b.radius + player.mass; // or tweak collision logic
      if (dist < collisionDist) {
        // Kill the player
        player.isDead = true;
        console.log(
          `[Server] Player ${player.userName} has been killed by bullet ${b.id}`
        );

        // Remove the bullet on impact
        room.bullets.splice(i, 1);
        break;
      }
    }
  }

  // Check if there's only one (or zero) players left alive => declare winner
  const stillAlive = room.players.filter((p) => !p.isDead);
  if (stillAlive.length === 1 && !room.winner) {
    // We have a winner
    room.winner = stillAlive[0].userName;
    console.log(`[Server] Player ${room.winner} has won roomId=${room.id}`);

    // Notify all clients in the room about the winner
    game.io
      .to(`${game.id}-${room.id}`)
      .emit("gameOver", { winner: room.winner });

    // Trigger the endGame process to perform cleanup
    endAgarIoRoom(game, room, games);
  }

  // Optionally, handle case when no players are left (all dead)
  if (stillAlive.length === 0 && !room.winner) {
    // No winners, game over with no winner
    room.winner = null;
    console.log(`[Server] Game over in roomId=${room.id} with no winners`);

    // Notify all clients in the room about the game over with no winner
    game.io.to(`${game.id}-${room.id}`).emit("gameOver", { winner: null });

    // Trigger the endGame process to perform cleanup
    endAgarIoRoom(game, room, games);
  }
}

/** Utility function: distance formula. */
function distance(x1, y1, x2, y2) {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Utility function: clamp a value between min & max. */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

module.exports = {
  startAgarIoRoom,
  broadcastGameState,
  handlePlayerMove,
  handleShootBullet,
  endAgarIoRoom, // Exported for use in other modules if needed
};
