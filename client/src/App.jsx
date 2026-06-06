import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Map as MapIcon,
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
import { calculateScore, createInitialGame, movePlayer, tickGame } from './game/engine.js';
import {
  confirmPasswordReset,
  configureAdminLogin,
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
  requestPasswordReset,
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
  description: '이 블록 위에 서 있으면 위쪽으로만 빠져나갈 수 있습니다.',
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
  const [authForm, setAuthForm] = useState({ nickname: '', email: '', password: '', resetCode: '' });
  const [passwordResetStep, setPasswordResetStep] = useState('request');
  const [authMessage, setAuthMessage] = useState('');
  const [stages, setStages] = useState(fallbackStages.map((stage) => ({ ...stage, isOfficial: true })));
  const [selectedStage, setSelectedStage] = useState({ ...fallbackStages[0], isOfficial: true });
  const [game, setGame] = useState(() => createInitialGame({ ...fallbackStages[0], isOfficial: true }));
  const [elapsed, setElapsed] = useState(0);
  const timerStartRef = useRef(0);
  const [apiOnline, setApiOnline] = useState(false);
  const [rankings, setRankings] = useState([]);
  const [rankingStageId, setRankingStageId] = useState('');
  const [bestRecords, setBestRecords] = useState(() => loadBestRecords());
  const [recordSaved, setRecordSaved] = useState(false);
  const [adminToken, setAdminToken] = useState('');
  const [adminLoginForm, setAdminLoginForm] = useState({ email: '', password: '' });
  const [adminDraft, setAdminDraft] = useState('');
  const [adminMessage, setAdminMessage] = useState('');
  const [builder, setBuilder] = useState(() => createBuilderState());
  const [builderVerifiedHash, setBuilderVerifiedHash] = useState('');
  const [selectedTile, setSelectedTile] = useState('#');
  const [builderMessage, setBuilderMessage] = useState('');
  const [stageSearch, setStageSearch] = useState({ q: '', creator: '', tag: '' });
  const [blockSearch, setBlockSearch] = useState({ q: '', creator: '', tag: '' });
  const [myStages, setMyStages] = useState([]);
  const [customBlocks, setCustomBlocks] = useState(() => loadLocalBlocks());
  const [publicBlocks, setPublicBlocks] = useState([]);
  const [myBlocks, setMyBlocks] = useState([]);
  const [blockDraft, setBlockDraft] = useState(() => JSON.stringify(defaultBlockCode, null, 2));
  const [stageCodeDraft, setStageCodeDraft] = useState('');
  const [editingBlockId, setEditingBlockId] = useState(null);
  const [blockMessage, setBlockMessage] = useState('');
  const [blockGuideOpen, setBlockGuideOpen] = useState(false);
  const [showPathHint, setShowPathHint] = useState(false);

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

    if (!timerStartRef.current) {
      timerStartRef.current = performance.now() - elapsed * 1000;
    }

    let frameId = 0;
    const tick = () => {
      const nextElapsed = getElapsedFromTimer(timerStartRef.current);
      setElapsed(nextElapsed);
      setGame((current) => tickGame(current, nextElapsed));
      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);

    return () => window.cancelAnimationFrame(frameId);
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

    if (selectedStage.isDraft) {
      setBuilderVerifiedHash(selectedStage.builderHash || '');
      setBuilderMessage('테스트 클리어 완료. 이 상태 그대로 업로드할 수 있습니다.');
      setRecordSaved(true);
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
    const normalizedStage = normalizeStage(stage);
    timerStartRef.current = performance.now();
    setSelectedStage(normalizedStage);
    setGame(createInitialGame(normalizedStage));
    setElapsed(0);
    setRecordSaved(false);
    setShowPathHint(false);
    setView('game');
  }, []);

  const restartStage = useCallback(() => {
    timerStartRef.current = performance.now();
    setGame(createInitialGame(selectedStage));
    setElapsed(0);
    setRecordSaved(false);
    setShowPathHint(false);
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
    const currentElapsed = timerStartRef.current ? getElapsedFromTimer(timerStartRef.current) : elapsed;
    setElapsed(currentElapsed);
    setGame((current) => movePlayer(current, direction, currentElapsed));
  }, [elapsed]);

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

      const direction = keyMap[event.key] || keyMap[event.key.toLowerCase()];
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

  const loadPublicBlocks = async (filters = blockSearch) => {
    try {
      const rows = await fetchPublicBlocks(filters);
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

  const loadFilteredStages = async () => {
    try {
      const loadedStages = await fetchStages(stageSearch);
      const normalized = loadedStages.map(normalizeStage).sort(sortStages);
      setStages(normalized);
      setApiOnline(true);
    } catch (error) {
      setApiOnline(false);
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
      if (authMode === 'reset') {
        if (passwordResetStep === 'request') {
          const result = await requestPasswordReset({ email: authForm.email });
          setAuthMessage(result.resetCode ? `${result.message} 코드: ${result.resetCode}` : result.message);
          setAuthForm((current) => ({ ...current, resetCode: result.resetCode || current.resetCode, password: '' }));
          setPasswordResetStep('confirm');
          return;
        }

        const result = await confirmPasswordReset({
          email: authForm.email,
          resetCode: authForm.resetCode,
          password: authForm.password
        });
        setAuthMessage(result.message);
        setAuthMode('login');
        setPasswordResetStep('request');
        setAuthForm((current) => ({ ...current, password: '', resetCode: '' }));
        return;
      }

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
        board: parsed.board,
        tags: parsed.tags || [],
        customBlocks: parsed.customBlocks || [],
        visionRadius: normalizeVisionRadius(parsed.visionRadius ?? parsed.vision_radius ?? '')
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

  const saveAdminLogin = async () => {
    const token = adminToken.trim();
    const email = adminLoginForm.email.trim();
    if (!token) {
      setAdminMessage('관리자 토큰을 입력하세요. Render Environment의 ADMIN_TOKEN 값이며, 비밀번호가 아닙니다. 설정하지 않았다면 admin123입니다.');
      return;
    }
    if (!email || adminLoginForm.password.length < 6) {
      setAdminMessage('Admin 로그인 이메일과 6자 이상 비밀번호를 입력하세요.');
      return;
    }

    try {
      setAdminMessage('Admin 로그인 정보를 설정하는 중입니다.');
      const result = await configureAdminLogin({ ...adminLoginForm, email }, token);
      setAdminMessage(`${result.user.nickname} 로그인 정보가 설정되었습니다. 로그인 화면에서 다시 로그인하세요.`);
      setAuthForm((current) => ({ ...current, email, password: '' }));
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
      const nextRows = clampInteger(rows, 4, 10, current.rows || 6);
      const nextCols = clampInteger(cols, 4, 10, current.cols || 6);
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
    setBuilderVerifiedHash('');
    setStageCodeDraft('');
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
      tags: (stage.tags || []).join(', '),
      visionRadius: normalizeVisionRadius(stage.visionRadius ?? ''),
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

    const payload = createBuilderPayload(builder, customBlocks);
    const builderHash = createBuilderHash(payload);

    if (builderVerifiedHash !== builderHash) {
      setBuilderMessage('업로드 전에 현재 맵을 테스트 플레이로 1회 클리어해야 합니다.');
      return;
    }

    const verifiedPayload = {
      ...payload,
      clearHash: builderHash,
      creatorClearVerified: true
    };

    try {
      const saved = builder.id ? await updateCommunityStage(builder.id, verifiedPayload) : await publishCommunityStage(verifiedPayload);
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

  const testBuilder = () => {
    const validation = validateBuilder(builder);
    if (!validation.ok) {
      setBuilderMessage(validation.message);
      return;
    }

    const payload = createBuilderPayload(builder, customBlocks);
    const builderHash = createBuilderHash(payload);
    const draftStage = {
      id: `draft-${builderHash}`,
      level: 0,
      title: `${builder.title} 테스트`,
      difficulty: builder.difficulty,
      moveLimit: Number(builder.moveLimit),
      board: payload.board,
      customBlocks: payload.customBlocks,
      tags: payload.tags,
      visionRadius: payload.visionRadius,
      creatorId: user?.id,
      creatorNickname: user?.nickname,
      isOfficial: false,
      isDraft: true,
      builderHash
    };

    setSelectedStage(draftStage);
    timerStartRef.current = performance.now();
    setGame(createInitialGame(draftStage));
    setElapsed(0);
    setRecordSaved(false);
    setBuilderMessage('테스트 플레이를 시작했습니다. 클리어해야 업로드할 수 있습니다.');
    setView('game');
  };

  const exportBuilderCode = () => {
    const validation = validateBuilder(builder);
    if (!validation.ok) {
      setBuilderMessage(validation.message);
      return;
    }

    const payload = createBuilderPayload(builder, customBlocks);
    setStageCodeDraft(JSON.stringify(payload, null, 2));
    setBuilderMessage('현재 맵을 스테이지 코드로 만들었습니다.');
  };

  const applyStageCodeDraft = () => {
    const parsed = safeJsonParse(stageCodeDraft, null);
    if (!parsed || typeof parsed !== 'object') {
      setBuilderMessage('스테이지 코드는 JSON 객체여야 합니다.');
      return;
    }

    const boardRows = Array.isArray(parsed.board) ? parsed.board.map((row) => String(row || '')) : [];
    const width = boardRows[0]?.length || 0;
    if (boardRows.length < 4 || boardRows.length > 10 || width < 4 || width > 10 || boardRows.some((row) => row.length !== width)) {
      setBuilderMessage('board는 4~10칸 크기의 같은 길이 문자열 배열이어야 합니다.');
      return;
    }

    const draftBlocks = Array.isArray(parsed.customBlocks) ? parsed.customBlocks.map(normalizeCustomBlock) : [];
    if (draftBlocks.length) {
      mergeCustomBlocks(draftBlocks);
    }

    const nextBuilder = {
      id: null,
      title: String(parsed.title || '코드 스테이지').slice(0, 40),
      difficulty: String(parsed.difficulty || '코드').slice(0, 20),
      moveLimit: clampInteger(parsed.moveLimit ?? parsed.move_limit, 1, 99, 12),
      tags: parseTags(parsed.tags || []).join(', '),
      visionRadius: normalizeVisionRadius(parsed.visionRadius ?? parsed.vision_radius ?? ''),
      rows: boardRows.length,
      cols: width,
      board: boardRows.map((row) => row.split(''))
    };

    const validation = validateBuilder(nextBuilder);
    if (!validation.ok) {
      setBuilderMessage(validation.message);
      return;
    }

    setBuilder(nextBuilder);
    setBuilderVerifiedHash('');
    setBuilderMessage('스테이지 코드를 제작기에 적용했습니다. 업로드 전에 테스트 클리어가 필요합니다.');
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
              <div className="hero-actions">
                <button className="primary" onClick={() => startStage(selectedStage)} type="button">
                  <Play size={18} />
                  <span>게임 시작</span>
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
                <h2>{user ? '계정' : authMode === 'signup' ? '회원가입' : authMode === 'reset' ? '비밀번호 찾기' : '로그인'}</h2>
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
                  <button className={authMode === 'login' ? 'active' : ''} onClick={() => { setAuthMode('login'); setPasswordResetStep('request'); }} type="button">
                    <LogIn size={17} />
                    <span>로그인</span>
                  </button>
                  <button className={authMode === 'signup' ? 'active' : ''} onClick={() => { setAuthMode('signup'); setPasswordResetStep('request'); }} type="button">
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
                {authMode === 'reset' && passwordResetStep === 'confirm' && (
                  <>
                    <label htmlFor="reset-code">재설정 코드</label>
                    <input
                      id="reset-code"
                      inputMode="numeric"
                      maxLength={6}
                      onChange={(event) => setAuthForm((current) => ({ ...current, resetCode: event.target.value }))}
                      value={authForm.resetCode}
                    />
                  </>
                )}
                {(authMode !== 'reset' || passwordResetStep === 'confirm') && (
                  <>
                    <label htmlFor="auth-password">{authMode === 'reset' ? '새 비밀번호' : '비밀번호'}</label>
                    <input
                      id="auth-password"
                      minLength={6}
                      onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))}
                      type="password"
                      value={authForm.password}
                    />
                  </>
                )}
                <div className="hero-actions">
                  <button className="primary" type="submit">
                    {authMode === 'signup' ? <UserPlus size={18} /> : <LogIn size={18} />}
                    <span>{authMode === 'signup' ? '가입하기' : authMode === 'reset' ? (passwordResetStep === 'request' ? '코드 받기' : '비밀번호 변경') : '로그인'}</span>
                  </button>
                  {authMode !== 'reset' ? (
                    <button onClick={() => { setAuthMode('reset'); setPasswordResetStep('request'); setAuthMessage(''); }} type="button">
                      <KeyRound size={18} />
                      <span>비밀번호 찾기</span>
                    </button>
                  ) : (
                    <button onClick={() => { setAuthMode('login'); setPasswordResetStep('request'); setAuthMessage(''); }} type="button">
                      <LogIn size={18} />
                      <span>로그인으로</span>
                    </button>
                  )}
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
            <div className="search-panel">
              <input
                aria-label="맵 이름 검색"
                onKeyDown={(event) => runOnEnter(event, loadFilteredStages)}
                onChange={(event) => setStageSearch((current) => ({ ...current, q: event.target.value }))}
                placeholder="맵 이름/난이도 검색"
                value={stageSearch.q}
              />
              <input
                aria-label="제작자 검색"
                onKeyDown={(event) => runOnEnter(event, loadFilteredStages)}
                onChange={(event) => setStageSearch((current) => ({ ...current, creator: event.target.value }))}
                placeholder="제작자 검색"
                value={stageSearch.creator}
              />
              <input
                aria-label="태그 검색"
                onKeyDown={(event) => runOnEnter(event, loadFilteredStages)}
                onChange={(event) => setStageSearch((current) => ({ ...current, tag: event.target.value }))}
                placeholder="태그 검색"
                value={stageSearch.tag}
              />
              <button onClick={loadFilteredStages} type="button">
                <ListRestart size={17} />
                <span>검색</span>
              </button>
              <button
                onClick={() => {
                  setStageSearch({ q: '', creator: '', tag: '' });
                  refreshStages();
                }}
                type="button"
              >
                <Eraser size={17} />
                <span>초기화</span>
              </button>
            </div>
            <p className="result-count">검색 결과 {stages.length}개</p>
            <div className="stage-grid">
              {stages.length === 0 ? (
                <div className="empty-state">
                  <DoorOpen size={28} />
                  <p>조건에 맞는 스테이지가 없습니다.</p>
                </div>
              ) : stages.map((stage) => (
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
                  {stage.tags?.length > 0 && <TagList tags={stage.tags} />}
                  {stage.creatorNickname && <p className="stage-author">제작자: {stage.creatorNickname}</p>}
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
                      <label htmlFor="map-tags">태그</label>
                      <input id="map-tags" maxLength={80} onChange={(event) => setBuilderField('tags', event.target.value)} placeholder="예: hard, logic" value={builder.tags} />
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
                      <label htmlFor="map-vision">시야 반경</label>
                      <input
                        id="map-vision"
                        max={10}
                        min={0}
                        onChange={(event) => setBuilderField('visionRadius', event.target.value)}
                        placeholder="빈칸 = 전체 보기"
                        type="number"
                        value={builder.visionRadius}
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
                    <button onClick={testBuilder} type="button">
                      <Play size={18} />
                      <span>{builderVerifiedHash === createBuilderHash(createBuilderPayload(builder, customBlocks)) ? '클리어 확인됨' : '테스트 플레이'}</span>
                    </button>
                    <button className="primary" onClick={publishBuilder} type="button">
                      <UploadCloud size={18} />
                      <span>{builder.id ? '수정 업로드' : '업로드'}</span>
                    </button>
                    <button onClick={clearBuilder} type="button">
                      <Eraser size={18} />
                      <span>새 맵</span>
                    </button>
                  </div>
                  <div className="stage-code-panel">
                    <div className="block-panel-title">
                      <h3>스테이지 코드</h3>
                      <button onClick={exportBuilderCode} type="button">
                        <Code2 size={17} />
                        <span>현재 맵 코드</span>
                      </button>
                    </div>
                    <textarea
                      className="stage-code"
                      onChange={(event) => setStageCodeDraft(event.target.value)}
                      placeholder="JSON 코드만으로 스테이지를 만들 수 있습니다."
                      spellCheck="false"
                      value={stageCodeDraft}
                    />
                    <button onClick={applyStageCodeDraft} type="button">
                      <MapIcon size={17} />
                      <span>코드로 맵 적용</span>
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
                    <div className="mini-search-panel">
                      <input
                        aria-label="블록 검색"
                        onChange={(event) => setBlockSearch((current) => ({ ...current, q: event.target.value }))}
                        placeholder="블록 이름/효과"
                        value={blockSearch.q}
                      />
                      <input
                        aria-label="블록 제작자 검색"
                        onChange={(event) => setBlockSearch((current) => ({ ...current, creator: event.target.value }))}
                        placeholder="제작자"
                        value={blockSearch.creator}
                      />
                      <input
                        aria-label="블록 태그 검색"
                        onChange={(event) => setBlockSearch((current) => ({ ...current, tag: event.target.value }))}
                        placeholder="태그"
                        value={blockSearch.tag}
                      />
                      <button onClick={() => loadPublicBlocks(blockSearch)} type="button">
                        <ListRestart size={16} />
                      </button>
                    </div>
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
                {selectedStage.creatorNickname && <p className="stage-author">제작자: {selectedStage.creatorNickname}</p>}
              </div>
              <div className="stat-list">
                <Stat label="남은 이동" value={movesRemaining} />
                <Stat label="사용 이동" value={game.movesUsed} />
                <Stat label="시간" value={formatTime(elapsed)} />
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
                <button className={showPathHint ? 'active' : ''} onClick={() => setShowPathHint((value) => !value)} type="button">
                  <MapIcon size={17} />
                  <span>경로 힌트</span>
                </button>
              </div>
            </aside>

            <div className="board-zone">
              <GameBoard game={game} showPathHint={showPathHint} />
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
                    <span>{formatTime(record.clear_time)}</span>
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
                <label htmlFor="admin-token">관리자 설정 토큰</label>
                <input
                  id="admin-token"
                  onChange={(event) => setAdminToken(event.target.value)}
                  placeholder="Render ADMIN_TOKEN 값. 설정하지 않았다면 admin123"
                  type="password"
                  value={adminToken}
                />
                <p className="field-help">이 값은 Admin 로그인 비밀번호가 아니라 서버 관리자 설정용 토큰입니다.</p>
                <div className="admin-login-box">
                  <label htmlFor="admin-login-email">Admin 로그인 이메일</label>
                  <input
                    id="admin-login-email"
                    onChange={(event) => setAdminLoginForm((current) => ({ ...current, email: event.target.value }))}
                    type="email"
                    value={adminLoginForm.email}
                  />
                  <label htmlFor="admin-login-password">Admin 로그인 비밀번호</label>
                  <input
                    id="admin-login-password"
                    minLength={6}
                    onChange={(event) => setAdminLoginForm((current) => ({ ...current, password: event.target.value }))}
                    type="password"
                    value={adminLoginForm.password}
                  />
                  <button onClick={saveAdminLogin} type="button">
                    <UserPlus size={17} />
                    <span>Admin 로그인 설정</span>
                  </button>
                </div>
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
  const pushedRef = useRef(false);
  useEffect(() => {
    if (pushedRef.current) {
      return;
    }
    pushedRef.current = true;
    try {
      window.adsbygoogle = window.adsbygoogle || [];
      window.adsbygoogle.push({});
    } catch (error) {
      if (import.meta.env.DEV) {
        console.debug('AdSense preview failed:', error);
      }
    }
  }, []);

  return (
    <aside className="ad-shell" aria-label="광고">
      <ins
        className="adsbygoogle"
        data-ad-client="ca-pub-3303941146778727"
        data-ad-slot="4790314323"
        data-ad-format="auto"
        data-full-width-responsive="true"
        style={{ display: 'block' }}
      />
    </aside>
  );
}

function GameBoard({ game, showPathHint = false }) {
  const columns = game.tiles[0]?.length || 1;
  const customBlocks = game.customBlocks || [];
  const currentBlock = getCurrentPlayerBlock(game);
  const pathCells = showPathHint ? new Set(findPathToGoal(game).slice(1).map((point) => pointKey(point))) : new Set();

  if (!game.validBoard || !game.player || !game.goal || !game.tiles.length) {
    return (
      <div className="board-error">
        <strong>맵 데이터 오류</strong>
        <p>시작 타일 P와 목표 타일 G가 각각 하나씩 있는지 확인하세요.</p>
      </div>
    );
  }

  return (
    <div className="board-stack">
      <div className="board" style={{ '--columns': columns }}>
        {game.tiles.map((row, rowIndex) =>
          row.map((tile, colIndex) => {
            const isPlayer = game.player.row === rowIndex && game.player.col === colIndex;
            const point = { row: rowIndex, col: colIndex };
            const fogged = isFogged(game, point);
            const className = [
              'tile',
              tileClass(tile, customBlocks),
              fogged ? 'fogged' : '',
              pathCells.has(pointKey(point)) && !fogged ? 'path-hint' : '',
              isPlayer ? 'player' : ''
            ].filter(Boolean).join(' ');
            return (
              <div className={className} key={`${rowIndex}-${colIndex}`} style={tileStyle(tile, customBlocks)}>
                {fogged ? '' : isPlayer ? <Crown size={24} /> : tileLabel(tile, customBlocks)}
              </div>
            );
          })
        )}
      </div>
      <BlockDescriptionPanel block={currentBlock} />
    </div>
  );
}

function BlockDescriptionPanel({ block }) {
  if (!block) {
    return null;
  }

  const description = block.description || createBlockSummary(block);
  return (
    <aside className="block-description" style={{ '--hint-color': block.color }} aria-live="polite">
      <span className="block-description-chip" style={tileStyle(block.tile, [block])}>
        {block.tile}
      </span>
      <div>
        <strong>{block.name}</strong>
        <p>{description}</p>
      </div>
    </aside>
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
  if (!Array.isArray(stage.board) || stage.board.length === 0) {
    return <div className={compact ? 'mini-board compact' : 'mini-board'} />;
  }
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
  const summary = block.description || createBlockSummary(block);
  const ruleSummary = createBlockRuleSummary(block);
  return (
    <div className="block-item">
      <span className="palette-chip custom" style={tileStyle(block.tile, [block])}>
        {block.tile}
      </span>
      <div>
        <strong>{block.name}</strong>
        <span>
          {formatBlockEffect(block)} · 이동 {block.moveCost} · 다운로드 {block.downloads || 0}
        </span>
        <p className="block-item-description">{summary}</p>
        {ruleSummary && <span className="block-item-rule">{ruleSummary}</span>}
        {block.tags?.length > 0 && <TagList tags={block.tags} />}
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

function TagList({ tags }) {
  return (
    <div className="tag-list">
      {tags.slice(0, 5).map((tag) => (
        <span key={tag}>#{tag}</span>
      ))}
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

        <div className="guide-intro">
          <strong>처음이면 이 순서대로 하세요.</strong>
          <ol>
            <li>아래 예시 중 하나를 그대로 복사해서 코드 칸에 붙여넣습니다.</li>
            <li>name은 블록 이름, tile은 보드에 찍을 알파벳 한 글자로 바꿉니다.</li>
            <li>블록 저장을 누르면 팔레트에 새 블록이 생깁니다.</li>
            <li>팔레트에서 그 블록을 고르고 보드 칸을 누르면 맵에 배치됩니다.</li>
            <li>업로드를 누르면 다른 플레이어도 그 규칙이 들어간 맵을 플레이할 수 있습니다.</li>
          </ol>
        </div>

        <div className="guide-grid">
          <section>
            <h3>가장 쉬운 예시</h3>
            <p>아래 코드는 밟으면 이동 횟수를 2칸 쓰는 진흙 블록입니다.</p>
            <pre>{`{
  "name": "진흙",
  "tile": "C",
  "color": "#a78bfa",
  "effect": "slow",
  "moveCost": 2,
  "description": "이 블록 위에 서 있으면 이동 횟수를 2칸 사용합니다.",
  "message": "진흙을 밟아 이동력이 더 소모됩니다."
}`}</pre>
          </section>

          <section>
            <h3>필수 기본 필드</h3>
            <p>이 네 개만 이해하면 기본 블록을 만들 수 있습니다.</p>
            <div className="guide-table">
              <div><strong>name</strong><span>블록 이름입니다. 예: 진흙, 점프대, 비밀문</span></div>
              <div><strong>tile</strong><span>맵에 표시될 알파벳입니다. C~Z 한 글자만 사용합니다. A/B는 포탈이라 제외됩니다.</span></div>
              <div><strong>color</strong><span>블록 색상입니다. 반드시 #38bdf8 같은 #RRGGBB 형식입니다.</span></div>
              <div><strong>effect</strong><span>블록의 동작입니다. 아래 효과 사전에서 골라 넣습니다.</span></div>
              <div><strong>description</strong><span>플레이어가 이 블록 위에 서 있을 때 보드 아래에 뜨는 설명문입니다.</span></div>
              <div><strong>message</strong><span>블록을 밟는 순간 왼쪽 게임 메시지에 뜨는 짧은 결과 문장입니다.</span></div>
            </div>
          </section>

          <section>
            <h3>description 쓰는 법</h3>
            <p>description은 플레이어가 그 블록 위에 올라가 있는 동안 보드 아래에 표시됩니다. 블록의 규칙을 초보자도 알 수 있게 직접 써두세요.</p>
            <pre>{`{
  "name": "H 제거 발판",
  "tile": "C",
  "color": "#38bdf8",
  "effect": "floor",
  "moveCost": 1,
  "description": "이 블록 위에 있으면 맵의 H 블록이 모두 사라집니다.",
  "message": "H 블록이 사라졌습니다.",
  "change": [
    {
      "targetTile": "H",
      "tile": "."
    }
  ]
}`}</pre>
            <p>정리: description은 서 있을 때 설명, message는 밟았을 때 결과 알림입니다.</p>
          </section>

          <section>
            <h3>효과 사전</h3>
            <p>effect에 넣을 수 있는 값입니다.</p>
            <div className="guide-table compact">
              <div><strong>floor</strong><span>그냥 지나갈 수 있는 일반 블록</span></div>
              <div><strong>wall</strong><span>지나갈 수 없는 벽</span></div>
              <div><strong>slow</strong><span>moveCost만큼 이동 횟수를 더 많이 씀</span></div>
              <div><strong>bounce</strong><span>밟으면 원래 자리로 튕겨 돌아감</span></div>
              <div><strong>key</strong><span>밟으면 열쇠를 얻고 블록이 사라짐</span></div>
              <div><strong>lock</strong><span>열쇠가 있어야 통과하고, 통과하면 사라짐</span></div>
              <div><strong>goal</strong><span>밟으면 스테이지 클리어</span></div>
              <div><strong>gameover</strong><span>밟으면 즉시 실패 화면으로 이동</span></div>
              <div><strong>force</strong><span>밟으면 outDirection 방향으로 한 칸 더 밀어냄</span></div>
              <div><strong>oneway</strong><span>조건을 맞추면 outDirection 방향으로만 빠져나감</span></div>
            </div>
          </section>

          <section>
            <h3>방향 쓰는 법</h3>
            <p>방향은 영어 소문자로 씁니다. 방향이 필요한 효과는 force, oneway입니다.</p>
            <pre>{`"outDirection": "up"

쓸 수 있는 방향:
up    = 위
down  = 아래
left  = 왼쪽
right = 오른쪽`}</pre>
          </section>

          <section>
            <h3>한 방향 게이트</h3>
            <p>오른쪽으로 들어왔을 때만 통과하고, 밟으면 위쪽으로 빠져나가는 블록입니다.</p>
            <pre>{`{
  "name": "위쪽 게이트",
  "tile": "C",
  "color": "#38bdf8",
  "effect": "oneway",
  "moveCost": 1,
  "outDirection": "up",
  "requires": {
    "direction": "right"
  },
  "failMessage": "오른쪽에서 들어와야 합니다.",
  "exitFailMessage": "위쪽 출구가 막혀 있습니다.",
  "message": "위쪽으로 빠져나갑니다."
}`}</pre>
          </section>

          <section>
            <h3>조건 requires</h3>
            <p>requires는 조건을 못 맞추면 아예 못 지나가게 막습니다.</p>
            <div className="guide-table compact">
              <div><strong>hasKey</strong><span>true면 열쇠가 있어야 통과합니다.</span></div>
              <div><strong>direction</strong><span>특정 방향으로 움직일 때만 통과합니다.</span></div>
              <div><strong>movesUsedAtLeast</strong><span>이미 사용한 이동 횟수가 이 숫자 이상이어야 합니다.</span></div>
              <div><strong>movesUsedAtMost</strong><span>이미 사용한 이동 횟수가 이 숫자 이하여야 합니다.</span></div>
              <div><strong>movesRemainingAtLeast</strong><span>남은 이동 횟수가 이 숫자 이상이어야 합니다.</span></div>
              <div><strong>movesRemainingAtMost</strong><span>남은 이동 횟수가 이 숫자 이하여야 합니다.</span></div>
              <div><strong>elapsedSeconds</strong><span>스테이지 시작 후 지난 시간을 비교합니다. 예: {`{ "<=": 5 }`}</span></div>
            </div>
          </section>

          <section>
            <h3>if 규칙</h3>
            <p>if는 조건을 만족할 때만 블록 효과를 바꿉니다. 위에서부터 확인하고, 맞는 첫 규칙만 적용됩니다.</p>
            <pre>{`{
  "name": "열쇠 목표",
  "tile": "D",
  "color": "#facc15",
  "effect": "floor",
  "moveCost": 1,
  "if": [
    {
      "when": { "hasKey": true },
      "effect": "goal",
      "message": "열쇠를 가진 상태라 클리어됩니다."
    }
  ]
}`}</pre>
          </section>

          <section>
            <h3>여러 조건을 같이 쓰기</h3>
            <p>조건 여러 개를 넣으면 모두 맞아야 통과합니다.</p>
            <pre>{`{
  "requires": {
    "hasKey": true,
    "direction": "up",
    "movesRemainingAtLeast": 2
  }
}

뜻:
열쇠가 있고,
위로 움직이고,
남은 이동 횟수가 2 이상일 때만 통과`}</pre>
          </section>

          <section>
            <h3>spawn 명령</h3>
            <p>spawn 또는 change는 블록을 밟았을 때 맵의 다른 칸에 새 타일을 만들거나 바꿉니다.</p>
            <div className="guide-table compact">
              <div><strong>tile</strong><span>새로 만들 타일입니다. 예: "X"</span></div>
              <div><strong>row</strong><span>몇 번째 줄인지 씁니다. 첫 번째 줄은 1입니다.</span></div>
              <div><strong>col</strong><span>몇 번째 칸인지 씁니다. 첫 번째 칸은 1입니다.</span></div>
              <div><strong>targetTile</strong><span>맵에 있는 특정 타일을 전부 바꿉니다. 예: "S"를 전부 "X"로 바꾸기</span></div>
              <div><strong>relative</strong><span>밟은 위치 기준으로 만듭니다. current, up, down, left, right</span></div>
              <div><strong>distance</strong><span>relative를 쓸 때 몇 칸 떨어진 곳인지 씁니다. 생략하면 1입니다.</span></div>
              <div><strong>afterSeconds</strong><span>몇 초 뒤에 바꿀지 씁니다. 생략하거나 0이면 즉시 바뀝니다.</span></div>
            </div>
          </section>

          <section>
            <h3>시간 조건과 부등호</h3>
            <p>elapsedSeconds는 시작 후 지난 시간입니다. 부등호는 큰따옴표 안에 씁니다.</p>
            <pre>{`{
  "name": "5초 문",
  "tile": "Y",
  "color": "#22c55e",
  "effect": "floor",
  "moveCost": 1,
  "requires": {
    "elapsedSeconds": { "<=": 5 }
  },
  "failMessage": "5초 안에 도착해야 열립니다."
}`}</pre>
          </section>

          <section>
            <h3>이미지 넣기</h3>
            <p>이미지 버튼을 누르면 image 필드가 자동으로 추가됩니다. 직접 손으로 길게 입력하지 않아도 됩니다.</p>
            <pre>{`{
  "name": "사진 벽",
  "tile": "W",
  "effect": "wall",
  "color": "#64748b",
  "image": "data:image/png;base64,..."
}`}</pre>
          </section>

          <section>
            <h3>이미지 주의사항</h3>
            <p>이미지는 서버에 글자 데이터로 저장됩니다. 너무 큰 이미지는 저장이 막힙니다.</p>
            <ul className="guide-list">
              <li>png, jpg, webp, gif만 사용하세요.</li>
              <li>가능하면 64x64 또는 128x128처럼 작은 이미지를 쓰세요.</li>
              <li>앱의 이미지 버튼은 140KB 이하 파일만 받습니다.</li>
              <li>이미지를 바꾸고 싶으면 image 줄을 지우고 다시 이미지 버튼을 누르세요.</li>
            </ul>
          </section>

          <section>
            <h3>복붙 예시: 튕김 블록</h3>
            <p>밟으면 이동 횟수는 쓰지만 위치는 원래 자리로 돌아갑니다.</p>
            <pre>{`{
  "name": "튕김 패드",
  "tile": "F",
  "color": "#f472b6",
  "effect": "bounce",
  "moveCost": 1,
  "message": "튕겨 나왔습니다."
}`}</pre>
          </section>

          <section>
            <h3>복붙 예시: 강제 이동</h3>
            <p>밟으면 오른쪽으로 한 칸 더 밀려납니다.</p>
            <pre>{`{
  "name": "오른쪽 바람",
  "tile": "R",
  "color": "#22d3ee",
  "effect": "force",
  "moveCost": 1,
  "outDirection": "right",
  "message": "바람이 오른쪽으로 밀었습니다.",
  "exitFailMessage": "오른쪽이 막혀 이동하지 못했습니다."
}`}</pre>
          </section>

          <section>
            <h3>복붙 예시: H 발판과 게임오버 블록</h3>
            <p>코드 칸에는 한 번에 블록 하나만 저장합니다. 먼저 X 블록을 저장하고, 그다음 H 발판을 저장하세요.</p>
            <p>1. 먼저 이 X 블록을 저장합니다.</p>
            <pre>{`{
  "name": "게임오버 함정",
  "tile": "X",
  "color": "#fb315f",
  "effect": "gameover",
  "moveCost": 1,
  "message": "함정을 밟았습니다. 게임오버!"
}`}</pre>
            <p>2. 그다음 이 H 발판을 저장합니다.</p>
            <pre>{`{
  "name": "H 발판",
  "tile": "H",
  "color": "#38bdf8",
  "effect": "floor",
  "moveCost": 1,
  "message": "게임오버 함정이 나타났습니다.",
  "spawn": [
    {
      "tile": "X",
      "row": 3,
      "col": 5
    }
  ]
}`}</pre>
            <p>뜻: H를 밟으면 3번째 줄, 5번째 칸에 X가 생기고, 그 X를 밟으면 게임오버됩니다.</p>
          </section>

          <section>
            <h3>복붙 예시: 특정 표시칸을 함정으로 바꾸기</h3>
            <p>row와 col을 세기 어렵다면 S 같은 표시 블록을 맵에 미리 놓고, H를 밟으면 S를 전부 X로 바꿀 수 있습니다.</p>
            <p>1. 표시칸 S를 먼저 저장합니다.</p>
            <pre>{`{
  "name": "숨은 함정 자리",
  "tile": "S",
  "color": "#334155",
  "effect": "floor",
  "moveCost": 1,
  "message": "아직은 안전합니다."
}`}</pre>
            <p>2. 게임오버 X도 저장합니다.</p>
            <pre>{`{
  "name": "게임오버 함정",
  "tile": "X",
  "color": "#fb315f",
  "effect": "gameover",
  "moveCost": 1,
  "message": "함정을 밟았습니다. 게임오버!"
}`}</pre>
            <p>3. H 발판은 이렇게 저장합니다.</p>
            <pre>{`{
  "name": "H 발판",
  "tile": "H",
  "color": "#38bdf8",
  "effect": "floor",
  "moveCost": 1,
  "message": "숨은 함정이 드러났습니다.",
  "spawn": [
    {
      "targetTile": "S",
      "tile": "X"
    }
  ]
}`}</pre>
          </section>

          <section>
            <h3>복붙 예시: 몇 초 뒤 블록 바꾸기</h3>
            <p>H를 밟으면 4초 뒤 S 표시칸이 전부 X 함정으로 바뀝니다.</p>
            <pre>{`{
  "name": "지연 함정 발판",
  "tile": "H",
  "color": "#38bdf8",
  "effect": "floor",
  "moveCost": 1,
  "message": "4초 뒤 함정이 켜집니다.",
  "change": [
    {
      "targetTile": "S",
      "tile": "X",
      "afterSeconds": 4
    }
  ]
}`}</pre>
          </section>

          <section>
            <h3>복붙 예시: 열쇠 문</h3>
            <p>열쇠가 있어야 지나갈 수 있습니다. 지나가면 문이 사라집니다.</p>
            <pre>{`{
  "name": "초록 문",
  "tile": "M",
  "color": "#4ade80",
  "effect": "lock",
  "moveCost": 1,
  "requires": { "hasKey": true },
  "failMessage": "열쇠가 필요합니다.",
  "message": "문이 열렸습니다."
}`}</pre>
          </section>

          <section>
            <h3>복붙 예시: 후반부에만 열리는 길</h3>
            <p>이동을 5번 이상 사용한 뒤에만 지나갈 수 있습니다.</p>
            <pre>{`{
  "name": "늦게 열리는 길",
  "tile": "T",
  "color": "#fb923c",
  "effect": "floor",
  "moveCost": 1,
  "requires": {
    "movesUsedAtLeast": 5
  },
  "failMessage": "아직 열리지 않았습니다."
}`}</pre>
          </section>

          <section>
            <h3>자주 나는 오류</h3>
            <ul className="guide-list">
              <li>쉼표가 빠지면 저장이 안 됩니다. 각 줄 끝의 쉼표를 확인하세요.</li>
              <li>tile은 C~Z 한 글자만 됩니다. A, B, P, G, K, L은 예약되어 있습니다.</li>
              <li>color는 red 같은 단어가 아니라 #ff0000 형식이어야 합니다.</li>
              <li>문자는 큰따옴표로 감싸야 합니다. 예: "effect": "slow"</li>
              <li>true/false는 따옴표 없이 씁니다. 예: "hasKey": true</li>
              <li>force/oneway에는 outDirection이 꼭 필요합니다.</li>
              <li>spawn의 row와 col은 0이 아니라 1부터 셉니다.</li>
            </ul>
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
          <Stat label="시간" value={formatTime(elapsed)} />
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
  const parsedBoardData = typeof boardData === 'string' ? safeJsonParse(boardData, {}) : null;
  const board = parsedBoardData ? parsedBoardData.board || parsedBoardData : boardData;
  const normalizedBoard = Array.isArray(board) ? board.map((row) => String(row || '')) : [];
  const customBlockSource = Array.isArray(stage.customBlocks) ? stage.customBlocks : parsedBoardData?.customBlocks || parsedBoardData?.blocks || [];
  const isOfficial = stage.isOfficial ?? (stage.is_official === undefined ? true : stage.is_official !== 0);
  return {
    id: stage.id,
    level: stage.level,
    title: stage.title || `Level ${stage.level}`,
    difficulty: stage.difficulty,
    moveLimit: stage.moveLimit ?? stage.move_limit,
    board: normalizedBoard,
    customBlocks: Array.isArray(customBlockSource) ? customBlockSource.map(normalizeCustomBlock) : [],
    tags: parseTags(stage.tags || []),
    visionRadius: normalizeVisionRadius(stage.visionRadius ?? stage.vision_radius ?? parsedBoardData?.visionRadius ?? ''),
    creatorId: stage.creatorId ?? stage.creator_id,
    creatorNickname: stage.creatorNickname ?? stage.creator_nickname,
    isOfficial,
    isPublic: stage.isPublic ?? (stage.is_public === undefined ? true : stage.is_public !== 0),
    creatorClearVerified: stage.creatorClearVerified ?? (stage.creator_clear_verified === undefined ? true : stage.creator_clear_verified !== 0),
    playCount: stage.playCount ?? stage.play_count ?? 0
  };
}

function normalizeCustomBlock(block) {
  const code = typeof block.code === 'string' ? safeJsonParse(block.code, {}) : block.code || block;
  const image = String(code.image || code.imageData || block.image || block.imageData || '');
  const outDirection = normalizeDirectionValue(code.outDirection || code.exitDirection || block.outDirection || block.exitDirection || '');
  const requires = normalizeBlockCondition(code.requires || code.require || block.requires || block.require || null);
  const rules = normalizeBlockRules(code.if || code.rules || block.if || block.rules || []);
  const spawn = normalizeBlockSpawns(code.spawn || code.spawns || code.change || code.changes || block.spawn || block.spawns || block.change || block.changes || []);
  const tags = parseTags(code.tags || block.tags || []);
  const description = String(code.description || code.tooltip || block.description || block.tooltip || '').slice(0, 160);
  return {
    id: block.id || null,
    userId: block.userId ?? block.user_id,
    creatorNickname: block.creatorNickname ?? block.creator_nickname,
    name: String(code.name || block.name || '커스텀').slice(0, 24),
    tile: String(code.tile || block.tile || 'C').slice(0, 1).toUpperCase(),
    color: String(code.color || block.color || '#a78bfa'),
    effect: String(code.effect || block.effect || 'slow').toLowerCase(),
    tags,
    moveCost: Number(code.moveCost ?? block.moveCost ?? block.move_cost ?? 2),
    description,
    message: String(code.message || block.message || ''),
    failMessage: String(code.failMessage || block.failMessage || ''),
    exitFailMessage: String(code.exitFailMessage || block.exitFailMessage || ''),
    image,
    outDirection,
    requires,
    consumeOnUse: code.consumeOnUse === true || block.consumeOnUse === true,
    giveKey: code.giveKey === true || block.giveKey === true,
    takeKey: code.takeKey === true || block.takeKey === true,
    spawn,
    rules,
    isPublic: block.isPublic ?? (block.is_public === undefined ? true : block.is_public !== 0),
    downloads: block.downloads || 0,
    code: {
      name: String(code.name || block.name || '커스텀').slice(0, 24),
      tile: String(code.tile || block.tile || 'C').slice(0, 1).toUpperCase(),
      color: String(code.color || block.color || '#a78bfa'),
      effect: String(code.effect || block.effect || 'slow').toLowerCase(),
      tags,
      moveCost: Number(code.moveCost ?? block.moveCost ?? block.move_cost ?? 2),
      description,
      message: String(code.message || block.message || ''),
      failMessage: String(code.failMessage || block.failMessage || ''),
      exitFailMessage: String(code.exitFailMessage || block.exitFailMessage || ''),
      image,
      outDirection,
      requires,
      consumeOnUse: code.consumeOnUse === true || block.consumeOnUse === true,
      giveKey: code.giveKey === true || block.giveKey === true,
      takeKey: code.takeKey === true || block.takeKey === true,
      spawn,
      if: rules
    }
  };
}

function parseBlockDraft(draft) {
  const parsed = safeJsonParse(draft, null);
  const allowedEffects = new Set(['slow', 'wall', 'bounce', 'goal', 'key', 'lock', 'floor', 'force', 'oneway', 'gameover']);
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
    return { ok: false, message: 'effect는 slow, wall, bounce, goal, key, lock, floor, force, oneway, gameover 중 하나여야 합니다.' };
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

  const spawnValidation = validateBlockSpawns(parsed.spawn || parsed.spawns || parsed.change || parsed.changes || []);
  if (!spawnValidation.ok) {
    return spawnValidation;
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
  const blockMap = new Map(customBlocks.map(normalizeCustomBlock).map((block) => [block.tile, block]));
  const usedTiles = new Set(board.flat());
  const queue = [...usedTiles];

  while (queue.length) {
    const tile = queue.shift();
    const block = blockMap.get(tile);
    if (!block) {
      continue;
    }

    getSpawnTiles(block).forEach((spawnTile) => {
      if (blockMap.has(spawnTile) && !usedTiles.has(spawnTile)) {
        usedTiles.add(spawnTile);
        queue.push(spawnTile);
      }
    });
  }

  return [...usedTiles].map((tile) => blockMap.get(tile)).filter(Boolean).sort((a, b) => a.tile.localeCompare(b.tile));
}

function getSpawnTiles(block) {
  return [
    ...(block.spawn || []),
    ...(block.rules || []).flatMap((rule) => rule.spawn || [])
  ].map((spawn) => spawn.tile).filter(Boolean);
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
    tags: stage.tags || [],
    board: stage.board,
    customBlocks: stage.customBlocks || [],
    visionRadius: normalizeVisionRadius(stage.visionRadius ?? '')
  };
}

function createBuilderState() {
  return {
    id: null,
    title: '내 퍼즐 맵',
    difficulty: '커뮤니티',
    moveLimit: 12,
    visionRadius: '',
    tags: 'community',
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
    const safeRow = clampInteger(fallbackRow, 0, Math.max(board.length - 1, 0), 0);
    const safeCol = clampInteger(fallbackCol, 0, Math.max((board[safeRow]?.length || 1) - 1, 0), 0);
    if (board[safeRow]) {
      board[safeRow][safeCol] = tile;
    }
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
  if (board.length < 4 || board.length > 10 || board.some((row) => row.length < 4 || row.length > 10 || row.length !== board[0].length)) {
    return { ok: false, message: '맵 크기는 4x4부터 10x10까지, 모든 줄 길이가 같아야 합니다.' };
  }

  return { ok: true };
}

function createBuilderPayload(builder, customBlocks) {
  return {
    title: builder.title,
    difficulty: builder.difficulty,
    moveLimit: Number(builder.moveLimit),
    tags: parseTags(builder.tags),
    board: boardToStrings(builder.board),
    customBlocks: getUsedCustomBlocks(builder.board, customBlocks),
    visionRadius: normalizeVisionRadius(builder.visionRadius)
  };
}

function createBuilderHash(payload) {
  return btoa(
    encodeURIComponent(
      JSON.stringify({
        moveLimit: payload.moveLimit,
        board: payload.board,
        customBlocks: payload.customBlocks.map((block) => block.code || block)
      })
    )
  ).slice(0, 120);
}

function normalizeBlockRules(rules) {
  if (!Array.isArray(rules)) {
    return [];
  }

  return rules
    .filter((rule) => rule && typeof rule === 'object')
    .slice(0, 8)
    .map((rule) => {
      const spawn = normalizeBlockSpawns(rule.spawn || rule.spawns || rule.change || rule.changes || []);
      return {
        when: normalizeBlockCondition(rule.when || rule.condition || {}),
        ...(rule.effect === undefined ? {} : { effect: String(rule.effect).toLowerCase() }),
        ...(rule.moveCost === undefined ? {} : { moveCost: Number(rule.moveCost) }),
        ...(normalizeDirectionValue(rule.outDirection || rule.exitDirection) ? { outDirection: normalizeDirectionValue(rule.outDirection || rule.exitDirection) } : {}),
        ...(rule.message === undefined ? {} : { message: String(rule.message) }),
        ...(rule.failMessage === undefined ? {} : { failMessage: String(rule.failMessage) }),
        ...(rule.exitFailMessage === undefined ? {} : { exitFailMessage: String(rule.exitFailMessage) }),
        ...(rule.consumeOnUse === undefined ? {} : { consumeOnUse: rule.consumeOnUse === true }),
        ...(rule.giveKey === undefined ? {} : { giveKey: rule.giveKey === true }),
        ...(rule.takeKey === undefined ? {} : { takeKey: rule.takeKey === true }),
        ...(spawn.length ? { spawn } : {})
      };
    });
}

function normalizeBlockSpawns(spawn) {
  const items = Array.isArray(spawn) ? spawn : spawn ? [spawn] : [];

  return items
    .filter((item) => item && typeof item === 'object')
    .slice(0, 12)
    .map((item) => {
      const tile = normalizeSpawnTile(item.tile || item.to || item.place);
      const targetTile = normalizeSpawnTile(item.targetTile || item.replaceTile || item.from);
      const relativeValue = String(item.relative || item.direction || '').toLowerCase();
      const relative = relativeValue === 'current' ? 'current' : normalizeDirectionValue(relativeValue);
      const row = Number(item.row);
      const col = Number(item.col);
    const distance = Number(item.distance);
    const afterSeconds = Number(item.afterSeconds ?? item.after);

      if (!tile) {
        return null;
      }

      return {
        tile,
        ...(targetTile ? { targetTile } : {}),
        ...(Number.isFinite(row) && Number.isFinite(col) ? { row: Math.round(row), col: Math.round(col) } : {}),
        ...(relative ? { relative } : {}),
        ...(Number.isFinite(distance) ? { distance: Math.max(1, Math.min(Math.round(distance), 9)) } : {}),
        ...(Number.isFinite(afterSeconds) ? { afterSeconds: Math.max(0, Math.min(Math.round(afterSeconds), 99)) } : {})
      };
    })
    .filter(Boolean);
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
  ['elapsedSeconds', 'time', 'seconds'].forEach((key) => {
    if (condition[key] !== undefined) {
      const comparison = normalizeComparison(condition[key]);
      if (comparison) {
        normalized.elapsedSeconds = comparison;
      }
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
  for (const key of ['elapsedSeconds', 'time', 'seconds']) {
    if (condition[key] !== undefined && !isValidComparison(condition[key])) {
      return { ok: false, message: '시간 조건은 숫자 또는 { \">\": 3, \"<=\": 10 } 같은 비교 객체여야 합니다.' };
    }
  }

  return { ok: true };
}

function normalizeComparison(value) {
  if (Number.isFinite(Number(value))) {
    return { '<=': Math.max(0, Math.min(Math.round(Number(value)), 999)) };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const normalized = {};
  ['>', '>=', '<', '<='].forEach((operator) => {
    if (value[operator] !== undefined && Number.isFinite(Number(value[operator]))) {
      normalized[operator] = Math.max(0, Math.min(Math.round(Number(value[operator])), 999));
    }
  });
  return Object.keys(normalized).length ? normalized : null;
}

function isValidComparison(value) {
  if (Number.isFinite(Number(value))) {
    return true;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return ['>', '>=', '<', '<='].some((operator) => value[operator] !== undefined && Number.isFinite(Number(value[operator])));
}

function validateBlockRules(rules) {
  if (!Array.isArray(rules)) {
    return { ok: false, message: 'if는 배열이어야 합니다.' };
  }

  const allowedEffects = new Set(['slow', 'wall', 'bounce', 'goal', 'key', 'lock', 'floor', 'force', 'oneway', 'gameover']);

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
    const spawnValidation = validateBlockSpawns(rule.spawn || rule.spawns || rule.change || rule.changes || []);
    if (!spawnValidation.ok) {
      return spawnValidation;
    }
  }

  return { ok: true };
}

function validateBlockSpawns(spawn) {
  const items = Array.isArray(spawn) ? spawn : spawn ? [spawn] : [];
  if (items.length > 12) {
    return { ok: false, message: 'spawn은 최대 12개까지만 넣을 수 있습니다.' };
  }

  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, message: 'spawn 항목은 JSON 객체여야 합니다.' };
    }

    if (!normalizeSpawnTile(item.tile || item.to || item.place)) {
      return { ok: false, message: 'spawn의 tile은 ., #, G, K, L 또는 C~Z 한 글자여야 합니다. P는 사용할 수 없습니다.' };
    }

    const hasTargetTile = Boolean(normalizeSpawnTile(item.targetTile || item.replaceTile || item.from));
    const hasPosition = item.row !== undefined || item.col !== undefined;
    const hasRelative = item.relative !== undefined || item.direction !== undefined;

    if (hasPosition) {
      if (!Number.isFinite(Number(item.row)) || !Number.isFinite(Number(item.col)) || Number(item.row) < 1 || Number(item.col) < 1) {
        return { ok: false, message: 'spawn의 row와 col은 1 이상의 숫자여야 합니다.' };
      }
    }

    if (hasRelative) {
      const relative = String(item.relative || item.direction || '').toLowerCase();
      if (relative !== 'current' && !normalizeDirectionValue(relative)) {
        return { ok: false, message: 'spawn의 relative는 current, up, down, left, right 중 하나여야 합니다.' };
      }
    }
    if ((item.afterSeconds !== undefined || item.after !== undefined) && !Number.isFinite(Number(item.afterSeconds ?? item.after))) {
      return { ok: false, message: 'spawn의 afterSeconds는 0~99 사이 숫자여야 합니다.' };
    }

    if (!hasTargetTile && !hasPosition && !hasRelative) {
      return { ok: false, message: 'spawn에는 targetTile, row/col, relative 중 하나가 필요합니다.' };
    }
  }

  return { ok: true };
}

function normalizeDirectionValue(value) {
  const direction = String(value || '').toLowerCase();
  return ['up', 'down', 'left', 'right'].includes(direction) ? direction : '';
}

function normalizeSpawnTile(value) {
  const tile = String(value || '').trim().slice(0, 1).toUpperCase();
  if (tile !== 'P' && (tile === '.' || tile === '#' || ['G', 'K', 'L'].includes(tile) || /^[C-Z]$/.test(tile))) {
    return tile;
  }
  return '';
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

function getElapsedFromTimer(startTime) {
  return Number(((performance.now() - startTime) / 1000).toFixed(4));
}

function formatTime(value) {
  return `${Number(value || 0).toFixed(4)}s`;
}

function runOnEnter(event, action) {
  if (event.key === 'Enter') {
    event.preventDefault();
    action();
  }
}

function clampInteger(value, min, max, fallback = min) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(min, Math.min(Math.round(number), max));
}

function normalizeVisionRadius(value) {
  if (value === '' || value === null || value === undefined) {
    return '';
  }
  const radius = Number(value);
  if (!Number.isFinite(radius) || radius <= 0) {
    return '';
  }
  return clampInteger(radius, 1, 10, '');
}

function pointKey(point) {
  return `${point.row}:${point.col}`;
}

function manhattanDistance(a, b) {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

function isFogged(game, point) {
  const radius = normalizeVisionRadius(game.stage?.visionRadius);
  return radius !== '' && manhattanDistance(game.player, point) > radius;
}

function findPathToGoal(game) {
  if (!game.player || !game.goal || !game.tiles?.length) {
    return [];
  }

  const queue = [{ point: game.player, path: [game.player] }];
  const visited = new Set([pointKey(game.player)]);
  const steps = [
    { row: -1, col: 0 },
    { row: 1, col: 0 },
    { row: 0, col: -1 },
    { row: 0, col: 1 }
  ];

  while (queue.length) {
    const current = queue.shift();
    if (current.point.row === game.goal.row && current.point.col === game.goal.col) {
      return current.path;
    }

    steps.forEach((step) => {
      const next = { row: current.point.row + step.row, col: current.point.col + step.col };
      const key = pointKey(next);
      if (visited.has(key) || !isPathPassable(game, next)) {
        return;
      }
      visited.add(key);
      queue.push({ point: next, path: [...current.path, next] });
    });
  }

  return [];
}

function isPathPassable(game, point) {
  const tile = game.tiles?.[point.row]?.[point.col];
  if (!tile || tile === '#') {
    return false;
  }
  if (tile === 'L' && !game.hasKey) {
    return false;
  }
  const block = getCustomBlock(tile, game.customBlocks || []);
  if (!block) {
    return true;
  }
  if (block.effect === 'wall' || block.effect === 'gameover') {
    return false;
  }
  if (block.effect === 'lock' && !game.hasKey) {
    return false;
  }
  return true;
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

function getCurrentPlayerBlock(game) {
  if (!game.player) {
    return null;
  }
  const tile = game.tiles?.[game.player?.row]?.[game.player?.col];
  if (!tile) {
    return null;
  }
  return getCustomBlock(tile, game.customBlocks || []) || null;
}

function createBlockSummary(block) {
  const effectLabels = {
    floor: '일반 발판처럼 지나갈 수 있는 블록입니다.',
    wall: '지나갈 수 없는 벽 블록입니다.',
    slow: `이 블록 위에 있으면 이동 횟수를 ${block.moveCost || 1}칸 사용합니다.`,
    bounce: '밟으면 원래 자리로 튕겨 돌아가는 블록입니다.',
    goal: '밟으면 스테이지를 클리어하는 목표 블록입니다.',
    key: '밟으면 열쇠를 얻는 블록입니다.',
    lock: '열쇠가 있어야 지나갈 수 있는 잠금 블록입니다.',
    force: `${directionLabel(block.outDirection)} 방향으로 한 칸 더 밀어내는 블록입니다.`,
    oneway: `${directionLabel(block.outDirection)} 방향으로만 빠져나갈 수 있는 블록입니다.`,
    gameover: '밟으면 즉시 실패하는 위험 블록입니다.'
  };
  return effectLabels[block.effect] || '커스텀 규칙이 적용된 블록입니다.';
}

function formatBlockEffect(block) {
  const labels = {
    floor: '길',
    wall: '벽',
    slow: '느림',
    bounce: '튕김',
    goal: '목표',
    key: '열쇠',
    lock: '잠금',
    force: `강제 이동 ${directionLabel(block.outDirection)}`,
    oneway: `일방통행 ${directionLabel(block.outDirection)}`,
    gameover: '게임오버'
  };
  return labels[block.effect] || block.effect;
}

function createBlockRuleSummary(block) {
  const parts = [];
  if (block.requires) {
    parts.push('조건 필요');
  }
  if (block.rules?.length) {
    parts.push(`if ${block.rules.length}개`);
  }
  if (block.spawn?.length) {
    const delayed = block.spawn.some((item) => Number(item.afterSeconds || 0) > 0);
    parts.push(delayed ? '시간 후 변화' : '블록 변화');
  }
  if (block.giveKey) {
    parts.push('열쇠 지급');
  }
  if (block.takeKey) {
    parts.push('열쇠 제거');
  }
  return parts.join(' · ');
}

function directionLabel(direction) {
  const labels = {
    up: '위',
    down: '아래',
    left: '왼쪽',
    right: '오른쪽'
  };
  return labels[direction] || '지정된';
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

function parseTags(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  const tags = [];

  source.forEach((item) => {
    const tag = String(item || '')
      .normalize('NFKC')
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_-]/gu, '')
      .slice(0, 18);
    if (tag && !tags.includes(tag)) {
      tags.push(tag);
    }
  });

  return tags.slice(0, 5);
}
