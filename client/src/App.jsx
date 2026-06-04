import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BarChart3,
  Crown,
  DoorOpen,
  KeyRound,
  ListRestart,
  Lock,
  Pencil,
  Play,
  RotateCcw,
  Save,
  Shield,
  Sparkles,
  Trophy,
  Zap
} from 'lucide-react';
import { fallbackStages } from './data/stages.js';
import { calculateScore, createInitialGame, movePlayer } from './game/engine.js';
import {
  createStage,
  deleteStage,
  fetchHealth,
  fetchRankings,
  fetchStages,
  saveRecord,
  updateStage
} from './services/api.js';

const bestRecordKey = 'puzzle-tower-best-records';
const nicknameKey = 'puzzle-tower-nickname';

export default function App() {
  const [view, setView] = useState('home');
  const [nickname, setNickname] = useState(() => localStorage.getItem(nicknameKey) || 'player');
  const [stages, setStages] = useState(fallbackStages);
  const [selectedStage, setSelectedStage] = useState(fallbackStages[0]);
  const [game, setGame] = useState(() => createInitialGame(fallbackStages[0]));
  const [elapsed, setElapsed] = useState(0);
  const [apiOnline, setApiOnline] = useState(false);
  const [rankings, setRankings] = useState([]);
  const [rankingStageId, setRankingStageId] = useState('');
  const [bestRecords, setBestRecords] = useState(() => loadBestRecords());
  const [recordSaved, setRecordSaved] = useState(false);
  const [adminToken, setAdminToken] = useState('');
  const [adminDraft, setAdminDraft] = useState('');
  const [adminMessage, setAdminMessage] = useState('');

  const movesRemaining = selectedStage.moveLimit - game.movesUsed;
  const currentBest = bestRecords[selectedStage.id];

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

    fetchStages().then((loadedStages) => {
      if (!mounted || !Array.isArray(loadedStages) || loadedStages.length === 0) {
        return;
      }
      const normalized = loadedStages.map(normalizeStage).sort((a, b) => a.level - b.level);
      setStages(normalized);
      setSelectedStage(normalized[0]);
      setGame(createInitialGame(normalized[0]));
    });

    return () => {
      mounted = false;
    };
  }, []);

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
    localStorage.setItem(nicknameKey, nickname.trim() || 'player');
  }, [nickname]);

  useEffect(() => {
    if (game.status !== 'cleared' || recordSaved) {
      return;
    }

    const score = calculateScore(selectedStage, elapsed, game.movesUsed);
    const record = {
      nickname: nickname.trim() || 'player',
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
  }, [bestRecords, elapsed, game.movesUsed, game.status, nickname, recordSaved, selectedStage]);

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
    const nextStage = stages.find((stage) => stage.level === selectedStage.level + 1);
    if (nextStage) {
      startStage(nextStage);
    } else {
      setView('stages');
    }
  }, [selectedStage.level, stages, startStage]);

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

      const refreshed = await fetchStages();
      const normalized = refreshed.map(normalizeStage).sort((a, b) => a.level - b.level);
      setStages(normalized);
      setSelectedStage(normalizeStage(saved));
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
      const refreshed = await fetchStages();
      setStages(refreshed.map(normalizeStage).sort((a, b) => a.level - b.level));
      setAdminMessage('스테이지가 삭제되었습니다.');
      setApiOnline(true);
    } catch (error) {
      setAdminMessage(error.message);
    }
  };

  const stageStats = useMemo(
    () => ({
      total: stages.length,
      special: stages.filter((stage) => stage.level >= 10).length,
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
          <button className={view === 'rankings' ? 'active' : ''} onClick={() => setView('rankings')} type="button">
            <Trophy size={18} />
            <span>랭킹</span>
          </button>
          <button className={view === 'admin' ? 'active' : ''} onClick={() => openAdminEditor(selectedStage)} type="button">
            <Shield size={18} />
            <span>관리</span>
          </button>
        </nav>
      </header>

      <main>
        {view === 'home' && (
          <section className="home-layout">
            <div className="intro-panel">
              <p className="eyebrow">FULL-STACK PUZZLE GAME</p>
              <h1>Puzzle Tower</h1>
              <p className="intro-copy">
                제한된 이동 횟수 안에 목표 지점까지 도달하세요. 벽, 포탈, 열쇠, 잠금 타일이 단계마다 추가됩니다.
              </p>
              <div className="nickname-row">
                <label htmlFor="nickname">플레이어</label>
                <input
                  id="nickname"
                  maxLength={18}
                  onChange={(event) => setNickname(event.target.value)}
                  value={nickname}
                />
              </div>
              <div className="hero-actions">
                <button className="primary" onClick={() => startStage(selectedStage)} type="button">
                  <Play size={18} />
                  <span>바로 시작</span>
                </button>
                <button onClick={() => setView('stages')} type="button">
                  <DoorOpen size={18} />
                  <span>스테이지 선택</span>
                </button>
              </div>
            </div>

            <div className="tower-panel" aria-label="게임 요약">
              <div className="tower-card">
                <div>
                  <span>총 스테이지</span>
                  <strong>{stageStats.total}</strong>
                </div>
                <div>
                  <span>특수 타일</span>
                  <strong>{stageStats.special}</strong>
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
                <article className="stage-card" key={stage.id}>
                  <div className="stage-card-header">
                    <span>LEVEL {stage.level}</span>
                    <strong>{stage.difficulty}</strong>
                  </div>
                  <h3>{stage.title}</h3>
                  <MiniBoard stage={stage} compact />
                  <div className="stage-meta">
                    <span>{stage.moveLimit} moves</span>
                    <span>{stage.board.length} x {stage.board[0]?.length || 0}</span>
                  </div>
                  <div className="stage-card-actions">
                    <button className="primary" onClick={() => startStage(stage)} type="button">
                      <Play size={16} />
                      <span>플레이</span>
                    </button>
                    <button onClick={() => openAdminEditor(stage)} type="button">
                      <Pencil size={16} />
                      <span>수정</span>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {view === 'game' && (
          <section className="game-layout">
            <aside className="game-sidebar">
              <div>
                <p className="eyebrow">LEVEL {selectedStage.level}</p>
                <h2>{selectedStage.title}</h2>
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
                      Lv.{stage.level} {stage.title}
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
                    <span>Lv.{record.level}</span>
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
                <h2>스테이지 관리</h2>
              </div>
              <StatusPill online={apiOnline} />
            </div>
            <div className="admin-grid">
              <div className="admin-list">
                {stages.map((stage) => (
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
    </div>
  );
}

function GameBoard({ game }) {
  const columns = game.tiles[0]?.length || 1;

  return (
    <div className="board" style={{ '--columns': columns }}>
      {game.tiles.map((row, rowIndex) =>
        row.map((tile, colIndex) => {
          const isPlayer = game.player.row === rowIndex && game.player.col === colIndex;
          const className = ['tile', tileClass(tile), isPlayer ? 'player' : ''].filter(Boolean).join(' ');
          return (
            <div className={className} key={`${rowIndex}-${colIndex}`}>
              {isPlayer ? <Crown size={24} /> : tileLabel(tile)}
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
  return (
    <div className={compact ? 'mini-board compact' : 'mini-board'} style={{ '--columns': stage.board[0]?.length || 1 }}>
      {stage.board.flatMap((row, rowIndex) =>
        row.split('').map((tile, colIndex) => (
          <span className={tileClass(tile)} key={`${rowIndex}-${colIndex}`} />
        ))
      )}
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
          <Stat label="스테이지" value={`Lv.${stage.level}`} />
          <Stat label="점수" value={cleared ? score : 0} />
          <Stat label="시간" value={`${elapsed}s`} />
          <Stat label="이동" value={`${game.movesUsed}/${stage.moveLimit}`} />
        </div>
        <div className="hero-actions">
          <button className="primary" onClick={cleared ? onNext : onRestart} type="button">
            {cleared ? <DoorOpen size={18} /> : <RotateCcw size={18} />}
            <span>{cleared ? '다음 스테이지' : '재도전'}</span>
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
  return {
    id: stage.id,
    level: stage.level,
    title: stage.title || `Level ${stage.level}`,
    difficulty: stage.difficulty,
    moveLimit: stage.moveLimit ?? stage.move_limit,
    board: typeof boardData === 'string' ? JSON.parse(boardData).board || JSON.parse(boardData) : boardData
  };
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

function tileClass(tile) {
  if (tile === '#') return 'wall';
  if (tile === 'G') return 'goal';
  if (tile === 'K') return 'key';
  if (tile === 'L') return 'lock';
  if (/^[A-Z]$/.test(tile) && !['P', 'G', 'K', 'L'].includes(tile)) return 'teleport';
  if (tile === 'P') return 'start';
  return 'floor';
}

function tileLabel(tile) {
  if (tile === 'G') return 'G';
  if (tile === 'K') return 'K';
  if (tile === 'L') return 'L';
  if (/^[A-Z]$/.test(tile) && !['P', 'G', 'K', 'L'].includes(tile)) return tile;
  return '';
}
