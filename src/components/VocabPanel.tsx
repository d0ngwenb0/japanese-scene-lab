import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Scenario, VocabItem } from '../types';
import { Furigana } from '../lib/furigana';
import { stripFurigana } from '../lib/copy';
import { CloseIcon, PlayIcon, ShuffleIcon, VolumeIcon } from './Icons';

interface Props {
  open: boolean;
  scenario: Scenario;
  allScenarios: Scenario[];
  onClose: () => void;
  onJumpToLine: (lineIndex: number) => void;
}

type TabMode = 'list' | 'cards' | 'quiz';
type ListFilter = 'all' | 'unmastered' | 'mastered';
type QuizKind = 'mixed' | 'ja-to-zh' | 'audio-to-ja' | 'zh-to-ja';

interface QuizQuestion {
  item: VocabItem;
  kind: 'ja-to-zh' | 'audio-to-ja' | 'zh-to-ja';
  choices: VocabItem[];
  answerIndex: number;
}

const STORAGE_KEY = 'scene-lab:vocab-mastered:v1';

function readMasteredMap(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === 'string');
    }
    return out;
  } catch {
    return {};
  }
}

function writeMasteredMap(map: Record<string, string[]>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // 隐私模式忽略
  }
}

function shuffleArray<T>(arr: T[]): T[] {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function speakJapanese(text: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'ja-JP';
    utter.rate = 0.92;
    const voices = window.speechSynthesis.getVoices();
    const jpVoice = voices.find((v) => v.lang.toLowerCase().startsWith('ja'));
    if (jpVoice) utter.voice = jpVoice;
    window.speechSynthesis.speak(utter);
  } catch {
    // 忽略语音合成异常
  }
}

export function VocabPanel({ open, scenario, allScenarios, onClose, onJumpToLine }: Props) {
  const vocab = scenario.vocab ?? [];
  const [tab, setTab] = useState<TabMode>('list');
  const [listFilter, setListFilter] = useState<ListFilter>('all');
  const [query, setQuery] = useState('');
  const [masteredMap, setMasteredMap] = useState<Record<string, string[]>>(readMasteredMap);

  // Flashcard state
  const [cardOnlyUnmastered, setCardOnlyUnmastered] = useState(false);
  const [cardShuffled, setCardShuffled] = useState(false);
  const [cardOrder, setCardOrder] = useState<VocabItem[]>([]);
  const [cardIndex, setCardIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [cardShowFuri, setCardShowFuri] = useState(true);

  // Quiz state
  const [quizKind, setQuizKind] = useState<QuizKind>('mixed');
  const [quizOnlyUnmastered, setQuizOnlyUnmastered] = useState(false);
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [quizPos, setQuizPos] = useState(0);
  const [quizSelected, setQuizSelected] = useState<number | null>(null);
  const [quizWrongIds, setQuizWrongIds] = useState<string[]>([]);
  const [quizCorrectCount, setQuizCorrectCount] = useState(0);
  const [quizFinished, setQuizFinished] = useState(false);

  const masteredSet = useMemo(
    () => new Set(masteredMap[scenario.id] ?? []),
    [masteredMap, scenario.id],
  );

  const masteredCount = useMemo(
    () => vocab.filter((v) => masteredSet.has(v.id)).length,
    [vocab, masteredSet],
  );

  const setWordMastered = useCallback(
    (wordId: string, mastered: boolean) => {
      setMasteredMap((prev) => {
        const current = new Set(prev[scenario.id] ?? []);
        if (mastered) current.add(wordId);
        else current.delete(wordId);
        const next = { ...prev, [scenario.id]: Array.from(current) };
        writeMasteredMap(next);
        return next;
      });
    },
    [scenario.id],
  );

  const toggleWordMastered = (wordId: string) => {
    setWordMastered(wordId, !masteredSet.has(wordId));
  };

  // Reset UI state when scenario changes
  useEffect(() => {
    setListFilter('all');
    setQuery('');
    setCardIndex(0);
    setFlipped(false);
    setQuizQuestions([]);
    setQuizPos(0);
    setQuizSelected(null);
    setQuizWrongIds([]);
    setQuizCorrectCount(0);
    setQuizFinished(false);
  }, [scenario.id]);

  // Rebuild flashcard deck when filter/shuffle/scenario changes
  useEffect(() => {
    const base = cardOnlyUnmastered ? vocab.filter((v) => !masteredSet.has(v.id)) : vocab;
    setCardOrder(cardShuffled ? shuffleArray(base) : base);
    setCardIndex(0);
    setFlipped(false);
  }, [vocab, cardOnlyUnmastered, cardShuffled, scenario.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const filteredList = useMemo(() => {
    const q = query.trim().toLowerCase();
    return vocab.filter((item) => {
      const isM = masteredSet.has(item.id);
      if (listFilter === 'mastered' && !isM) return false;
      if (listFilter === 'unmastered' && isM) return false;
      if (!q) return true;
      return (
        stripFurigana(item.word).toLowerCase().includes(q) ||
        item.reading.toLowerCase().includes(q) ||
        item.meaning.toLowerCase().includes(q)
      );
    });
  }, [vocab, masteredSet, listFilter, query]);

  const distractorPool = useMemo(() => {
    const map = new Map<string, VocabItem>();
    for (const item of vocab) map.set(`${scenario.id}:${item.id}`, item);
    for (const sc of allScenarios) {
      if (sc.id === scenario.id) continue;
      for (const item of sc.vocab ?? []) {
        map.set(`${sc.id}:${item.id}`, item);
      }
    }
    return Array.from(map.values());
  }, [vocab, allScenarios, scenario.id]);

  const startQuiz = (customItems?: VocabItem[]) => {
    const source =
      customItems ??
      (quizOnlyUnmastered ? vocab.filter((v) => !masteredSet.has(v.id)) : vocab);
    if (source.length === 0) return;

    const kinds: Array<'ja-to-zh' | 'audio-to-ja' | 'zh-to-ja'> = [
      'ja-to-zh',
      'audio-to-ja',
      'zh-to-ja',
    ];
    const items = shuffleArray(source);
    const questions: QuizQuestion[] = items.map((item, idx) => {
      const qk = quizKind === 'mixed' ? kinds[idx % kinds.length] : quizKind;
      const sameSceneOthers = shuffleArray(vocab.filter((v) => v.id !== item.id));
      const crossSceneOthers = shuffleArray(
        distractorPool.filter(
          (v) => stripFurigana(v.word) !== stripFurigana(item.word) && v.meaning !== item.meaning,
        ),
      );
      const picked: VocabItem[] = [];
      for (const cand of [...sameSceneOthers, ...crossSceneOthers]) {
        if (picked.length >= 3) break;
        if (
          cand.meaning !== item.meaning &&
          !picked.some((p) => p.meaning === cand.meaning || stripFurigana(p.word) === stripFurigana(cand.word))
        ) {
          picked.push(cand);
        }
      }
      const choices = shuffleArray([item, ...picked]);
      const answerIndex = choices.findIndex((c) => c === item);
      return { item, kind: qk, choices, answerIndex };
    });

    setQuizQuestions(questions);
    setQuizPos(0);
    setQuizSelected(null);
    setQuizWrongIds([]);
    setQuizCorrectCount(0);
    setQuizFinished(false);

    if (questions[0]?.kind === 'audio-to-ja') {
      speakJapanese(questions[0].item.reading || stripFurigana(questions[0].item.word));
    }
  };

  const handleSelectQuizChoice = (choiceIdx: number) => {
    if (quizSelected !== null) return;
    const current = quizQuestions[quizPos];
    if (!current) return;
    setQuizSelected(choiceIdx);
    if (choiceIdx === current.answerIndex) {
      setQuizCorrectCount((c) => c + 1);
    } else {
      setQuizWrongIds((prev) => (prev.includes(current.item.id) ? prev : [...prev, current.item.id]));
      setWordMastered(current.item.id, false);
    }
  };

  const handleNextQuiz = () => {
    const nextPos = quizPos + 1;
    if (nextPos >= quizQuestions.length) {
      setQuizFinished(true);
      return;
    }
    setQuizPos(nextPos);
    setQuizSelected(null);
    const nextQ = quizQuestions[nextPos];
    if (nextQ?.kind === 'audio-to-ja') {
      speakJapanese(nextQ.item.reading || stripFurigana(nextQ.item.word));
    }
  };

  const jumpToLineById = (lineId: string) => {
    const idx = scenario.lines.findIndex((l) => l.id === lineId);
    if (idx >= 0) onJumpToLine(idx);
  };

  if (!open) return null;

  const activeCard = cardOrder[cardIndex];
  const currentQuiz = quizQuestions[quizPos];

  return (
    <div className="vocab-backdrop" onClick={onClose}>
      <section
        className="vocab-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="本场景生词学习与测验"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="vocab-head">
          <div className="vocab-head-title">
            <h3>本场景生词学习</h3>
            <span className="vocab-progress-pill">
              已掌握 {masteredCount} / {vocab.length}
            </span>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭生词学习">
            <CloseIcon width={18} height={18} />
          </button>
        </header>

        <nav className="vocab-tabs" aria-label="生词学习模式">
          <button
            type="button"
            className={tab === 'list' ? 'vocab-tab is-active' : 'vocab-tab'}
            onClick={() => setTab('list')}
          >
            词汇精学
          </button>
          <button
            type="button"
            className={tab === 'cards' ? 'vocab-tab is-active' : 'vocab-tab'}
            onClick={() => setTab('cards')}
          >
            闪卡记忆
          </button>
          <button
            type="button"
            className={tab === 'quiz' ? 'vocab-tab is-active' : 'vocab-tab'}
            onClick={() => setTab('quiz')}
          >
            生词测验
          </button>
        </nav>

        <div className="vocab-body">
          {vocab.length === 0 ? (
            <div className="vocab-empty">本场景暂未配置生词表。</div>
          ) : tab === 'list' ? (
            <div className="vocab-list-pane">
              <div className="vocab-toolbar">
                <div className="vocab-filter-pills">
                  {(
                    [
                      ['all', `全部 (${vocab.length})`],
                      ['unmastered', `未掌握 (${vocab.length - masteredCount})`],
                      ['mastered', `已掌握 (${masteredCount})`],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      className={listFilter === key ? 'vocab-pill is-active' : 'vocab-pill'}
                      onClick={() => setListFilter(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <input
                  type="search"
                  className="vocab-search"
                  placeholder="搜索日语、假名或中文释义…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>

              <div className="vocab-items">
                {filteredList.length === 0 ? (
                  <div className="vocab-empty">没有符合条件的生词。</div>
                ) : (
                  filteredList.map((item) => {
                    const isM = masteredSet.has(item.id);
                    return (
                      <article
                        key={item.id}
                        className={isM ? 'vocab-item is-mastered' : 'vocab-item'}
                      >
                        <div className="vocab-item-top">
                          <div className="vocab-word-block">
                            <span className="vocab-word ja" lang="ja">
                              <Furigana text={item.word} />
                            </span>
                            <span className="vocab-reading">{item.reading}</span>
                            <span className="vocab-pos">{item.pos}</span>
                            {item.pitch && <span className="vocab-pitch">音调 {item.pitch}</span>}
                          </div>

                          <div className="vocab-item-actions">
                            <button
                              type="button"
                              className="vocab-mini-btn"
                              title="朗读词汇"
                              onClick={() => speakJapanese(item.reading || stripFurigana(item.word))}
                            >
                              <VolumeIcon width={14} height={14} />
                              <span>读音</span>
                            </button>
                            <button
                              type="button"
                              className="vocab-mini-btn"
                              title="跳转并播放原句"
                              onClick={() => jumpToLineById(item.lineId)}
                            >
                              <PlayIcon width={13} height={13} />
                              <span>原句</span>
                            </button>
                            <button
                              type="button"
                              className={isM ? 'vocab-master-btn is-done' : 'vocab-master-btn'}
                              onClick={() => toggleWordMastered(item.id)}
                            >
                              {isM ? '✓ 已掌握' : '标记掌握'}
                            </button>
                          </div>
                        </div>

                        <p className="vocab-meaning">{item.meaning}</p>
                        {item.note && (
                          <p className="vocab-note">
                            <Furigana text={item.note} />
                          </p>
                        )}
                      </article>
                    );
                  })
                )}
              </div>
            </div>
          ) : tab === 'cards' ? (
            <div className="vocab-cards-pane">
              <div className="vocab-toolbar">
                <div className="vocab-filter-pills">
                  <button
                    type="button"
                    className={cardOnlyUnmastered ? 'vocab-pill is-active' : 'vocab-pill'}
                    onClick={() => setCardOnlyUnmastered((v) => !v)}
                  >
                    仅看未掌握
                  </button>
                  <button
                    type="button"
                    className={cardShuffled ? 'vocab-pill is-active' : 'vocab-pill'}
                    onClick={() => setCardShuffled((v) => !v)}
                  >
                    <ShuffleIcon width={13} height={13} />
                    <span>乱序</span>
                  </button>
                  <button
                    type="button"
                    className={cardShowFuri ? 'vocab-pill is-active' : 'vocab-pill'}
                    onClick={() => setCardShowFuri((v) => !v)}
                  >
                    {cardShowFuri ? '假名：开' : '假名：关'}
                  </button>
                </div>
                <span className="vocab-counter">
                  {cardOrder.length ? `${cardIndex + 1} / ${cardOrder.length}` : '0 / 0'}
                </span>
              </div>

              {!activeCard ? (
                <div className="vocab-empty">当前筛选下没有需要记忆的卡片了，太棒了！</div>
              ) : (
                <>
                  <div
                    role="button"
                    tabIndex={0}
                    className={flipped ? 'vocab-flashcard is-flipped' : 'vocab-flashcard'}
                    onClick={() => setFlipped((f) => !f)}
                    onKeyDown={(e) => {
                      if (e.key === ' ' || e.key === 'Enter') {
                        e.preventDefault();
                        setFlipped((f) => !f);
                      }
                    }}
                  >
                    <div className="vocab-flashcard-meta">
                      <span className="vocab-pos">{activeCard.pos}</span>
                      {activeCard.pitch && <span className="vocab-pitch">音调 {activeCard.pitch}</span>}
                      <span className="vocab-flip-hint">{flipped ? '点击翻回正面' : '点击翻看释义'}</span>
                    </div>

                    <div className="vocab-flashcard-word ja" lang="ja">
                      {cardShowFuri ? <Furigana text={activeCard.word} /> : stripFurigana(activeCard.word)}
                    </div>

                    <div className="vocab-flashcard-sound">
                      <button
                        type="button"
                        className="vocab-mini-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          speakJapanese(activeCard.reading || stripFurigana(activeCard.word));
                        }}
                      >
                        <VolumeIcon width={15} height={15} />
                        <span>朗读</span>
                      </button>
                      <button
                        type="button"
                        className="vocab-mini-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          jumpToLineById(activeCard.lineId);
                        }}
                      >
                        <PlayIcon width={14} height={14} />
                        <span>听原句</span>
                      </button>
                    </div>

                    {flipped && (
                      <div className="vocab-flashcard-back">
                        <p className="vocab-flashcard-reading">{activeCard.reading}</p>
                        <p className="vocab-flashcard-meaning">{activeCard.meaning}</p>
                        {activeCard.note && (
                          <p className="vocab-note">
                            <Furigana text={activeCard.note} />
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="vocab-card-controls">
                    <button
                      type="button"
                      className="vocab-btn-secondary"
                      onClick={() => {
                        setWordMastered(activeCard.id, false);
                        setFlipped(false);
                        setCardIndex((i) => (i + 1) % cardOrder.length);
                      }}
                    >
                      还不熟 · 下一张
                    </button>
                    <button
                      type="button"
                      className="vocab-btn-primary"
                      onClick={() => {
                        setWordMastered(activeCard.id, true);
                        setFlipped(false);
                        if (cardOnlyUnmastered) {
                          setCardIndex((i) => (cardOrder.length <= 1 ? 0 : i % (cardOrder.length - 1)));
                        } else {
                          setCardIndex((i) => (i + 1) % cardOrder.length);
                        }
                      }}
                    >
                      ✓ 记住了 · 下一张
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="vocab-quiz-pane">
              {quizQuestions.length === 0 ? (
                <div className="vocab-quiz-setup">
                  <h4>选择测验题型</h4>
                  <div className="vocab-filter-pills">
                    {(
                      [
                        ['mixed', '综合混合'],
                        ['ja-to-zh', '看日选义'],
                        ['audio-to-ja', '听音辨词'],
                        ['zh-to-ja', '看义选词'],
                      ] as const
                    ).map(([k, label]) => (
                      <button
                        key={k}
                        type="button"
                        className={quizKind === k ? 'vocab-pill is-active' : 'vocab-pill'}
                        onClick={() => setQuizKind(k)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="vocab-filter-pills">
                    <button
                      type="button"
                      className={!quizOnlyUnmastered ? 'vocab-pill is-active' : 'vocab-pill'}
                      onClick={() => setQuizOnlyUnmastered(false)}
                    >
                      本场景全部 ({vocab.length} 词)
                    </button>
                    <button
                      type="button"
                      className={quizOnlyUnmastered ? 'vocab-pill is-active' : 'vocab-pill'}
                      onClick={() => setQuizOnlyUnmastered(true)}
                    >
                      仅未掌握 ({vocab.length - masteredCount} 词)
                    </button>
                  </div>

                  <button
                    type="button"
                    className="vocab-btn-primary vocab-start-quiz"
                    disabled={quizOnlyUnmastered && vocab.length - masteredCount === 0}
                    onClick={() => startQuiz()}
                  >
                    开始测验
                  </button>
                </div>
              ) : quizFinished ? (
                <div className="vocab-quiz-result">
                  <div className="vocab-score-box">
                    <span className="vocab-score-num">
                      {Math.round((quizCorrectCount / quizQuestions.length) * 100)}%
                    </span>
                    <span className="vocab-score-sub">
                      答对 {quizCorrectCount} / {quizQuestions.length} 题
                    </span>
                  </div>

                  {quizWrongIds.length > 0 ? (
                    <div className="vocab-wrong-list">
                      <h5>错题回顾（已自动取消“已掌握”标记）</h5>
                      {quizWrongIds.map((wid) => {
                        const w = vocab.find((v) => v.id === wid);
                        if (!w) return null;
                        return (
                          <div key={wid} className="vocab-wrong-row">
                            <span className="ja">
                              <Furigana text={w.word} />
                            </span>
                            <span className="vocab-reading">{w.reading}</span>
                            <span className="vocab-meaning-inline">{w.meaning}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="vocab-all-right">全部答对！本场景生词掌握得很扎实。</p>
                  )}

                  <div className="vocab-card-controls">
                    {quizWrongIds.length > 0 && (
                      <button
                        type="button"
                        className="vocab-btn-primary"
                        onClick={() =>
                          startQuiz(vocab.filter((v) => quizWrongIds.includes(v.id)))
                        }
                      >
                        仅重测错题 ({quizWrongIds.length})
                      </button>
                    )}
                    <button
                      type="button"
                      className="vocab-btn-secondary"
                      onClick={() => startQuiz()}
                    >
                      再测一轮
                    </button>
                    <button
                      type="button"
                      className="vocab-btn-secondary"
                      onClick={() => setQuizQuestions([])}
                    >
                      切换题型
                    </button>
                  </div>
                </div>
              ) : currentQuiz ? (
                <div className="vocab-quiz-run">
                  <div className="vocab-quiz-progress">
                    <span>
                      第 {quizPos + 1} / {quizQuestions.length} 题
                    </span>
                    <span>
                      {currentQuiz.kind === 'ja-to-zh'
                        ? '看日选义'
                        : currentQuiz.kind === 'audio-to-ja'
                          ? '听音辨词'
                          : '看义选词'}
                    </span>
                  </div>

                  <div className="vocab-quiz-prompt">
                    {currentQuiz.kind === 'ja-to-zh' ? (
                      <>
                        <div className="vocab-quiz-word ja" lang="ja">
                          <Furigana text={currentQuiz.item.word} />
                        </div>
                        <p className="vocab-reading">{currentQuiz.item.reading} · {currentQuiz.item.pos}</p>
                      </>
                    ) : currentQuiz.kind === 'audio-to-ja' ? (
                      <div className="vocab-quiz-audio">
                        <button
                          type="button"
                          className="vocab-btn-primary"
                          onClick={() =>
                            speakJapanese(
                              currentQuiz.item.reading || stripFurigana(currentQuiz.item.word),
                            )
                          }
                        >
                          <VolumeIcon width={16} height={16} />
                          <span>再听一遍读音</span>
                        </button>
                        <p className="vocab-quiz-hint">请根据读音选出对应的日语词汇</p>
                      </div>
                    ) : (
                      <div className="vocab-quiz-zh">{currentQuiz.item.meaning}</div>
                    )}
                  </div>

                  <div className="vocab-quiz-choices">
                    {currentQuiz.choices.map((choice, idx) => {
                      const answered = quizSelected !== null;
                      const isRight = answered && idx === currentQuiz.answerIndex;
                      const isWrong = answered && idx === quizSelected && idx !== currentQuiz.answerIndex;
                      const cls = [
                        'vocab-choice',
                        isRight ? 'is-right' : '',
                        isWrong ? 'is-wrong' : '',
                      ]
                        .filter(Boolean)
                        .join(' ');
                      return (
                        <button
                          key={idx}
                          type="button"
                          className={cls}
                          onClick={() => handleSelectQuizChoice(idx)}
                        >
                          <span className="vocab-choice-num">{idx + 1}</span>
                          {currentQuiz.kind === 'ja-to-zh' ? (
                            <span>{choice.meaning}</span>
                          ) : (
                            <span className="vocab-choice-ja ja">
                              {answered ? <Furigana text={choice.word} /> : stripFurigana(choice.word)}
                              {answered && (
                                <small className="vocab-choice-sub">
                                  （{choice.reading} · {choice.meaning}）
                                </small>
                              )}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {quizSelected !== null && (
                    <div className="vocab-quiz-feedback">
                      <p className="vocab-meaning">
                        <strong>{stripFurigana(currentQuiz.item.word)}</strong>（{currentQuiz.item.reading}）— {currentQuiz.item.meaning}
                      </p>
                      {currentQuiz.item.note && (
                        <p className="vocab-note">
                          <Furigana text={currentQuiz.item.note} />
                        </p>
                      )}
                      <div className="vocab-card-controls">
                        <button
                          type="button"
                          className="vocab-mini-btn"
                          onClick={() => jumpToLineById(currentQuiz.item.lineId)}
                        >
                          <PlayIcon width={13} height={13} />
                          <span>听原句</span>
                        </button>
                        <button
                          type="button"
                          className="vocab-btn-primary"
                          onClick={handleNextQuiz}
                        >
                          {quizPos + 1 >= quizQuestions.length ? '查看成绩' : '下一题'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
