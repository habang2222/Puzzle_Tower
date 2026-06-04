const directions = {
  up: { row: -1, col: 0 },
  down: { row: 1, col: 0 },
  left: { row: 0, col: -1 },
  right: { row: 0, col: 1 }
};

export function parseBoard(board, customBlocks = []) {
  const tiles = board.map((row) => row.split(''));
  const teleports = {};
  let player = null;
  let goal = null;

  tiles.forEach((row, rowIndex) => {
    row.forEach((tile, colIndex) => {
      const point = { row: rowIndex, col: colIndex };
      if (tile === 'P') {
        player = point;
        tiles[rowIndex][colIndex] = '.';
      }
      if (tile === 'G') {
        goal = point;
      }
      if (isTeleport(tile, customBlocks)) {
        teleports[tile] = [...(teleports[tile] || []), point];
      }
    });
  });

  return { tiles, player, goal, teleports };
}

export function createInitialGame(stage) {
  const customBlocks = normalizeCustomBlocks(stage.customBlocks || stage.blocks || []);
  const parsed = parseBoard(stage.board, customBlocks);
  return {
    ...parsed,
    stage,
    customBlocks,
    movesUsed: 0,
    status: 'playing',
    hasKey: false,
    message: '목표 지점까지 이동하세요.'
  };
}

export function movePlayer(game, directionName) {
  if (game.status !== 'playing') {
    return game;
  }

  const direction = directions[directionName];
  if (!direction) {
    return game;
  }

  const next = {
    row: game.player.row + direction.row,
    col: game.player.col + direction.col
  };

  const nextTile = getTile(game.tiles, next);
  const customBlock = getCustomBlock(game.customBlocks, nextTile);

  if (!nextTile || nextTile === '#' || customBlock?.effect === 'wall') {
    return { ...game, message: '벽은 지나갈 수 없습니다.' };
  }

  if ((nextTile === 'L' || customBlock?.effect === 'lock') && !game.hasKey) {
    return { ...game, message: '열쇠가 있어야 잠금 타일을 지나갈 수 있습니다.' };
  }

  let player = next;
  let hasKey = game.hasKey || nextTile === 'K' || customBlock?.effect === 'key';
  let tiles = game.tiles.map((row) => [...row]);
  let message = customBlock?.message || (nextTile === 'K' ? '열쇠를 획득했습니다.' : '좋습니다. 계속 이동하세요.');

  if (nextTile === 'K' || customBlock?.effect === 'key') {
    tiles[next.row][next.col] = '.';
  }

  if ((nextTile === 'L' || customBlock?.effect === 'lock') && hasKey) {
    tiles[next.row][next.col] = '.';
    message = '잠금 타일이 열렸습니다.';
  }

  if (customBlock?.effect === 'bounce') {
    player = game.player;
    message = customBlock.message || '튕겨 나왔습니다.';
  }

  if (isTeleport(nextTile, game.customBlocks)) {
    const pair = game.teleports[nextTile] || [];
    const exit = pair.find((point) => point.row !== next.row || point.col !== next.col);
    if (exit) {
      player = exit;
      message = '순간이동 타일을 탔습니다.';
    }
  }

  const moveCost = Math.max(Number(customBlock?.moveCost || 1), 1);
  const movesUsed = game.movesUsed + moveCost;
  const status =
    customBlock?.effect === 'goal' || (player.row === game.goal.row && player.col === game.goal.col)
      ? 'cleared'
      : movesUsed >= game.stage.moveLimit
        ? 'failed'
        : 'playing';

  if (status === 'cleared') {
    message = '스테이지 클리어!';
  }
  if (status === 'failed') {
    message = '이동 횟수를 모두 사용했습니다.';
  }

  return {
    ...game,
    tiles,
    player,
    movesUsed,
    hasKey,
    status,
    message
  };
}

export function calculateScore(stage, clearTime, movesUsed) {
  const remainingMoves = Math.max(stage.moveLimit - movesUsed, 0);
  const levelWeight = Math.min(stage.level, 30);
  return Math.max(levelWeight * 1000 + remainingMoves * 120 - clearTime * 8, levelWeight * 100);
}

function getTile(tiles, point) {
  if (point.row < 0 || point.col < 0 || point.row >= tiles.length) {
    return null;
  }
  return tiles[point.row][point.col] ?? null;
}

function isTeleport(tile, customBlocks = []) {
  if (getCustomBlock(customBlocks, tile)) {
    return false;
  }
  return /^[A-Z]$/.test(tile) && !['P', 'G', 'K', 'L'].includes(tile);
}

function normalizeCustomBlocks(blocks) {
  return Array.isArray(blocks) ? blocks.filter((block) => block && block.tile) : [];
}

function getCustomBlock(blocks, tile) {
  return normalizeCustomBlocks(blocks).find((block) => block.tile === tile || block.symbol === tile);
}
