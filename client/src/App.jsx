import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BarChart3,
  BookOpen,
  Code2,
  Crown,
  Download,
  DoorOpen,
  Eraser,
  Hammer,
  ImagePlus,
  KeyRound,
  ListRestart,
  Lock,
  LogIn,
  Pencil,
  Play,
  RotateCcw,
  Save,
  Shield,
  Sparkles,
  Trash2,
  Trophy,
  UploadCloud,
  User,
  UserPlus,
  X,
  Zap
} from 'lucide-react';
import { fallbackStages } from './data/stages.js';
import { calculateScore, createInitialGame, movePlayer } from './game/engine.js';
import {
  createStage,
  deleteCommunityStage,
  deleteCustomBlock,
  deleteStage,
  downloadCustomBlock,
  fetchHealth,
  fetchMe,
  fetchMyStages,
  fetchMyBlocks,
  fetchPublicBlocks,
  fetchRankings,
  fetchStages,
  getAuthToken,
  loginUser,
  publishCommunityStage,
  registerUser,
  saveRecord,
  setAuthToken,
  createCustomBlock,
  updateCommunityStage,
  updateCustomBlock,
  updateStage
} from './services/api.js';

const bestRecordKey = 'puzzle-tower-best-records';
const nicknameKey = 'puzzle-tower-nickname';
const blockLibraryKey = 'puzzle-tower-custom-blocks';
const basePalette = [
  { tile: '.', label: '길' },
  { tile: '#', label: '벽' },
  { tile: 'P', label: '시작' },
  { tile: 'G', label: '목표' },
  { tile: 'K', label: '열쇠' },
  { tile: 'L', label: '잠금' },
  { tile: 'A', label: '포탈 A' },
  { tile: 'B', label: '포탈 B' }
];
const defaultBlockCode = {
  name: '위쪽 게이트',
  tile: 'C',
  color: '#38bdf8',
  effect: 'oneway',
  moveCost: 1,
  outDirection: 'up',
  requires: {
    direction: 'up'
  },
  failMessage: '위 방향으로 움직일 때만 통과할 수 있습니다.',
  message: '위쪽 출구로 이동합니다.',
  if: [
    {
      when: {
        hasKey: true
      },
      effect: 'goal',
      message: '열쇠 조건으로 비밀 목표가 열렸습니다.'
    }
  ]
};

export default function App() {
  const [view, setView] = useState('home');
  const [nickname, setNickname] = useState(() => localStorage.getItem(nicknameKey) || 'player');
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState({ nickname: '', email: '', password: '' });
  const [authMessage, setAuthMessage] = useState('');
  const [stages, setStages] = useState(fallbackStages.map((stage) => ({ ...stage, isOfficial: true })));
  const [selectedStage, setSelectedStage] = useState({ ...fallbackStages[0], isOfficial: true });
  const [game, setGame] = useState(() => createInitialGame({ ...fallbackStages[0], isOfficial: true }));
  const [elapsed, setElapsed] = useState(0);
  const [apiOnline, setApiOnline] = useState(false);
  const [rankings, setRankings] = useState([]);
  const [rankingStageId, setRankingStageId] = useState('');
  const [bestRecords, setBestRecords] = useState(() => loadBestRecords());
  const [recordSaved, setRecordSaved] = useState(false);
  const [adminToken, setAdminToken] = useState('');
  const [adminDraft, setAdminDraft] = useState('');
  const [adminMessage, setAdminMessage] = useState('');
  const [builder, setBuilder] = useState(() => createBuilderState());
  const [selectedTile, setSelectedTile] = useState('#');
  const [builderMessage, setBuilderMessage] = useState('');
  const [myStages, setMyStages] = useState([]);
  const [customBlocks, setCustomBlocks] = useState(() => loadLocalBlocks());
  const [publicBlocks, setPublicBlocks] = useState([]);
  const [myBlocks, setMyBlocks] = useState([]);
  const [blockDraft, setBlockDraft] = useState(() => JSON.stringify(defaultBlockCode, null, 2));
  const [editingBlockId, setEditingBlockId] = useState(null);
  const [blockMessage, setBlockMessage] = useState('');
  const [blockGuideOpen, setBlockGuideOpen] = useState(false);

  const movesRemaining = selectedStage.moveLimit - game.movesUsed;
  const currentBest = bestRecords[selectedStage.id];
  const palette = useMemo(
    () => [
      ...basePalette,
      ...customBlocks.map((block) => ({
        tile: block.tile,
        label: block.name,
        custom: true,
        color: block.color,
        effect: block.effect
      }))
    ],
    [customBlocks]
  );

  const refreshStages = useCallback(async () => {
    const loadedStages = await fetchStages();
    if (!Array.isArray(loadedStages) || loadedStages.length === 0) {
      return [];
    }
    const normalized = loadedStages.map(normalizeStage).sort(sortStages);
    setStages(normalized);
    setSelectedStage((current) => normalized.find((stage) => stage.id === current.id) || normalized[0]);
    setGame((current) => (current.status === 'playing' ? current : createInitialGame(normalized[0])));
    return normalized;
  }, []);

  useEffect(() => {
    const token = getAuthToken();
    if (token) {
      fetchMe()
        .then(({ user: loadedUser }) => {
          setUser(loadedUser);
          setNickname(loadedUser.nickname);
        })
        .catch(() => setAuthToken(''));
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    fetchHealth()
      .then(() => {
        if (mounted) {
          setApiOnline(true);
        }
      })
      .catch(() => {
        if (mounted) {
          setApiOnline(false);
        }
      });

    refreshStages().catch(() => setApiOnline(false));

    return () => {
      mounted = false;
    };
  }, [refreshStages]);

  useEffect(() => {
    if (view !== 'game' || game.status !== 'playing') {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setElapsed((value) => value + 1);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [game.status, view]);

  useEffect(() => {
    localStorage.setItem(nicknameKey, (user?.nickname || nickname).trim() || 'player');
  }, [nickname, user]);

  useEffect(() => {
    if (view === 'builder' && user) {
      loadMyStages();
      loadMyBlocks();
    }
  }, [user, view]);

  useEffect(() => {
    if (view === 'builder') {
      loadPublicBlocks();
    }
  }, [view]);

  useEffect(() => {
    localStorage.setItem(blockLibraryKey, JSON.stringify(customBlocks));
  }, [customBlocks]);

  useEffect(() => {
    if (game.status !== 'cleared' || recordSaved) {
      return;
    }

    const score = calculateScore(selectedStage, elapsed, game.movesUsed);
    const playerName = user?.nickname || nickname.trim() || 'player';
    const record = {
      nickname: playerName,
      stageId: selectedStage.id,
      clearTime: elapsed,
      moveUsed: game.movesUsed
    };

    const nextBest = {
      ...bestRecords,
      [selectedStage.id]: chooseBetterRecord(bestRecords[selectedStage.id], {
        ...record,
        score,
        stageLevel: selectedStage.level
      })
    };

    setBestRecords(nextBest);
    localStorage.setItem(bestRecordKey, JSON.stringify(nextBest));
    setRecordSaved(true);

    saveRecord(record)
      .then(() => setApiOnline(true))
      .catch(() => setApiOnline(false));
  }, [bestRecords, elapsed, game.movesUsed, game.status, nickname, recordSaved, selectedStage, user]);

  const startStage = useCallback((stage) => {
    setSelectedStage(stage);
    setGame(createInitialGame(stage));
    setElapsed(0);
    setRecordSaved(false);
    setView('game');
  }, []);

  const restartStage = useCallback(() => {
    setGame(createInitialGame(selectedStage));
    setElapsed(0);
    setRecordSaved(false);
  }, [selectedStage]);

  const goNextStage = useCallback(() => {
    const nextStage = selectedStage.isOfficial ? stages.find((stage) => stage.isOfficial && stage.level === selectedStage.level + 1) : null;
    if (nextStage) {
      startStage(nextStage);
    } else {
      setView('stages');
    }
  }, [selectedStage, stages, startStage]);

  const handleMove = useCallback((direction) => {
    setGame((current) => movePlayer(current, direction));
  }, []);

  useEffect(() => {
    if (view !== 'game') {
      return undefined;
    }

    const onKeyDown = (event) => {
      const keyMap = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
        w: 'up',
        s: 'down',
        a: 'left',
        d: 'right'
      };

      const direction = keyMap[event.key];
      if (direction) {
        event.preventDefault();
        handleMove(direction);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleMove, view]);

  const loadRankings = useCallback(() => {
    fetchRankings(rankingStageId)
      .then((rows) => {
        setApiOnline(true);
        setRankings(rows);
      })
      .catch(() => {
        setApiOnline(false);
        setRankings([]);
      });
  }, [rankingStageId]);

  useEffect(() => {
    if (view === 'rankings') {
      loadRankings();
    }
  }, [loadRankings, view]);

  const loadMyStages = async () => {
    try {
      const rows = await fetchMyStages();
      setMyStages(rows.map(normalizeStage));
      setApiOnline(true);
    } catch (error) {
      setMyStages([]);
      setApiOnline(false);
    }
  };

  const loadPublicBlocks = async () => {
    try {
      const rows = await fetchPublicBlocks();
      setPublicBlocks(rows.map(normalizeCustomBlock));
      setApiOnline(true);
    } catch (error) {
      setPublicBlocks([]);
    }
  };

  const loadMyBlocks = async () => {
    try {
      const rows = await fetchMyBlocks();
      const normalized = rows.map(normalizeCustomBlock);
      setMyBlocks(normalized);
      mergeCustomBlocks(normalized);
      setApiOnline(true);
    } catch (error) {
      setMyBlocks([]);
    }
  };

  const mergeCustomBlocks = (blocks) => {
    setCustomBlocks((current) => mergeBlocks(current, blocks));
  };

  const saveBlockDraft = async () => {
    const parsed = parseBlockDraft(blockDraft);
    if (!parsed.ok) {
      setBlockMessage(parsed.message);
      return;
    }

    const block = normalizeCustomBlock(parsed.block);
    mergeCustomBlocks([block]);

    if (!user) {
      setBlockMessage('블록을 로컬 라이브러리에 저장했습니다. 공개 공유는 로그인 후 가능합니다.');
      return;
    }

    try {
      const saved = editingBlockId ? await updateCustomBlock(editingBlockId, block) : await createCustomBlock(block);
      const normalized = normalizeCustomBlock(saved);
      setEditingBlockId(normalized.id);
      mergeCustomBlocks([normalized]);
      await loadMyBlocks();
      await loadPublicBlocks();
      setBlockMessage(editingBlockId ? '블록이 수정되었습니다.' : '블록이 공개 라이브러리에 저장되었습니다.');
      setApiOnline(true);
    } catch (error) {
      setBlockMessage(error.message);
    }
  };

  const editCustomBlock = (block) => {
    const normalized = normalizeCustomBlock(block);
    setEditingBlockId(normalized.id || null);
    setBlockDraft(JSON.stringify(normalized.code, null, 2));
    mergeCustomBlocks([normalized]);
    setSelectedTile(normalized.tile);
    setBlockMessage('블록 코드를 편집 모드로 불러왔습니다.');
  };

  const removeCustomBlock = async (block) => {
    if (block.id && user) {
      try {
        await deleteCustomBlock(block.id);
        await loadMyBlocks();
        await loadPublicBlocks();
      } catch (error) {
        setBlockMessage(error.message);
        return;
      }
    }

    setCustomBlocks((current) => current.filter((item) => item.tile !== block.tile));
    if (selectedTile === block.tile) {
      setSelectedTile('#');
    }
    setBlockMessage('블록을 라이브러리에서 제거했습니다.');
  };

  const downloadBlock = async (block) => {
    try {
      const downloaded = block.id ? await downloadCustomBlock(block.id) : block;
      const normalized = normalizeCustomBlock(downloaded);
      mergeCustomBlocks([normalized]);
      setSelectedTile(normalized.tile);
      setBlockMessage('블록을 내 제작 팔레트에 추가했습니다.');
    } catch (error) {
      setBlockMessage(error.message);
    }
  };

  const attachBlockImage = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      setBlockMessage('png, jpg, webp, gif 이미지만 사용할 수 있습니다.');
      return;
    }
    if (file.size > 140000) {
      setBlockMessage('이미지는 140KB 이하로 줄여서 업로드하세요.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const parsed = safeJsonParse(blockDraft, defaultBlockCode);
      setBlockDraft(JSON.stringify({ ...parsed, image: reader.result }, null, 2));
      setBlockMessage('이미지를 블록 코드에 추가했습니다.');
    };
    reader.onerror = () => {
      setBlockMessage('이미지를 읽지 못했습니다.');
    };
    reader.readAsDataURL(file);
  };

  const submitAuth = async (event) => {
    event.preventDefault();
    setAuthMessage('');

    try {
      const result =
        authMode === 'signup'
          ? await registerUser(authForm)
          : await loginUser({ email: authForm.email, password: authForm.password });
      setAuthToken(result.token);
      setUser(result.user);
      setNickname(result.user.nickname);
      setAuthMessage('로그인되었습니다.');
      setView('builder');
    } catch (error) {
      setAuthMessage(error.message);
    }
  };

  const logout = () => {
    setAuthToken('');
    setUser(null);
    setMyStages([]);
    setView('home');
  };

  const openAdminEditor = (stage) => {
    setAdminMessage('');
    setAdminDraft(JSON.stringify(stageToDraft(stage), null, 2));
    setSelectedStage(stage);
    setView('admin');
  };

  const saveAdminStage = async () => {
    try {
      const parsed = JSON.parse(adminDraft);
      const payload = {
        level: Number(parsed.level),
        title: parsed.title,
        difficulty: parsed.difficulty,
        moveLimit: Number(parsed.moveLimit),
        board: parsed.board
      };
      const saved =
        parsed.id && stages.some((stage) => stage.id === parsed.id)
          ? await updateStage(parsed.id, payload, adminToken)
          : await createStage(payload, adminToken);

      const normalized = await refreshStages();
      setSelectedStage(normalized.find((stage) => stage.id === saved.id) || normalizeStage(saved));
      setAdminMessage('스테이지가 저장되었습니다.');
      setApiOnline(true);
    } catch (error) {
      setAdminMessage(error.message);
    }
  };

  const removeAdminStage = async () => {
    try {
      const parsed = JSON.parse(adminDraft);
      await deleteStage(parsed.id, adminToken);
      await refreshStages();
      setAdminMessage('스테이지가 삭제되었습니다.');
      setApiOnline(true);
    } catch (error) {
      setAdminMessage(error.message);
    }
  };

  const setBuilderField = (field, value) => {
    setBuilder((current) => ({ ...current, [field]: value }));
  };

  const resizeBuilder = (rows, cols) => {
    setBuilder((current) => {
      const nextRows = Number(rows);
      const nextCols = Number(cols);
      const board = Array.from({ length: nextRows }, (_, rowIndex) =>
        Array.from({ length: nextCols }, (_, colIndex) => current.board[rowIndex]?.[colIndex] || '.')
      );
      ensureSingleTile(board, 'P', 0, 0);
      ensureSingleTile(board, 'G', nextRows - 1, nextCols - 1);
      return { ...current, rows: nextRows, cols: nextCols, board };
    });
  };

  const paintBuilderTile = (rowIndex, colIndex) => {
    setBuilder((current) => {
      const board = current.board.map((row) => [...row]);
      if (selectedTile === 'P' || selectedTile === 'G') {
        board.forEach((row) => {
          row.forEach((tile, index) => {
            if (tile === selectedTile) {
              row[index] = '.';
            }
          });
        });
      }
      board[rowIndex][colIndex] = selectedTile;
      return { ...current, board };
    });
  };

  const clearBuilder = () => {
    setBuilder(createBuilderState());
    setSelectedTile('#');
    setBuilderMessage('');
  };

  const loadBuilderFromStage = (stage) => {
    const board = stage.board.map((row) => row.split(''));
    mergeCustomBlocks(stage.customBlocks || []);
    setBuilder({
      id: stage.id,
      title: stage.title,
      difficulty: stage.difficulty,
      moveLimit: stage.moveLimit,
      rows: board.length,
      cols: board[0]?.length || 6,
      board
    });
    setBuilderMessage('내 맵을 편집 모드로 불러왔습니다.');
    setView('builder');
  };

  const publishBuilder = async () => {
    if (!user) {
      setBuilderMessage('맵을 업로드하려면 로그인이 필요합니다.');
      setView('auth');
      return;
    }

    const validation = validateBuilder(builder);
    if (!validation.ok) {
      setBuilderMessage(validation.message);
      return;
    }

    const payload = {
      title: builder.title,
      difficulty: builder.difficulty,
      moveLimit: Number(builder.moveLimit),
      board: boardToStrings(builder.board),
      customBlocks: getUsedCustomBlocks(builder.board, customBlocks)
    };

    try {
      const saved = builder.id ? await updateCommunityStage(builder.id, payload) : await publishCommunityStage(payload);
      const normalized = normalizeStage(saved);
      const refreshed = await refreshStages();
      await loadMyStages();
      setSelectedStage(refreshed.find((stage) => stage.id === normalized.id) || normalized);
      setBuilder((current) => ({ ...current, id: normalized.id }));
      setBuilderMessage(builder.id ? '맵이 수정되었습니다.' : '맵이 업로드되었습니다. 다른 플레이어도 스테이지 목록에서 플레이할 수 있습니다.');
      setApiOnline(true);
    } catch (error) {
      setBuilderMessage(error.message);
    }
  };

  const removeMyStage = async (stageId) => {
    try {
      await deleteCommunityStage(stageId);
      await refreshStages();
      await loadMyStages();
      if (builder.id === stageId) {
        clearBuilder();
      }
      setBuilderMessage('내 맵을 삭제했습니다.');
    } catch (error) {
      setBuilderMessage(error.message);
    }
  };

  const stageStats = useMemo(
    () => ({
      total: stages.length,
      official: stages.filter((stage) => stage.isOfficial).length,
      community: stages.filter((stage) => !stage.isOfficial).length,
      cleared: Object.keys(bestRecords).length
    }),
    [bestRecords, stages]
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand-button" onClick={() => setView('home')} type="button">
          <Sparkles size={22} />
          <span>Puzzle Tower</span>
        </button>
        <nav className="nav-actions" aria-label="주요 메뉴">
          <button className={view === 'stages' ? 'active' : ''} onClick={() => setView('stages')} type="button">
            <DoorOpen size={18} />
            <span>스테이지</span>
          </button>
          <button className={view === 'builder' ? 'active' : ''} onClick={() => setView('builder')} type="button">
            <Hammer size={18} />
            <span>제작</span>
          </button>
          <button className={view === 'rankings' ? 'active' : ''} onClick={() => setView('rankings')} type="button">
            <Trophy size={18} />
            <span>랭킹</span>
          </button>
          <button className={view === 'admin' ? 'active' : ''} onClick={() => openAdminEditor(selectedStage)} type="button">
            <Shield size={18} />
            <span>관리</span>
          </button>
          <button className={view === 'auth' ? 'active' : ''} onClick={() => setView('auth')} type="button">
            {user ? <User size={18} /> : <LogIn size={18} />}
            <span>{user ? user.nickname : '로그인'}</span>
          </button>
        </nav>
      </header>

      <main>
        <AdSlot />
        {view === 'home' && (
          <section className="home-layout">
            <div className="intro-panel">
              <p className="eyebrow">FULL-STACK PUZZLE GAME</p>
              <h1>Puzzle Tower</h1>
              <p className="intro-copy">
                직접 만든 맵을 업로드하고, 다른 플레이어가 만든 퍼즐까지 도전하세요. 벽, 포탈, 열쇠, 잠금 타일로 경로를 설계할 수 있습니다.
              </p>
              <div className="nickname-row">
                <label htmlFor="nickname">플레이어</label>
                <input
                  disabled={Boolean(user)}
                  id="nickname"
                  maxLength={18}
                  onChange={(event) => setNickname(event.target.value)}
                  value={user?.nickname || nickname}
                />
              </div>
              <div className="hero-actions">
                <button className="primary" onClick={() => startStage(selectedStage)} type="button">
                  <Play size={18} />
                  <span>바로 시작</span>
                </button>
                <button onClick={() => setView('builder')} type="button">
                  <Hammer size={18} />
                  <span>맵 만들기</span>
                </button>
                {!user && (
                  <button onClick={() => setView('auth')} type="button">
                    <LogIn size={18} />
                    <span>로그인</span>
                  </button>
                )}
              </div>
            </div>

            <div className="tower-panel" aria-label="게임 요약">
              <div className="tower-card">
                <div>
                  <span>공식</span>
                  <strong>{stageStats.official}</strong>
                </div>
                <div>
                  <span>커뮤니티</span>
                  <strong>{stageStats.community}</strong>
                </div>
                <div>
                  <span>내 클리어</span>
                  <strong>{stageStats.cleared}</strong>
                </div>
              </div>
              <MiniBoard stage={selectedStage} />
              <StatusPill online={apiOnline} />
            </div>
          </section>
        )}

        {view === 'auth' && (
          <section className="screen-section auth-layout">
            <div className="section-heading">
              <div>
                <p className="eyebrow">PLAYER ACCOUNT</p>
                <h2>{user ? '계정' : authMode === 'signup' ? '회원가입' : '로그인'}</h2>
              </div>
              <StatusPill online={apiOnline} />
            </div>

            {user ? (
              <div className="auth-card">
                <div className="profile-row">
                  <div className="profile-avatar">{user.nickname.slice(0, 1).toUpperCase()}</div>
                  <div>
                    <h3>{user.nickname}</h3>
                    <p>{user.email || '게스트 계정'}</p>
                  </div>
                </div>
                <div className="hero-actions">
                  <button className="primary" onClick={() => setView('builder')} type="button">
                    <Hammer size={18} />
                    <span>내 맵 만들기</span>
                  </button>
                  <button onClick={logout} type="button">
                    <LogIn size={18} />
                    <span>로그아웃</span>
                  </button>
                </div>
              </div>
            ) : (
              <form className="auth-card" onSubmit={submitAuth}>
                <div className="auth-tabs">
                  <button className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')} type="button">
                    <LogIn size={17} />
                    <span>로그인</span>
                  </button>
                  <button className={authMode === 'signup' ? 'active' : ''} onClick={() => setAuthMode('signup')} type="button">
                    <UserPlus size={17} />
                    <span>회원가입</span>
                  </button>
                </div>
                {authMode === 'signup' && (
                  <>
                    <label htmlFor="signup-nickname">닉네임</label>
                    <input
                      id="signup-nickname"
                      maxLength={18}
                      onChange={(event) => setAuthForm((current) => ({ ...current, nickname: event.target.value }))}
                      value={authForm.nickname}
                    />
                  </>
                )}
                <label htmlFor="auth-email">이메일</label>
                <input
                  id="auth-email"
                  onChange={(event) => setAuthForm((current) => ({ ...current, email: event.target.value }))}
                  type="email"
                  value={authForm.email}
                />
                <label htmlFor="auth-password">비밀번호</label>
                <input
                  id="auth-password"
                  minLength={6}
                  onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))}
                  type="password"
                  value={authForm.password}
                />
                <div className="hero-actions">
                  <button className="primary" type="submit">
                    {authMode === 'signup' ? <UserPlus size={18} /> : <LogIn size={18} />}
                    <span>{authMode === 'signup' ? '가입하기' : '로그인'}</span>
                  </button>
                </div>
                {authMessage && <p className="admin-message">{authMessage}</p>}
              </form>
            )}
          </section>
        )}

        {view === 'stages' && (
          <section className="screen-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">STAGE SELECT</p>
                <h2>스테이지 선택</h2>
              </div>
              <StatusPill online={apiOnline} />
            </div>
            <div className="stage-grid">
              {stages.map((stage) => (
                <article className={stage.isOfficial ? 'stage-card' : 'stage-card community'} key={stage.id}>
                  <div className="stage-card-header">
                    <span>{stage.isOfficial ? `LEVEL ${stage.level}` : 'COMMUNITY'}</span>
                    <strong>{stage.difficulty}</strong>
                  </div>
                  <h3>{stage.title}</h3>
                  <MiniBoard stage={stage} compact />
                  <div className="stage-meta">
                    <span>{stage.moveLimit} moves</span>
                    <span>{stage.board.length} x {stage.board[0]?.length || 0}</span>
                  </div>
                  {!stage.isOfficial && <p className="stage-author">제작자: {stage.creatorNickname || 'player'}</p>}
                  <div className="stage-card-actions">
                    <button className="primary" onClick={() => startStage(stage)} type="button">
                      <Play size={16} />
                      <span>플레이</span>
                    </button>
                    {stage.isOfficial ? (
                      <button onClick={() => openAdminEditor(stage)} type="button">
                        <Pencil size={16} />
                        <span>수정</span>
                      </button>
                    ) : (
                      user?.id === stage.creatorId && (
                        <button onClick={() => loadBuilderFromStage(stage)} type="button">
                          <Pencil size={16} />
                          <span>내 맵 수정</span>
                        </button>
                      )
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {view === 'builder' && (
          <section className="screen-section builder-layout">
            <div className="section-heading">
              <div>
                <p className="eyebrow">MAP BUILDER</p>
                <h2>맵 제작</h2>
              </div>
              <StatusPill online={apiOnline} />
            </div>

            {!user ? (
              <div className="auth-card">
                <h3>로그인 후 맵을 업로드할 수 있습니다.</h3>
                <p className="intro-copy">회원가입 또는 이메일 로그인으로 접속하면 직접 만든 맵과 커스텀 블록이 서버에 저장되고 다른 플레이어도 사용할 수 있습니다.</p>
                <button className="primary" onClick={() => setView('auth')} type="button">
                  <LogIn size={18} />
                  <span>로그인하러 가기</span>
                </button>
              </div>
            ) : (
              <div className="builder-grid">
                <div className="builder-panel">
                  <label htmlFor="map-title">맵 이름</label>
                  <input id="map-title" maxLength={40} onChange={(event) => setBuilderField('title', event.target.value)} value={builder.title} />
                  <div className="builder-fields">
                    <div>
                      <label htmlFor="map-difficulty">난이도</label>
                      <input id="map-difficulty" maxLength={20} onChange={(event) => setBuilderField('difficulty', event.target.value)} value={builder.difficulty} />
                    </div>
                    <div>
                      <label htmlFor="map-moves">이동 제한</label>
                      <input
                        id="map-moves"
                        max={99}
                        min={1}
                        onChange={(event) => setBuilderField('moveLimit', event.target.value)}
                        type="number"
                        value={builder.moveLimit}
                      />
                    </div>
                    <div>
                      <label htmlFor="map-rows">행</label>
                      <input
                        id="map-rows"
                        max={10}
                        min={4}
                        onChange={(event) => resizeBuilder(event.target.value, builder.cols)}
                        type="number"
                        value={builder.rows}
                      />
                    </div>
                    <div>
                      <label htmlFor="map-cols">열</label>
                      <input
                        id="map-cols"
                        max={10}
                        min={4}
                        onChange={(event) => resizeBuilder(builder.rows, event.target.value)}
                        type="number"
                        value={builder.cols}
                      />
                    </div>
                  </div>
                  <div className="palette-row">
                    {palette.map((item) => (
                      <button
                        className={selectedTile === item.tile ? 'active' : ''}
                        key={item.tile}
                        onClick={() => setSelectedTile(item.tile)}
                        type="button"
                      >
                        <span className={`palette-chip ${tileClass(item.tile, customBlocks)}`} style={tileStyle(item.tile, customBlocks)}>
                          {tileLabel(item.tile, customBlocks) || item.tile}
                        </span>
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </div>
                  <div className="hero-actions">
                    <button className="primary" onClick={publishBuilder} type="button">
                      <UploadCloud size={18} />
                      <span>{builder.id ? '수정 업로드' : '업로드'}</span>
                    </button>
                    <button onClick={clearBuilder} type="button">
                      <Eraser size={18} />
                      <span>새 맵</span>
                    </button>
                  </div>
                  {builderMessage && <p className="admin-message">{builderMessage}</p>}
                </div>

                <div className="builder-board-wrap">
                  <BuilderBoard board={builder.board} customBlocks={customBlocks} onPaint={paintBuilderTile} />
                </div>

                <div className="my-map-panel">
                  <h3>내가 업로드한 맵</h3>
                  {myStages.length === 0 ? (
                    <p className="stage-author">아직 업로드한 맵이 없습니다.</p>
                  ) : (
                    <div className="my-map-list">
                      {myStages.map((stage) => (
                        <div className="my-map-item" key={stage.id}>
                          <MiniBoard stage={stage} compact />
                          <div>
                            <strong>{stage.title}</strong>
                            <span>{stage.moveLimit} moves</span>
                          </div>
                          <div className="my-map-actions">
                            <button onClick={() => startStage(stage)} type="button">
                              <Play size={16} />
                            </button>
                            <button onClick={() => loadBuilderFromStage(stage)} type="button">
                              <Pencil size={16} />
                            </button>
                            <button onClick={() => removeMyStage(stage.id)} type="button">
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="block-panel">
                  <div className="block-panel-title">
                    <h3>커스텀 블록 코드</h3>
                    <button onClick={() => setBlockGuideOpen(true)} type="button">
                      <BookOpen size={17} />
                      <span>설명서</span>
                    </button>
                  </div>
                  <textarea
                    className="block-code"
                    onChange={(event) => setBlockDraft(event.target.value)}
                    spellCheck="false"
                    value={blockDraft}
                  />
                  <div className="hero-actions">
                    <button className="primary" onClick={saveBlockDraft} type="button">
                      <Code2 size={18} />
                      <span>{editingBlockId ? '블록 수정' : '블록 저장'}</span>
                    </button>
                    <button
                      onClick={() => {
                        setEditingBlockId(null);
                        setBlockDraft(JSON.stringify(defaultBlockCode, null, 2));
                        setBlockMessage('');
                      }}
                      type="button"
                    >
                      <Eraser size={18} />
                      <span>새 블록</span>
                    </button>
                    <label className="image-upload-button" htmlFor="block-image-upload">
                      <ImagePlus size={18} />
                      <span>이미지</span>
                    </label>
                    <input
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="visually-hidden"
                      id="block-image-upload"
                      onChange={attachBlockImage}
                      type="file"
                    />
                  </div>
                  {blockMessage && <p className="admin-message">{blockMessage}</p>}
                  <div className="block-list">
                    <h4>내 팔레트</h4>
                    {customBlocks.length === 0 ? (
                      <p className="stage-author">저장한 커스텀 블록이 없습니다.</p>
                    ) : (
                      customBlocks.map((block) => (
                        <BlockItem
                          block={block}
                          key={`${block.id || 'local'}-${block.tile}`}
                          onDownload={downloadBlock}
                          onEdit={editCustomBlock}
                          onRemove={removeCustomBlock}
                        />
                      ))
                    )}
                  </div>
                  <div className="block-list">
                    <h4>공개 블록</h4>
                    {publicBlocks.length === 0 ? (
                      <p className="stage-author">서버에 공개된 블록이 아직 없습니다.</p>
                    ) : (
                      publicBlocks.map((block) => (
                        <BlockItem
                          block={block}
                          key={`public-${block.id}`}
                          onDownload={downloadBlock}
                          onEdit={editCustomBlock}
                        />
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {view === 'game' && (
          <section className="game-layout">
            <aside className="game-sidebar">
              <div>
                <p className="eyebrow">{selectedStage.isOfficial ? `LEVEL ${selectedStage.level}` : 'COMMUNITY MAP'}</p>
                <h2>{selectedStage.title}</h2>
                {!selectedStage.isOfficial && <p className="stage-author">제작자: {selectedStage.creatorNickname || 'player'}</p>}
              </div>
              <div className="stat-list">
                <Stat label="남은 이동" value={movesRemaining} />
                <Stat label="사용 이동" value={game.movesUsed} />
                <Stat label="시간" value={`${elapsed}s`} />
                <Stat label="최고 기록" value={currentBest ? `${currentBest.score}점` : '-'} />
              </div>
              <div className="inventory-row">
                <span className={game.hasKey ? 'inventory active' : 'inventory'}>
                  <KeyRound size={16} />
                  열쇠
                </span>
                <span className="inventory">
                  <Lock size={16} />
                  잠금
                </span>
                <span className="inventory">
                  <Zap size={16} />
                  포탈
                </span>
              </div>
              <p className="game-message">{game.message}</p>
              <div className="game-actions">
                <button onClick={restartStage} type="button">
                  <RotateCcw size={17} />
                  <span>다시 시작</span>
                </button>
                <button onClick={() => setView('stages')} type="button">
                  <DoorOpen size={17} />
                  <span>스테이지</span>
                </button>
              </div>
            </aside>

            <div className="board-zone">
              <GameBoard game={game} />
              <MovePad onMove={handleMove} />
            </div>

            {game.status !== 'playing' && (
              <ResultOverlay
                elapsed={elapsed}
                game={game}
                onNext={goNextStage}
                onRestart={restartStage}
                score={game.status === 'cleared' ? calculateScore(selectedStage, elapsed, game.movesUsed) : 0}
                stage={selectedStage}
              />
            )}
          </section>
        )}

        {view === 'rankings' && (
          <section className="screen-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">LEADERBOARD</p>
                <h2>전체 랭킹</h2>
              </div>
              <div className="ranking-tools">
                <select value={rankingStageId} onChange={(event) => setRankingStageId(event.target.value)}>
                  <option value="">전체 스테이지</option>
                  {stages.map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stage.isOfficial ? `Lv.${stage.level}` : '커뮤니티'} {stage.title}
                    </option>
                  ))}
                </select>
                <button onClick={loadRankings} type="button">
                  <ListRestart size={17} />
                  <span>새로고침</span>
                </button>
              </div>
            </div>
            <div className="ranking-table">
              <div className="ranking-row heading">
                <span>순위</span>
                <span>닉네임</span>
                <span>스테이지</span>
                <span>점수</span>
                <span>시간</span>
              </div>
              {rankings.length === 0 ? (
                <div className="empty-state">
                  <BarChart3 size={28} />
                  <p>저장된 서버 랭킹이 없습니다. 백엔드를 실행하고 기록을 저장해보세요.</p>
                </div>
              ) : (
                rankings.map((record, index) => (
                  <div className="ranking-row" key={record.id}>
                    <span>{index + 1}</span>
                    <span>{record.nickname}</span>
                    <span>{record.is_official === 0 ? '커뮤니티' : `Lv.${record.level}`}</span>
                    <span>{record.score}</span>
                    <span>{record.clear_time}s</span>
                  </div>
                ))
              )}
            </div>
          </section>
        )}

        {view === 'admin' && (
          <section className="screen-section admin-layout">
            <div className="section-heading">
              <div>
                <p className="eyebrow">ADMIN</p>
                <h2>공식 스테이지 관리</h2>
              </div>
              <StatusPill online={apiOnline} />
            </div>
            <div className="admin-grid">
              <div className="admin-list">
                {stages.filter((stage) => stage.isOfficial).map((stage) => (
                  <button key={stage.id} onClick={() => openAdminEditor(stage)} type="button">
                    <span>Lv.{stage.level}</span>
                    <strong>{stage.title}</strong>
                  </button>
                ))}
              </div>
              <div className="admin-editor">
                <label htmlFor="admin-token">관리자 토큰</label>
                <input
                  id="admin-token"
                  onChange={(event) => setAdminToken(event.target.value)}
                  placeholder="local default: admin123"
                  type="password"
                  value={adminToken}
                />
                <label htmlFor="stage-json">스테이지 JSON</label>
                <textarea
                  id="stage-json"
                  onChange={(event) => setAdminDraft(event.target.value)}
                  spellCheck="false"
                  value={adminDraft}
                />
                <div className="admin-actions">
                  <button className="primary" onClick={saveAdminStage} type="button">
                    <Save size={17} />
                    <span>저장</span>
                  </button>
                  <button onClick={removeAdminStage} type="button">
                    <Lock size={17} />
                    <span>삭제</span>
                  </button>
                </div>
                {adminMessage && <p className="admin-message">{adminMessage}</p>}
              </div>
            </div>
          </section>
        )}
      </main>
      {blockGuideOpen && <BlockGuide onClose={() => setBlockGuideOpen(false)} />}
    </div>
  );
}

function AdSlot() {
  useEffect(() => {
    try {
      window.adsbygoogle = window.adsbygoogle || [];
      window.adsbygoogle.push({});
    } catch (error) {
      // Ad blockers or local previews can block AdSense; the game should continue.
    }
  }, []);

  return (
    <aside className="ad-shell" aria-label="광고">
      <ins
        className="adsbygoogle"
        data-ad-client="ca-pub-3303941146778727"
        data-ad-slot="4790314323"
        style={{ display: 'inline-block', width: '360px', height: '800px' }}
      />
    </aside>
  );
}

function GameBoard({ game }) {
  const columns = game.tiles[0]?.length || 1;
  const customBlocks = game.customBlocks || [];

  return (
    <div className="board" style={{ '--columns': columns }}>
      {game.tiles.map((row, rowIndex) =>
        row.map((tile, colIndex) => {
          const isPlayer = game.player.row === rowIndex && game.player.col === colIndex;
          const className = ['tile', tileClass(tile, customBlocks), isPlayer ? 'player' : ''].filter(Boolean).join(' ');
          return (
            <div className={className} key={`${rowIndex}-${colIndex}`} style={tileStyle(tile, customBlocks)}>
              {isPlayer ? <Crown size={24} /> : tileLabel(tile, customBlocks)}
            </div>
          );
        })
      )}
    </div>
  );
}

function MovePad({ onMove }) {
  return (
    <div className="move-pad" aria-label="이동 버튼">
      <span />
      <button aria-label="위로 이동" onClick={() => onMove('up')} type="button">
        <ArrowUp size={20} />
      </button>
      <span />
      <button aria-label="왼쪽 이동" onClick={() => onMove('left')} type="button">
        <ArrowLeft size={20} />
      </button>
      <button aria-label="아래로 이동" onClick={() => onMove('down')} type="button">
        <ArrowDown size={20} />
      </button>
      <button aria-label="오른쪽 이동" onClick={() => onMove('right')} type="button">
        <ArrowRight size={20} />
      </button>
    </div>
  );
}

function MiniBoard({ compact = false, stage }) {
  const customBlocks = stage.customBlocks || [];
  return (
    <div className={compact ? 'mini-board compact' : 'mini-board'} style={{ '--columns': stage.board[0]?.length || 1 }}>
      {stage.board.flatMap((row, rowIndex) =>
        row.split('').map((tile, colIndex) => (
          <span className={tileClass(tile, customBlocks)} key={`${rowIndex}-${colIndex}`} style={tileStyle(tile, customBlocks)} />
        ))
      )}
    </div>
  );
}

function BuilderBoard({ board, customBlocks, onPaint }) {
  return (
    <div className="builder-board" style={{ '--columns': board[0]?.length || 1 }}>
      {board.map((row, rowIndex) =>
        row.map((tile, colIndex) => (
          <button
            className={`tile ${tileClass(tile, customBlocks)}`}
            key={`${rowIndex}-${colIndex}`}
            onClick={() => onPaint(rowIndex, colIndex)}
            style={tileStyle(tile, customBlocks)}
            type="button"
          >
            {tileLabel(tile, customBlocks)}
          </button>
        ))
      )}
    </div>
  );
}

function BlockItem({ block, onDownload, onEdit, onRemove }) {
  return (
    <div className="block-item">
      <span className="palette-chip custom" style={tileStyle(block.tile, [block])}>
        {block.tile}
      </span>
      <div>
        <strong>{block.name}</strong>
        <span>
          {block.effect}
          {block.outDirection ? ` ${block.outDirection}` : ''} · {block.moveCost} cost · {block.downloads || 0} downloads
        </span>
      </div>
      <div className="block-actions">
        <button aria-label={`${block.name} 다운로드`} onClick={() => onDownload(block)} type="button">
          <Download size={16} />
        </button>
        <button aria-label={`${block.name} 편집`} onClick={() => onEdit(block)} type="button">
          <Pencil size={16} />
        </button>
        {onRemove && (
          <button aria-label={`${block.name} 삭제`} onClick={() => onRemove(block)} type="button">
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

function BlockGuide({ onClose }) {
  return (
    <div className="block-guide-overlay" role="dialog" aria-modal="true" aria-label="커스텀 블록 코드 설명서">
      <div className="block-guide-dialog">
        <div className="block-guide-header">
          <div>
            <p className="eyebrow">CUSTOM BLOCK GUIDE</p>
            <h2>블록 코드 설명서</h2>
          </div>
          <button aria-label="설명서 닫기" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </div>

        <div className="guide-grid">
          <section>
            <h3>기본 필드</h3>
            <p>tile은 C~Z 한 글자입니다. A/B는 포탈 예약 문자라 사용할 수 없습니다.</p>
            <pre>{`{
  "name": "위쪽 게이트",
  "tile": "C",
  "color": "#38bdf8",
  "effect": "oneway",
  "moveCost": 1,
  "outDirection": "up",
  "message": "위쪽으로 이동합니다."
}`}</pre>
          </section>

          <section>
            <h3>조건과 if</h3>
            <p>requires는 조건을 못 맞추면 막고, if는 조건을 맞춘 첫 규칙으로 효과를 바꿉니다.</p>
            <pre>{`{
  "requires": { "direction": "up" },
  "failMessage": "위 방향으로만 통과할 수 있습니다.",
  "if": [
    {
      "when": { "hasKey": true },
      "effect": "goal",
      "message": "열쇠로 비밀 목표가 열렸습니다."
    }
  ]
}`}</pre>
          </section>

          <section>
            <h3>쓸 수 있는 값</h3>
            <p>direction은 up, down, left, right를 사용합니다.</p>
            <pre>{`effect:
floor, wall, slow, bounce,
key, lock, goal, force, oneway

condition:
hasKey
direction
movesUsedAtLeast / movesUsedAtMost
movesRemainingAtLeast / movesRemainingAtMost`}</pre>
          </section>

          <section>
            <h3>이미지</h3>
            <p>이미지 버튼을 누르면 image 필드가 자동으로 추가됩니다. 작은 png, jpg, webp, gif만 권장합니다.</p>
            <pre>{`{
  "name": "사진 벽",
  "tile": "W",
  "effect": "wall",
  "color": "#64748b",
  "image": "data:image/png;base64,..."
}`}</pre>
          </section>
        </div>
      </div>
    </div>
  );
}

function ResultOverlay({ elapsed, game, onNext, onRestart, score, stage }) {
  const cleared = game.status === 'cleared';

  return (
    <div className="result-overlay">
      <div className="result-dialog">
        <p className="eyebrow">{cleared ? 'STAGE CLEARED' : 'FAILED'}</p>
        <h2>{cleared ? '탑을 한 층 올랐습니다' : '다시 경로를 계산하세요'}</h2>
        <div className="result-stats">
          <Stat label="스테이지" value={stage.isOfficial ? `Lv.${stage.level}` : '커뮤니티'} />
          <Stat label="점수" value={cleared ? score : 0} />
          <Stat label="시간" value={`${elapsed}s`} />
          <Stat label="이동" value={`${game.movesUsed}/${stage.moveLimit}`} />
        </div>
        <div className="hero-actions">
          <button className="primary" onClick={cleared ? onNext : onRestart} type="button">
            {cleared ? <DoorOpen size={18} /> : <RotateCcw size={18} />}
            <span>{cleared ? '다음' : '재도전'}</span>
          </button>
          <button onClick={onRestart} type="button">
            <RotateCcw size={18} />
            <span>다시 시작</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusPill({ online }) {
  return <span className={online ? 'status-pill online' : 'status-pill'}>{online ? 'API 연결됨' : '로컬 모드'}</span>;
}

function normalizeStage(stage) {
  const boardData = stage.board_data || stage.boardData || stage.board;
  const isOfficial = stage.isOfficial ?? (stage.is_official === undefined ? true : stage.is_official !== 0);
  return {
    id: stage.id,
    level: stage.level,
    title: stage.title || `Level ${stage.level}`,
    difficulty: stage.difficulty,
    moveLimit: stage.moveLimit ?? stage.move_limit,
    board: typeof boardData === 'string' ? JSON.parse(boardData).board || JSON.parse(boardData) : boardData,
    customBlocks: Array.isArray(stage.customBlocks) ? stage.customBlocks.map(normalizeCustomBlock) : [],
    creatorId: stage.creatorId ?? stage.creator_id,
    creatorNickname: stage.creatorNickname ?? stage.creator_nickname,
    isOfficial,
    isPublic: stage.isPublic ?? (stage.is_public === undefined ? true : stage.is_public !== 0),
    playCount: stage.playCount ?? stage.play_count ?? 0
  };
}

function normalizeCustomBlock(block) {
  const code = typeof block.code === 'string' ? safeJsonParse(block.code, {}) : block.code || block;
  const image = String(code.image || code.imageData || block.image || block.imageData || '');
  const outDirection = normalizeDirectionValue(code.outDirection || code.exitDirection || block.outDirection || block.exitDirection || '');
  const requires = normalizeBlockCondition(code.requires || code.require || block.requires || block.require || null);
  const rules = normalizeBlockRules(code.if || code.rules || block.if || block.rules || []);
  return {
    id: block.id || null,
    userId: block.userId ?? block.user_id,
    creatorNickname: block.creatorNickname ?? block.creator_nickname,
    name: String(code.name || block.name || '커스텀').slice(0, 24),
    tile: String(code.tile || block.tile || 'C').slice(0, 1).toUpperCase(),
    color: String(code.color || block.color || '#a78bfa'),
    effect: String(code.effect || block.effect || 'slow').toLowerCase(),
    moveCost: Number(code.moveCost ?? block.moveCost ?? block.move_cost ?? 2),
    message: String(code.message || block.message || ''),
    failMessage: String(code.failMessage || block.failMessage || ''),
    exitFailMessage: String(code.exitFailMessage || block.exitFailMessage || ''),
    image,
    outDirection,
    requires,
    consumeOnUse: code.consumeOnUse === true || block.consumeOnUse === true,
    giveKey: code.giveKey === true || block.giveKey === true,
    takeKey: code.takeKey === true || block.takeKey === true,
    rules,
    isPublic: block.isPublic ?? (block.is_public === undefined ? true : block.is_public !== 0),
    downloads: block.downloads || 0,
    code: {
      name: String(code.name || block.name || '커스텀').slice(0, 24),
      tile: String(code.tile || block.tile || 'C').slice(0, 1).toUpperCase(),
      color: String(code.color || block.color || '#a78bfa'),
      effect: String(code.effect || block.effect || 'slow').toLowerCase(),
      moveCost: Number(code.moveCost ?? block.moveCost ?? block.move_cost ?? 2),
      message: String(code.message || block.message || ''),
      failMessage: String(code.failMessage || block.failMessage || ''),
      exitFailMessage: String(code.exitFailMessage || block.exitFailMessage || ''),
      image,
      outDirection,
      requires,
      consumeOnUse: code.consumeOnUse === true || block.consumeOnUse === true,
      giveKey: code.giveKey === true || block.giveKey === true,
      takeKey: code.takeKey === true || block.takeKey === true,
      if: rules
    }
  };
}

function parseBlockDraft(draft) {
  const parsed = safeJsonParse(draft, null);
  const allowedEffects = new Set(['slow', 'wall', 'bounce', 'goal', 'key', 'lock', 'floor', 'force', 'oneway']);
  const reservedTiles = new Set(['.', '#', 'P', 'G', 'K', 'L', 'A', 'B']);

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, message: '블록 코드는 JSON 객체여야 합니다.' };
  }

  const block = normalizeCustomBlock(parsed);

  if (!/^[C-Z]$/.test(block.tile) || reservedTiles.has(block.tile)) {
    return { ok: false, message: 'tile은 C~Z 중 예약되지 않은 한 글자여야 합니다.' };
  }
  if (!block.name.trim()) {
    return { ok: false, message: 'name이 필요합니다.' };
  }
  if (!allowedEffects.has(block.effect)) {
    return { ok: false, message: 'effect는 slow, wall, bounce, goal, key, lock, floor, force, oneway 중 하나여야 합니다.' };
  }
  if ((block.effect === 'force' || block.effect === 'oneway') && !block.outDirection) {
    return { ok: false, message: 'force/oneway 효과에는 outDirection이 필요합니다.' };
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(block.color)) {
    return { ok: false, message: 'color는 #RRGGBB 형식이어야 합니다.' };
  }
  if (!Number.isInteger(block.moveCost) || block.moveCost < 1 || block.moveCost > 9) {
    return { ok: false, message: 'moveCost는 1~9 사이의 정수여야 합니다.' };
  }
  if (block.image && !isValidBlockImage(block.image)) {
    return { ok: false, message: 'image는 180KB 이하의 png, jpg, webp, gif data URL이어야 합니다.' };
  }

  const conditionValidation = validateBlockCondition(parsed.requires || parsed.require || null);
  if (!conditionValidation.ok) {
    return conditionValidation;
  }

  const rulesValidation = validateBlockRules(parsed.if || parsed.rules || []);
  if (!rulesValidation.ok) {
    return rulesValidation;
  }

  return { ok: true, block };
}

function mergeBlocks(current, incoming) {
  const merged = new Map(current.map((block) => [block.tile, normalizeCustomBlock(block)]));
  incoming.map(normalizeCustomBlock).forEach((block) => {
    merged.set(block.tile, block);
  });
  return [...merged.values()].sort((a, b) => a.tile.localeCompare(b.tile));
}

function getUsedCustomBlocks(board, customBlocks) {
  const usedTiles = new Set(board.flat());
  return customBlocks.filter((block) => usedTiles.has(block.tile));
}

function sortStages(a, b) {
  if (a.isOfficial !== b.isOfficial) {
    return a.isOfficial ? -1 : 1;
  }
  return a.level - b.level;
}

function stageToDraft(stage) {
  return {
    id: stage.id,
    level: stage.level,
    title: stage.title,
    difficulty: stage.difficulty,
    moveLimit: stage.moveLimit,
    board: stage.board
  };
}

function createBuilderState() {
  return {
    id: null,
    title: '내 퍼즐 맵',
    difficulty: '커뮤니티',
    moveLimit: 12,
    rows: 6,
    cols: 6,
    board: [
      ['P', '.', '.', '.', '.', '.'],
      ['.', '#', '#', '.', '#', '.'],
      ['.', '.', '.', '.', '#', '.'],
      ['.', '#', '.', '#', '.', '.'],
      ['.', '#', '.', '.', '.', 'G'],
      ['.', '.', '.', '#', '.', '.']
    ]
  };
}

function ensureSingleTile(board, tile, fallbackRow, fallbackCol) {
  let found = false;
  board.forEach((row) => {
    row.forEach((value, index) => {
      if (value === tile) {
        if (found) {
          row[index] = '.';
        }
        found = true;
      }
    });
  });

  if (!found) {
    board[fallbackRow][fallbackCol] = tile;
  }
}

function boardToStrings(board) {
  return board.map((row) => row.join(''));
}

function validateBuilder(builder) {
  const board = boardToStrings(builder.board);
  const flat = board.join('');

  if (!builder.title.trim()) {
    return { ok: false, message: '맵 이름을 입력하세요.' };
  }
  if (!Number.isInteger(Number(builder.moveLimit)) || Number(builder.moveLimit) < 1) {
    return { ok: false, message: '이동 제한은 1 이상의 숫자여야 합니다.' };
  }
  if ((flat.match(/P/g) || []).length !== 1 || (flat.match(/G/g) || []).length !== 1) {
    return { ok: false, message: '시작 타일과 목표 타일은 각각 하나씩 필요합니다.' };
  }

  return { ok: true };
}

function normalizeBlockRules(rules) {
  if (!Array.isArray(rules)) {
    return [];
  }

  return rules
    .filter((rule) => rule && typeof rule === 'object')
    .slice(0, 8)
    .map((rule) => ({
      when: normalizeBlockCondition(rule.when || rule.condition || {}),
      ...(rule.effect === undefined ? {} : { effect: String(rule.effect).toLowerCase() }),
      ...(rule.moveCost === undefined ? {} : { moveCost: Number(rule.moveCost) }),
      ...(normalizeDirectionValue(rule.outDirection || rule.exitDirection) ? { outDirection: normalizeDirectionValue(rule.outDirection || rule.exitDirection) } : {}),
      ...(rule.message === undefined ? {} : { message: String(rule.message) }),
      ...(rule.failMessage === undefined ? {} : { failMessage: String(rule.failMessage) }),
      ...(rule.exitFailMessage === undefined ? {} : { exitFailMessage: String(rule.exitFailMessage) }),
      ...(rule.consumeOnUse === undefined ? {} : { consumeOnUse: rule.consumeOnUse === true }),
      ...(rule.giveKey === undefined ? {} : { giveKey: rule.giveKey === true }),
      ...(rule.takeKey === undefined ? {} : { takeKey: rule.takeKey === true })
    }));
}

function normalizeBlockCondition(condition) {
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) {
    return null;
  }

  const normalized = {};
  if (condition.hasKey !== undefined) {
    normalized.hasKey = condition.hasKey === true;
  }
  if (condition.direction !== undefined) {
    const directions = Array.isArray(condition.direction) ? condition.direction : [condition.direction];
    const normalizedDirections = directions.map(normalizeDirectionValue).filter(Boolean);
    if (normalizedDirections.length > 0) {
      normalized.direction = Array.isArray(condition.direction) ? normalizedDirections : normalizedDirections[0];
    }
  }

  ['movesUsedAtLeast', 'movesUsedAtMost', 'movesRemainingAtLeast', 'movesRemainingAtMost'].forEach((key) => {
    if (condition[key] !== undefined && Number.isFinite(Number(condition[key]))) {
      normalized[key] = Math.max(0, Math.min(Math.round(Number(condition[key])), 99));
    }
  });

  return Object.keys(normalized).length ? normalized : null;
}

function validateBlockCondition(condition) {
  if (!condition) {
    return { ok: true };
  }
  if (typeof condition !== 'object' || Array.isArray(condition)) {
    return { ok: false, message: '조건은 JSON 객체여야 합니다.' };
  }
  if (condition.direction !== undefined) {
    const directions = Array.isArray(condition.direction) ? condition.direction : [condition.direction];
    if (directions.map(normalizeDirectionValue).some((direction) => !direction)) {
      return { ok: false, message: 'direction은 up, down, left, right 중 하나여야 합니다.' };
    }
  }

  const numberKeys = ['movesUsedAtLeast', 'movesUsedAtMost', 'movesRemainingAtLeast', 'movesRemainingAtMost'];
  if (numberKeys.some((key) => condition[key] !== undefined && !Number.isFinite(Number(condition[key])))) {
    return { ok: false, message: '이동 횟수 조건은 숫자여야 합니다.' };
  }

  return { ok: true };
}

function validateBlockRules(rules) {
  if (!Array.isArray(rules)) {
    return { ok: false, message: 'if는 배열이어야 합니다.' };
  }

  const allowedEffects = new Set(['slow', 'wall', 'bounce', 'goal', 'key', 'lock', 'floor', 'force', 'oneway']);

  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') {
      return { ok: false, message: 'if 규칙은 JSON 객체여야 합니다.' };
    }
    const conditionValidation = validateBlockCondition(rule.when || rule.condition || {});
    if (!conditionValidation.ok) {
      return conditionValidation;
    }
    if (rule.effect !== undefined && !allowedEffects.has(String(rule.effect).toLowerCase())) {
      return { ok: false, message: 'if 규칙의 effect 값이 올바르지 않습니다.' };
    }
    const outDirection = normalizeDirectionValue(rule.outDirection || rule.exitDirection || '');
    const effect = String(rule.effect || '').toLowerCase();
    if ((effect === 'force' || effect === 'oneway') && !outDirection) {
      return { ok: false, message: 'if 규칙의 force/oneway 효과에는 outDirection이 필요합니다.' };
    }
    if ((rule.outDirection || rule.exitDirection) && !outDirection) {
      return { ok: false, message: 'if 규칙의 outDirection은 up, down, left, right 중 하나여야 합니다.' };
    }
  }

  return { ok: true };
}

function normalizeDirectionValue(value) {
  const direction = String(value || '').toLowerCase();
  return ['up', 'down', 'left', 'right'].includes(direction) ? direction : '';
}

function isValidBlockImage(image) {
  return (
    typeof image === 'string' &&
    image.length <= 180000 &&
    /^data:image\/(png|jpeg|jpg|webp|gif);base64,[a-zA-Z0-9+/=]+$/.test(image)
  );
}

function loadLocalBlocks() {
  try {
    return (JSON.parse(localStorage.getItem(blockLibraryKey)) || []).map(normalizeCustomBlock);
  } catch (error) {
    return [];
  }
}

function loadBestRecords() {
  try {
    return JSON.parse(localStorage.getItem(bestRecordKey)) || {};
  } catch (error) {
    return {};
  }
}

function chooseBetterRecord(previous, next) {
  if (!previous) {
    return next;
  }
  if (next.score > previous.score) {
    return next;
  }
  if (next.score === previous.score && next.clearTime < previous.clearTime) {
    return next;
  }
  return previous;
}

function tileClass(tile, customBlocks = []) {
  if (getCustomBlock(tile, customBlocks)) return 'custom';
  if (tile === '#') return 'wall';
  if (tile === 'G') return 'goal';
  if (tile === 'K') return 'key';
  if (tile === 'L') return 'lock';
  if (/^[A-Z]$/.test(tile) && !['P', 'G', 'K', 'L'].includes(tile)) return 'teleport';
  if (tile === 'P') return 'start';
  return 'floor';
}

function tileLabel(tile, customBlocks = []) {
  const customBlock = getCustomBlock(tile, customBlocks);
  if (customBlock) return customBlock.tile;
  if (tile === 'G') return 'G';
  if (tile === 'K') return 'K';
  if (tile === 'L') return 'L';
  if (tile === 'P') return 'P';
  if (/^[A-Z]$/.test(tile) && !['P', 'G', 'K', 'L'].includes(tile)) return tile;
  return '';
}

function tileStyle(tile, customBlocks = []) {
  const customBlock = getCustomBlock(tile, customBlocks);
  if (!customBlock) {
    return undefined;
  }
  const style = {
    '--custom-color': customBlock.color,
    backgroundColor: customBlock.color,
    borderColor: customBlock.color
  };

  if (customBlock.image) {
    style.backgroundImage = `linear-gradient(rgba(5, 8, 12, 0.08), rgba(5, 8, 12, 0.2)), url("${customBlock.image}")`;
    style.backgroundSize = 'cover';
    style.backgroundPosition = 'center';
  }

  return style;
}

function getCustomBlock(tile, customBlocks = []) {
  return customBlocks.find((block) => block.tile === tile);
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}
