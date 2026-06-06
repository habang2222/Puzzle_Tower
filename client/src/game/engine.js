const directions = {
  up: { row: -1, col: 0 },
  down: { row: 1, col: 0 },
  left: { row: 0, col: -1 },
  right: { row: 0, col: 1 }
};
const directionLabels = {
  up: '위',
  down: '아래',
  left: '왼쪽',
  right: '오른쪽'
};

export function parseBoard(board, customBlocks = []) {
  const safeBoard = Array.isArray(board) ? board : [];
  const tiles = safeBoard.map((row) => String(row || '').split(''));
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
  const playable = Boolean(parsed.player && parsed.goal && parsed.tiles.length);
  return {
    ...parsed,
    player: parsed.player || { row: 0, col: 0 },
    goal: parsed.goal || { row: 0, col: 0 },
    validBoard: playable,
    stage,
    customBlocks,
    movesUsed: 0,
    status: playable ? 'playing' : 'failed',
    hasKey: false,
    elapsedSeconds: 0,
    pendingSpawns: [],
    message: playable ? '목표 지점까지 이동하세요.' : '맵 데이터 오류: 시작 P와 목표 G가 필요합니다.'
  };
}

export function movePlayer(game, directionName, elapsedSeconds = game.elapsedSeconds || 0) {
  const currentGame = tickGame({ ...game, elapsedSeconds }, elapsedSeconds);

  if (currentGame.status !== 'playing') {
    return currentGame;
  }

  const direction = directions[directionName];
  if (!direction) {
    return currentGame;
  }

  const next = {
    row: currentGame.player.row + direction.row,
    col: currentGame.player.col + direction.col
  };

  const nextTile = getTile(currentGame.tiles, next);
  const customBlock = getCustomBlock(currentGame.customBlocks, nextTile);
  const customAction = customBlock ? resolveCustomBlockAction(customBlock, currentGame, directionName) : null;

  if (!nextTile || nextTile === '#' || customAction?.effect === 'wall') {
    return { ...currentGame, message: '벽은 지나갈 수 없습니다.' };
  }

  if (customAction?.blocked) {
    return { ...currentGame, message: customAction.failMessage || '조건을 만족해야 지나갈 수 있습니다.' };
  }

  if ((nextTile === 'L' || customAction?.effect === 'lock') && !currentGame.hasKey) {
    return { ...currentGame, message: '열쇠가 있어야 잠금 타일을 지나갈 수 있습니다.' };
  }

  let player = next;
  let hasKey = currentGame.hasKey || nextTile === 'K' || customAction?.effect === 'key' || customAction?.giveKey === true;
  let tiles = currentGame.tiles.map((row) => [...row]);
  let pendingSpawns = currentGame.pendingSpawns || [];
  let message = customAction?.message || (nextTile === 'K' ? '열쇠를 획득했습니다.' : '좋습니다. 계속 이동하세요.');

  if (customAction?.takeKey) {
    hasKey = false;
  }

  if (nextTile === 'K' || customAction?.effect === 'key' || customAction?.consumeOnUse) {
    tiles[next.row][next.col] = '.';
  }

  if ((nextTile === 'L' || customAction?.effect === 'lock') && hasKey) {
    tiles[next.row][next.col] = '.';
    message = '잠금 타일이 열렸습니다.';
  }

  if (customAction?.effect === 'bounce') {
    player = currentGame.player;
    message = customAction.message || '튕겨 나왔습니다.';
  }

  if (isTeleport(nextTile, currentGame.customBlocks)) {
    const pair = currentGame.teleports[nextTile] || [];
    const exit = pair.find((point) => point.row !== next.row || point.col !== next.col);
    if (exit) {
      player = exit;
      message = '순간이동 타일을 탔습니다.';
    }
  }

  if (customAction?.spawn?.length) {
    const spawnResult = applySpawnBundle(tiles, customAction.spawn, player, elapsedSeconds);
    tiles = spawnResult.tiles;
    pendingSpawns = [...pendingSpawns, ...spawnResult.pendingSpawns];
  }

  let forcedStatus = null;
  if (customAction && customAction.effect !== 'bounce' && customAction.effect !== 'gameover') {
    const forcedResult = applyForcedExit({ ...currentGame, tiles, player, hasKey, pendingSpawns }, customAction, elapsedSeconds);
    if (forcedResult) {
      player = forcedResult.player;
      hasKey = forcedResult.hasKey;
      tiles = forcedResult.tiles;
      pendingSpawns = forcedResult.pendingSpawns || pendingSpawns;
      message = forcedResult.message;
      forcedStatus = forcedResult.status || null;
    }
  }

  const moveCost = Math.max(Number(customAction?.moveCost || 1), 1);
  const movesUsed = currentGame.movesUsed + moveCost;
  const status =
    forcedStatus ||
    (customAction?.effect === 'gameover'
      ? 'failed'
      : customAction?.effect === 'goal' || (player.row === currentGame.goal.row && player.col === currentGame.goal.col)
      ? 'cleared'
      : movesUsed >= currentGame.stage.moveLimit
        ? 'failed'
        : 'playing');

  if (status === 'cleared') {
    message = '스테이지 클리어!';
  }
  if (status === 'failed' && customAction?.effect === 'gameover') {
    message = customAction.message || '위험 블록을 밟았습니다. 게임오버!';
  } else if (status === 'failed' && !forcedStatus) {
    message = '이동 횟수를 모두 사용했습니다.';
  }

  return {
    ...currentGame,
    tiles,
    player,
    movesUsed,
    hasKey,
    elapsedSeconds,
    pendingSpawns,
    status,
    message
  };
}

export function tickGame(game, elapsedSeconds = game.elapsedSeconds || 0) {
  if (!game.pendingSpawns?.length) {
    return { ...game, elapsedSeconds };
  }

  if (game.status !== 'playing') {
    return { ...game, elapsedSeconds };
  }

  let tiles = game.tiles;
  const remaining = [];
  let applied = 0;

  game.pendingSpawns.forEach((scheduled) => {
    if (scheduled.runAtSeconds <= elapsedSeconds) {
      tiles = applySpawnActions(tiles, [scheduled.spawn], game.player);
      applied += 1;
    } else {
      remaining.push(scheduled);
    }
  });

  return {
    ...game,
    elapsedSeconds,
    tiles,
    pendingSpawns: remaining,
    message: applied ? '시간 조건으로 블록이 변했습니다.' : game.message
  };
}

export function calculateScore(stage, clearTime, movesUsed) {
  const remainingMoves = Math.max(stage.moveLimit - movesUsed, 0);
  const levelWeight = Math.min(stage.level, 30);
  return Math.max(Math.round(levelWeight * 1000 + remainingMoves * 120 - clearTime * 8), levelWeight * 100);
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

function resolveCustomBlockAction(block, game, directionName) {
  const base = normalizeBlockAction(block);
  const context = createConditionContext(game, directionName);
  const matchedRule = base.rules.find((rule) => matchesCondition(rule.when, context));
  const action = normalizeBlockAction({ ...base, ...(matchedRule || {}) });

  if (action.requires && !matchesCondition(action.requires, context)) {
    return {
      ...action,
      blocked: true,
      failMessage: action.failMessage || '조건을 만족해야 이 블록을 사용할 수 있습니다.'
    };
  }

  return action;
}

function normalizeBlockAction(block) {
  return {
    ...block,
    effect: String(block?.effect || 'floor'),
    moveCost: Math.max(Number(block?.moveCost || 1), 1),
    outDirection: normalizeDirection(block?.outDirection || block?.exitDirection || ''),
    requires: normalizeCondition(block?.requires || block?.require || null),
    failMessage: String(block?.failMessage || ''),
    exitFailMessage: String(block?.exitFailMessage || ''),
    consumeOnUse: block?.consumeOnUse === true,
    giveKey: block?.giveKey === true,
    takeKey: block?.takeKey === true,
    spawn: normalizeSpawnItems(block?.spawn || block?.spawns || block?.change || block?.changes || []),
    rules: normalizeRules(block?.if || block?.rules || [])
  };
}

function normalizeRules(rules) {
  if (!Array.isArray(rules)) {
    return [];
  }

  return rules
    .filter((rule) => rule && typeof rule === 'object')
    .map((rule) => ({
      ...rule,
      when: normalizeCondition(rule.when || rule.condition || {})
    }));
}

function normalizeCondition(condition) {
  if (!condition || typeof condition !== 'object') {
    return null;
  }
  return {
    ...condition,
    ...(condition.elapsedSeconds !== undefined || condition.time !== undefined || condition.seconds !== undefined
      ? { elapsedSeconds: condition.elapsedSeconds ?? condition.time ?? condition.seconds }
      : {})
  };
}

function matchesCondition(condition, context) {
  if (!condition) {
    return true;
  }

  if (condition.hasKey !== undefined && Boolean(condition.hasKey) !== context.hasKey) {
    return false;
  }

  if (condition.direction !== undefined) {
    const allowed = Array.isArray(condition.direction) ? condition.direction : [condition.direction];
    if (!allowed.map(normalizeDirection).includes(context.direction)) {
      return false;
    }
  }

  if (condition.movesUsedAtLeast !== undefined && context.movesUsed < Number(condition.movesUsedAtLeast)) {
    return false;
  }
  if (condition.movesUsedAtMost !== undefined && context.movesUsed > Number(condition.movesUsedAtMost)) {
    return false;
  }
  if (condition.movesRemainingAtLeast !== undefined && context.movesRemaining < Number(condition.movesRemainingAtLeast)) {
    return false;
  }
  if (condition.movesRemainingAtMost !== undefined && context.movesRemaining > Number(condition.movesRemainingAtMost)) {
    return false;
  }
  if (condition.elapsedSeconds !== undefined && !matchesComparison(context.elapsedSeconds, condition.elapsedSeconds)) {
    return false;
  }

  return true;
}

function createConditionContext(game, directionName) {
  return {
    direction: normalizeDirection(directionName),
    hasKey: Boolean(game.hasKey),
    movesUsed: game.movesUsed,
    movesRemaining: Math.max(game.stage.moveLimit - game.movesUsed, 0),
    elapsedSeconds: Number(game.elapsedSeconds || 0)
  };
}

function matchesComparison(value, comparison) {
  const number = Number(value || 0);
  if (Number.isFinite(Number(comparison))) {
    return number <= Number(comparison);
  }
  if (!comparison || typeof comparison !== 'object') {
    return true;
  }

  if (comparison['>'] !== undefined && !(number > Number(comparison['>']))) {
    return false;
  }
  if (comparison['>='] !== undefined && !(number >= Number(comparison['>=']))) {
    return false;
  }
  if (comparison['<'] !== undefined && !(number < Number(comparison['<']))) {
    return false;
  }
  if (comparison['<='] !== undefined && !(number <= Number(comparison['<=']))) {
    return false;
  }
  return true;
}

function applySpawnBundle(tiles, spawns, origin, elapsedSeconds) {
  const normalized = normalizeSpawnItems(spawns);
  const immediate = normalized.filter((spawn) => !spawn.afterSeconds);
  const delayed = normalized.filter((spawn) => spawn.afterSeconds > 0);
  const nextTiles = immediate.length ? applySpawnActions(tiles, immediate, origin) : tiles;

  return {
    tiles: nextTiles,
    pendingSpawns: delayed.map((spawn) => ({
      runAtSeconds: elapsedSeconds + spawn.afterSeconds,
      spawn: prepareScheduledSpawn(spawn, origin)
    }))
  };
}

function prepareScheduledSpawn(spawn, origin) {
  if (spawn.targetTile || Number.isFinite(spawn.row) || Number.isFinite(spawn.col)) {
    return spawn;
  }

  const point = resolveSpawnPoint(spawn, origin);
  return point
    ? {
        ...spawn,
        row: point.row + 1,
        col: point.col + 1,
        relative: ''
      }
    : spawn;
}

function applySpawnActions(tiles, spawns, origin) {
  const nextTiles = tiles.map((row) => [...row]);

  normalizeSpawnItems(spawns).forEach((spawn) => {
    if (spawn.targetTile) {
      nextTiles.forEach((row) => {
        row.forEach((tile, index) => {
          if (tile === spawn.targetTile) {
            row[index] = spawn.tile;
          }
        });
      });
      return;
    }

    const point = resolveSpawnPoint(spawn, origin);
    if (point && getTile(nextTiles, point)) {
      nextTiles[point.row][point.col] = spawn.tile;
    }
  });

  return nextTiles;
}

function resolveSpawnPoint(spawn, origin) {
  if (Number.isFinite(spawn.row) && Number.isFinite(spawn.col)) {
    return {
      row: spawn.row - 1,
      col: spawn.col - 1
    };
  }

  if (spawn.relative === 'current') {
    return origin;
  }

  const direction = directions[spawn.relative];
  if (!direction) {
    return null;
  }

  const distance = Math.max(Math.min(Number(spawn.distance || 1), 9), 1);
  return {
    row: origin.row + direction.row * distance,
    col: origin.col + direction.col * distance
  };
}

function applyForcedExit(game, action, elapsedSeconds) {
  const directionName = normalizeDirection(action.outDirection || (action.effect === 'force' ? action.direction : ''));
  if (!directionName) {
    return null;
  }

  const direction = directions[directionName];
  const next = {
    row: game.player.row + direction.row,
    col: game.player.col + direction.col
  };
  const tile = getTile(game.tiles, next);
  const block = getCustomBlock(game.customBlocks, tile);
  const blockAction = block ? resolveCustomBlockAction(block, game, directionName) : null;

  if (!tile || tile === '#' || blockAction?.effect === 'wall' || blockAction?.blocked) {
    return {
      player: game.player,
      hasKey: game.hasKey,
      tiles: game.tiles,
      message: action.exitFailMessage || `${directionLabels[directionName]} 출구가 막혀 있습니다.`
    };
  }

  if ((tile === 'L' || blockAction?.effect === 'lock') && !game.hasKey) {
    return {
      player: game.player,
      hasKey: game.hasKey,
      tiles: game.tiles,
      message: '강제 이동 출구에 잠금 타일이 있습니다.'
    };
  }

  const tiles = game.tiles.map((row) => [...row]);
  let player = next;
  let hasKey = game.hasKey || tile === 'K' || blockAction?.effect === 'key' || blockAction?.giveKey === true;
  let pendingSpawns = game.pendingSpawns || [];

  if (tile === 'K' || blockAction?.effect === 'key') {
    tiles[next.row][next.col] = '.';
  }
  if ((tile === 'L' || blockAction?.effect === 'lock') && hasKey) {
    tiles[next.row][next.col] = '.';
  }

  if (blockAction?.spawn?.length) {
    const spawnResult = applySpawnBundle(tiles, blockAction.spawn, player, elapsedSeconds);
    spawnResult.tiles.forEach((row, rowIndex) => {
      tiles[rowIndex] = row;
    });
    pendingSpawns = [...pendingSpawns, ...spawnResult.pendingSpawns];
  }

  if (blockAction?.effect === 'gameover') {
    return {
      player,
      hasKey,
      tiles,
      pendingSpawns,
      status: 'failed',
      message: blockAction.message || '위험 블록을 밟았습니다. 게임오버!'
    };
  }

  if (isTeleport(tile, game.customBlocks)) {
    const pair = game.teleports[tile] || [];
    const exit = pair.find((point) => point.row !== next.row || point.col !== next.col);
    if (exit) {
      player = exit;
    }
  }

  return {
    player,
    hasKey,
    tiles,
    pendingSpawns,
    message: action.message || `${directionLabels[directionName]} 방향으로 이동했습니다.`
  };
}

function normalizeDirection(value) {
  const direction = String(value || '').toLowerCase();
  return directions[direction] ? direction : '';
}

function normalizeSpawnItems(spawn) {
  const items = Array.isArray(spawn) ? spawn : spawn ? [spawn] : [];

  return items
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const tile = normalizeSpawnTile(item.tile || item.to || item.place);
      const targetTile = normalizeSpawnTile(item.targetTile || item.replaceTile || item.from);
      const relativeValue = String(item.relative || item.direction || '').toLowerCase();
      const relative = relativeValue === 'current' ? 'current' : normalizeDirection(relativeValue);
      const row = Number(item.row);
      const col = Number(item.col);
      const distance = Math.max(Math.min(Number(item.distance || 1), 9), 1);
      const afterSeconds = Math.max(Math.min(Number(item.afterSeconds ?? item.after ?? 0), 99), 0);

      if (!tile) {
        return null;
      }

      return {
        tile,
        ...(targetTile ? { targetTile } : {}),
        ...(Number.isFinite(row) && Number.isFinite(col) ? { row: Math.round(row), col: Math.round(col) } : {}),
        ...(relative ? { relative } : {}),
        distance,
        afterSeconds
      };
    })
    .filter(Boolean);
}

function normalizeSpawnTile(value) {
  const tile = String(value || '').trim().slice(0, 1).toUpperCase();
  if (tile !== 'P' && (tile === '.' || tile === '#' || ['G', 'K', 'L'].includes(tile) || /^[C-Z]$/.test(tile))) {
    return tile;
  }
  return '';
}
