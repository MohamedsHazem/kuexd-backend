/************************************
 * sockets/games/biggestTomato.js
 ************************************/
const { shuffleDeck } = require("../../utils/cardsUtils");

/**
 * Called after countdown, deals cards, sets up room.
 */
function startBiggestTomatoRoom(game, room) {
  if (!room.players || room.players.length === 0) return;

  console.log("[Server] startBiggestTomatoRoom -> Dealing cards...");

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

  // Deal 5 cards each
  room.players.forEach((player) => {
    player.isDead = false;
    player.cards = deck.slice(0, 5);
    deck.splice(0, 5);
  });

  room.playedCards = []; // store all played cards in order
  room.currentPlayerIndex = 0;
  room.currentPlayerSocketId = room.players[0].socketId;
  room.winner = null;

  console.log("[Server] Dealt 5 cards to each player:");
  room.players.forEach((p) => {
    console.log(`   => ${p.userName}, cards=[${p.cards.join(", ")}]`);
  });
}

/**
 * Player plays a card:
 * - If smaller than last, the player is eliminated
 * - Otherwise record it
 */
function handlePlayCard(io, games, data) {
  const { gameId, roomId, socket, card } = data;
  const game = games[gameId];
  if (!game) return;

  let room = game.activeRooms[roomId] || game.rooms[roomId];
  if (!room) {
    console.log(`[Server] handlePlayCard -> Room ${roomId} not found`);
    return;
  }

  // Enforce turn-based logic
  if (socket.id !== room.currentPlayerSocketId) {
    console.log("[Server] Not your turn, ignoring playCard.");
    return;
  }

  // Find player
  const player = room.players.find((p) => p.socketId === socket.id);
  if (!player || player.isDead) {
    console.log("[Server] Player not found or dead, ignoring.");
    return;
  }

  console.log(`[Server] ${player.userName} played ${card}`);

  // Compare with last card if any
  if (room.playedCards.length > 0) {
    const lastCard = room.playedCards[room.playedCards.length - 1];
    if (!compareCards(card, lastCard)) {
      player.isDead = true;
      console.log(
        `[Server] => smaller card => ${player.userName} is eliminated.`
      );
    }
  }

  // Record the new card
  room.playedCards.push(card);

  // Remove the card from player's hand
  player.cards = player.cards.filter((c) => c !== card);

  // Next alive player
  nextAlivePlayer(room);

  // Check if 1 or 0 alive => game over
  const alive = room.players.filter((p) => !p.isDead);
  if (alive.length <= 1) {
    room.winner = alive.length === 1 ? alive[0].socketId : null;
    console.log(`[Server] => Game Over! winner=${room.winner || "None"}`);

    io.to(`${gameId}-${roomId}`).emit("gameOver", { winner: room.winner });
    endBiggestTomatoRoom(game, room, games);
    return;
  }

  // Otherwise broadcast updated state
  broadcastGameState(io, gameId, roomId, room);
}

/**
 * Compare two cards by rank. Return true if cardA > cardB.
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
  return rankOrder.indexOf(cardA) > rankOrder.indexOf(cardB);
}

/**
 * Move turn forward to next non-dead player
 */
function nextAlivePlayer(room) {
  let nextIndex = (room.currentPlayerIndex + 1) % room.players.length;
  for (let i = 0; i < room.players.length; i++) {
    const candidate = room.players[nextIndex];
    if (!candidate.isDead) {
      room.currentPlayerIndex = nextIndex;
      room.currentPlayerSocketId = candidate.socketId;
      console.log(`[Server] => next turn: ${candidate.userName}`);
      return;
    }
    nextIndex = (nextIndex + 1) % room.players.length;
  }
}

/**
 * Broadcast to all clients in this room.
 *
 * NOTE: We only show the "second-to-last" card as `lastPlayedCard`,
 * and the entire older list as `playedCardHistory`.
 * The truly last card is hidden from the front-end.
 */
function broadcastGameState(io, gameId, roomId, room) {
  const channel = `${gameId}-${roomId}`;

  const played = room.playedCards;
  let displayedLastCard = null; // This is the "previous to last"
  let displayedHistory = []; // Everything older

  if (played.length >= 2) {
    // If we have at least 2 cards, the "last played" we display
    // is the second-to-last element
    displayedLastCard = played[played.length - 2];
  }
  if (played.length > 2) {
    // Everything up to (but not including) the second-to-last
    displayedHistory = played.slice(0, played.length - 2);
  }

  io.to(channel).emit("gameStateUpdate", {
    roomId,
    players: room.players.map((p) => ({
      socketId: p.socketId,
      userName: p.userName,
      isDead: p.isDead,
      cards: p.cards || [],
    })),
    lastPlayedCard: displayedLastCard, // The second-to-last card
    playedCardHistory: displayedHistory, // All older
    currentPlayerId: room.currentPlayerSocketId,
    winner: room.winner || null,
  });
}

/**
 * Cleanup
 */
function endBiggestTomatoRoom(game, room, games) {
  console.log(`[Server] endBiggestTomatoRoom -> cleaning up room ${room.id}`);
  if (game.activeRooms[room.id]) {
    delete game.activeRooms[room.id];
  }
}

module.exports = {
  startBiggestTomatoRoom,
  handlePlayCard,
  broadcastGameState,
  endBiggestTomatoRoom,
};
