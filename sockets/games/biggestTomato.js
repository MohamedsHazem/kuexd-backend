/************************************
 * sockets/games/biggestTomato.js
 ************************************/

const { shuffleDeck } = require("../../utils/cardsUtils");

/**
 * Called after countdown finishes, deals 5 cards to each player, and sets up turn.
 */
function startBiggestTomatoRoom(game, room) {
  if (!room.players || room.players.length === 0) return;

  console.log("[Server] startBiggestTomatoRoom -> Dealing cards now...");

  const deck = [
    "A",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "J",
    "Q",
    "K",
  ];
  shuffleDeck(deck);

  room.players.forEach((player) => {
    player.isDead = false;
    player.cards = deck.slice(0, 5);
    deck.splice(0, 5);
  });

  room.lastPlayedCard = null;
  room.currentPlayerIndex = 0;
  room.currentPlayerSocketId = room.players[0].socketId;
  room.winner = null; // reset if needed

  console.log(
    "[Server] startBiggestTomatoRoom -> Assigned 5 cards to each player:"
  );
  room.players.forEach((p) => {
    console.log(
      `   => socketId=${p.socketId}, userName=${
        p.userName
      }, cards=[${p.cards.join(", ")}]`
    );
  });
}

/**
 * Handle a 'playCard' event from a player
 */
function handlePlayCard(io, games, data) {
  const { gameId, roomId, socket, card } = data;
  const game = games[gameId];
  if (!game) return;

  // First look in activeRooms
  let room = game.activeRooms[roomId];
  // If not found there, maybe it's still in the lobby (unlikely once the game starts)
  if (!room) {
    room = game.rooms[roomId];
  }
  if (!room) {
    console.log(
      `[Server] handlePlayCard -> Room ${roomId} not found in gameId=${gameId}`
    );
    return;
  }

  console.log(
    `[Server] handlePlayCard -> from socket=${socket.id}, card=${card}`
  );

  // Enforce turn-based logic
  if (socket.id !== room.currentPlayerSocketId) {
    console.log(`[Server] handlePlayCard -> It's not your turn, ignoring.`);
    return;
  }

  const player = room.players.find((p) => p.socketId === socket.id);
  if (!player || player.isDead) {
    console.log(
      `[Server] handlePlayCard -> Player not found or is dead, ignoring.`
    );
    return;
  }

  console.log(`[Server] handlePlayCard: ${player.userName} played ${card}`);

  // Compare vs lastPlayedCard if any
  if (room.lastPlayedCard) {
    const isCardBigger = compareCards(card, room.lastPlayedCard);
    if (!isCardBigger) {
      player.isDead = true;
      console.log(
        `[Server] => smaller card => ${player.userName} is eliminated`
      );
    } else {
      room.lastPlayedCard = card;
      console.log(`[Server] => updated lastPlayedCard to ${card}`);
    }
  } else {
    // first card in the round
    room.lastPlayedCard = card;
    console.log(`[Server] => first card of the round: ${card}`);
  }

  // remove played card from player's hand
  player.cards = player.cards.filter((c) => c !== card);

  // move turn to the next alive player
  nextAlivePlayer(room);

  // check if game is over (1 or 0 alive players remain)
  const alivePlayers = room.players.filter((p) => !p.isDead);
  if (alivePlayers.length <= 1) {
    room.winner = alivePlayers.length === 1 ? alivePlayers[0].socketId : null;
    console.log(`[Server] => Game Over! winner=${room.winner || "None"}`);

    io.to(`${gameId}-${roomId}`).emit("gameOver", {
      winner: room.winner,
    });
    return;
  }

  // otherwise broadcast updated state
  broadcastGameState(io, gameId, roomId, room);
}

/**
 * Compare two card strings (e.g. 'A' vs '9' vs 'K')
 */
function compareCards(cardA, cardB) {
  const rankOrder = [
    "A",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "J",
    "Q",
    "K",
  ];
  const idxA = rankOrder.indexOf(cardA);
  const idxB = rankOrder.indexOf(cardB);
  // A bigger index => bigger card
  return idxA > idxB;
}

/**
 * Move room.currentPlayerIndex forward to next non-dead player
 */
function nextAlivePlayer(room) {
  let nextIndex = (room.currentPlayerIndex + 1) % room.players.length;
  for (let i = 0; i < room.players.length; i++) {
    const candidate = room.players[nextIndex];
    if (!candidate.isDead) {
      room.currentPlayerIndex = nextIndex;
      room.currentPlayerSocketId = candidate.socketId;
      console.log(
        `[Server] => nextAlivePlayer -> new turn: socketId=${candidate.socketId}`
      );
      return;
    }
    nextIndex = (nextIndex + 1) % room.players.length;
  }
}

/**
 * Broadcast the entire room state
 */
function broadcastGameState(io, gameId, roomId, room) {
  const channel = `${gameId}-${roomId}`;
  console.log(`[Server] broadcastGameState -> sending to room ${channel}`);

  io.to(channel).emit("gameStateUpdate", {
    roomId,
    players: room.players.map((p) => ({
      socketId: p.socketId,
      userName: p.userName,
      isDead: p.isDead,
      cards: p.cards || [],
    })),
    lastPlayedCard: room.lastPlayedCard || null,
    currentPlayerId: room.currentPlayerSocketId,
    winner: room.winner || null,
  });
}

module.exports = {
  startBiggestTomatoRoom,
  handlePlayCard,
  broadcastGameState,
};
