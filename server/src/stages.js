export const seedStages = [
  {
    level: 1,
    title: '첫 번째 불빛',
    difficulty: '튜토리얼',
    moveLimit: 5,
    board: ['P..G', '....', '....', '....']
  },
  {
    level: 2,
    title: '막힌 복도',
    difficulty: '쉬움',
    moveLimit: 7,
    board: ['P...', '##..', '...G', '....']
  },
  {
    level: 3,
    title: '우회로',
    difficulty: '쉬움',
    moveLimit: 10,
    board: ['P....', '.###.', '...#.', '.#.#.', '...G.']
  },
  {
    level: 4,
    title: '낮은 벽',
    difficulty: '보통',
    moveLimit: 10,
    board: ['P#...', '.#.#.', '.#.#.', '...#G', '.....']
  },
  {
    level: 5,
    title: '긴 외곽길',
    difficulty: '보통',
    moveLimit: 10,
    board: ['P.....', '.####.', '.#....', '.#.##.', '.#...G', '......']
  },
  {
    level: 6,
    title: '되돌아가는 길',
    difficulty: '보통',
    moveLimit: 14,
    board: ['P..#..', '##.#..', '...#..', '.###.#', '.....G', '.#....']
  },
  {
    level: 7,
    title: '빠듯한 계단',
    difficulty: '어려움',
    moveLimit: 13,
    board: ['P....#', '.###.#', '...#.#', '.#...#', '.#.###', '...G..']
  },
  {
    level: 8,
    title: '좁은 허리',
    difficulty: '어려움',
    moveLimit: 15,
    board: ['P..#...', '##.#.#.', '...#.#.', '.###.#.', '......G', '.#####.', '.......']
  },
  {
    level: 9,
    title: '정확한 루트',
    difficulty: '어려움',
    moveLimit: 11,
    board: ['P...#..', '###...#', '....#.#', '.##.#.#', '....#.G', '.##.#.#', '......#']
  },
  {
    level: 10,
    title: '순간이동 탑',
    difficulty: '특수',
    moveLimit: 18,
    board: ['P#....G', '.#.###.', '.#...#.', '.###.#.', 'A....#.', '####.#.', 'A......']
  },
  {
    level: 11,
    title: '열쇠의 문',
    difficulty: '특수',
    moveLimit: 11,
    board: ['P..K#.', '.##L#.', '....#.', '.##...', '....#G']
  },
  {
    level: 12,
    title: '잠긴 우회로',
    difficulty: '특수',
    moveLimit: 15,
    board: ['P..#...', '##.#.#.', 'K..#.#.', '.###.#.', '...L..G', '.#####.', '.......']
  },
  {
    level: 13,
    title: '열쇠와 포탈',
    difficulty: '상급',
    moveLimit: 12,
    board: ['P#.....', '.#.###.', '.#...#.', 'A###.#.', '.##L..G', 'A.K....', '#######']
  },
  {
    level: 14,
    title: '두 번째 포탈',
    difficulty: '상급',
    moveLimit: 12,
    board: ['P#.....', '.#.###.', '.#B..#.', 'A###.#.', '.###L.G', 'A.K..B.', '#######']
  },
  {
    level: 15,
    title: '마지막 첨탑',
    difficulty: '마스터',
    moveLimit: 12,
    board: ['P#......', '.#.####.', '.#B...#.', 'A###.#..', '.###L..G', 'A.K..B..', '####.###', '........']
  },
  {
    level: 16,
    title: 'Admin의 단 하나의 길',
    difficulty: 'Admin 극한',
    moveLimit: 28,
    tags: ['admin', 'extreme', 'one-path'],
    creatorNickname: 'Admin',
    board: [
      'PCDJJJJJJJ',
      'JJEJJJJJJJ',
      'JJFHIJJJJJ',
      'JJJJCJJJJJ',
      'JJJNMHMNJJ',
      'JJJOJCJODG',
      'JJJDEFJCQJ',
      'JJJJJFEDOJ',
      'JJJJJHIMNJ',
      'JJJJJJJJJJ'
    ],
    customBlocks: [
      { name: 'Chrono Gate', tile: 'C', color: '#38bdf8', effect: 'wall', moveCost: 1, failMessage: '시간이 맞지 않습니다.', if: [{ when: { direction: 'right', movesUsedAtLeast: 0, movesUsedAtMost: 0 }, effect: 'floor' }, { when: { direction: 'down', movesUsedAtLeast: 6, movesUsedAtMost: 6 }, effect: 'floor' }, { when: { direction: 'up', movesUsedAtLeast: 13, movesUsedAtMost: 13 }, effect: 'floor' }, { when: { direction: 'down', movesUsedAtLeast: 16, movesUsedAtMost: 16 }, effect: 'floor' }, { when: { direction: 'up', movesUsedAtLeast: 24, movesUsedAtMost: 24 }, effect: 'floor' }] },
      { name: 'Heavy Hourglass', tile: 'D', color: '#f97316', effect: 'wall', moveCost: 2, failMessage: '모래시계 타이밍이 맞지 않습니다.', if: [{ when: { direction: 'right', movesUsedAtLeast: 1, movesUsedAtMost: 1 }, effect: 'slow', moveCost: 2 }, { when: { direction: 'down', movesUsedAtLeast: 9, movesUsedAtMost: 9 }, effect: 'slow', moveCost: 2 }, { when: { direction: 'down', movesUsedAtLeast: 17, movesUsedAtMost: 17 }, effect: 'slow', moveCost: 2 }, { when: { direction: 'up', movesUsedAtLeast: 25, movesUsedAtMost: 25 }, effect: 'slow', moveCost: 2 }] },
      { name: 'Shard Key', tile: 'E', color: '#facc15', effect: 'wall', moveCost: 1, if: [{ when: { direction: 'down', movesUsedAtLeast: 3, movesUsedAtMost: 3 }, effect: 'key' }, { when: { direction: 'right', movesUsedAtLeast: 11, movesUsedAtMost: 11 }, effect: 'key' }, { when: { direction: 'left', movesUsedAtLeast: 19, movesUsedAtMost: 19 }, effect: 'key' }] },
      { name: 'Keyed Seal', tile: 'F', color: '#22c55e', effect: 'wall', moveCost: 1, if: [{ when: { hasKey: true, direction: 'down', movesUsedAtLeast: 4, movesUsedAtMost: 4 }, effect: 'lock' }, { when: { hasKey: true, direction: 'right', movesUsedAtLeast: 12, movesUsedAtMost: 12 }, effect: 'lock' }, { when: { hasKey: true, direction: 'left', movesUsedAtLeast: 20, movesUsedAtMost: 20 }, effect: 'lock' }] },
      { name: 'Vector Switch', tile: 'H', color: '#a855f7', effect: 'wall', moveCost: 1, if: [{ when: { direction: 'right', movesUsedAtLeast: 5, movesUsedAtMost: 5 }, effect: 'force', outDirection: 'right' }, { when: { direction: 'up', movesUsedAtLeast: 14, movesUsedAtMost: 14 }, effect: 'force', outDirection: 'right', spawn: [{ targetTile: 'Q', tile: 'C' }] }, { when: { direction: 'down', movesUsedAtLeast: 21, movesUsedAtMost: 21 }, effect: 'force', outDirection: 'right' }] },
      { name: 'Landing Rail', tile: 'I', color: '#06b6d4', effect: 'wall', moveCost: 1, if: [{ when: { direction: 'right', movesUsedAtLeast: 5, movesUsedAtMost: 5 }, effect: 'floor' }, { when: { direction: 'right', movesUsedAtLeast: 21, movesUsedAtMost: 21 }, effect: 'floor' }] },
      { name: 'Dead Static', tile: 'J', color: '#ef4444', effect: 'gameover', moveCost: 1, message: '정전 함정을 밟았습니다.' },
      { name: 'Mirror Landing', tile: 'M', color: '#14b8a6', effect: 'wall', moveCost: 1, if: [{ when: { direction: 'down', movesUsedAtLeast: 7, movesUsedAtMost: 7 }, effect: 'floor' }, { when: { direction: 'right', movesUsedAtLeast: 14, movesUsedAtMost: 14 }, effect: 'floor' }, { when: { direction: 'right', movesUsedAtLeast: 22, movesUsedAtMost: 22 }, effect: 'floor' }] },
      { name: 'Drop Vector', tile: 'N', color: '#8b5cf6', effect: 'wall', moveCost: 1, if: [{ when: { direction: 'left', movesUsedAtLeast: 8, movesUsedAtMost: 8 }, effect: 'force', outDirection: 'down' }, { when: { direction: 'right', movesUsedAtLeast: 15, movesUsedAtMost: 15 }, effect: 'force', outDirection: 'down' }, { when: { direction: 'right', movesUsedAtLeast: 23, movesUsedAtMost: 23 }, effect: 'force', outDirection: 'up' }] },
      { name: 'Vector Catch', tile: 'O', color: '#0ea5e9', effect: 'wall', moveCost: 1, if: [{ when: { direction: 'down', movesUsedAtLeast: 8, movesUsedAtMost: 8 }, effect: 'floor' }, { when: { direction: 'down', movesUsedAtLeast: 15, movesUsedAtMost: 15 }, effect: 'floor' }, { when: { direction: 'up', movesUsedAtLeast: 23, movesUsedAtMost: 23 }, effect: 'floor' }] },
      { name: 'Dormant Seal', tile: 'Q', color: '#64748b', effect: 'wall', moveCost: 1, failMessage: '아직 깨어나지 않은 봉인입니다.' }
    ]
  }
];
