export const fallbackStages = [
  {
    id: 1,
    level: 1,
    title: '첫 번째 불빛',
    difficulty: '튜토리얼',
    moveLimit: 5,
    board: ['P..G', '....', '....', '....']
  },
  {
    id: 2,
    level: 2,
    title: '막힌 복도',
    difficulty: '쉬움',
    moveLimit: 7,
    board: ['P...', '##..', '...G', '....']
  },
  {
    id: 3,
    level: 3,
    title: '우회로',
    difficulty: '쉬움',
    moveLimit: 10,
    board: ['P....', '.###.', '...#.', '.#.#.', '...G.']
  },
  {
    id: 4,
    level: 4,
    title: '낮은 벽',
    difficulty: '보통',
    moveLimit: 10,
    board: ['P#...', '.#.#.', '.#.#.', '...#G', '.....']
  },
  {
    id: 5,
    level: 5,
    title: '긴 외곽길',
    difficulty: '보통',
    moveLimit: 10,
    board: ['P.....', '.####.', '.#....', '.#.##.', '.#...G', '......']
  },
  {
    id: 6,
    level: 6,
    title: '되돌아가는 길',
    difficulty: '보통',
    moveLimit: 14,
    board: ['P..#..', '##.#..', '...#..', '.###.#', '.....G', '.#....']
  },
  {
    id: 7,
    level: 7,
    title: '빠듯한 계단',
    difficulty: '어려움',
    moveLimit: 13,
    board: ['P....#', '.###.#', '...#.#', '.#...#', '.#.###', '...G..']
  },
  {
    id: 8,
    level: 8,
    title: '좁은 허리',
    difficulty: '어려움',
    moveLimit: 15,
    board: ['P..#...', '##.#.#.', '...#.#.', '.###.#.', '......G', '.#####.', '.......']
  },
  {
    id: 9,
    level: 9,
    title: '정확한 루트',
    difficulty: '어려움',
    moveLimit: 11,
    board: ['P...#..', '###...#', '....#.#', '.##.#.#', '....#.G', '.##.#.#', '......#']
  },
  {
    id: 10,
    level: 10,
    title: '순간이동 탑',
    difficulty: '특수',
    moveLimit: 18,
    board: ['P#....G', '.#.###.', '.#...#.', '.###.#.', 'A....#.', '####.#.', 'A......']
  },
  {
    id: 11,
    level: 11,
    title: '열쇠의 문',
    difficulty: '특수',
    moveLimit: 11,
    board: ['P..K#.', '.##L#.', '....#.', '.##...', '....#G']
  },
  {
    id: 12,
    level: 12,
    title: '잠긴 우회로',
    difficulty: '특수',
    moveLimit: 15,
    board: ['P..#...', '##.#.#.', 'K..#.#.', '.###.#.', '...L..G', '.#####.', '.......']
  },
  {
    id: 13,
    level: 13,
    title: '열쇠와 포탈',
    difficulty: '상급',
    moveLimit: 12,
    board: ['P#.....', '.#.###.', '.#...#.', 'A###.#.', '.##L..G', 'A.K....', '#######']
  },
  {
    id: 14,
    level: 14,
    title: '두 번째 포탈',
    difficulty: '상급',
    moveLimit: 12,
    board: ['P#.....', '.#.###.', '.#B..#.', 'A###.#.', '.###L.G', 'A.K..B.', '#######']
  },
  {
    id: 15,
    level: 15,
    title: '마지막 첨탑',
    difficulty: '마스터',
    moveLimit: 12,
    board: ['P#......', '.#.####.', '.#B...#.', 'A###.#..', '.###L..G', 'A.K..B..', '####.###', '........']
  }
];
