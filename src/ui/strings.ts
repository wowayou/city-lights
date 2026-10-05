export interface Strings {
  lang: string;
  title: string;
  docTitle: string;
  tagline: string;
  daily: string;
  dailySub: (date: string, n: number) => string;
  dailyDone: (time: string, streak: number) => string;
  levels: string;
  levelSub: (n: number, w: number, h: number) => string;
  howto: string;
  hint: string;
  dailyTitle: (n: number) => string;
  levelTitle: (n: number) => string;
  moves: (n: number) => string;
  wonTitle: string;
  timeLabel: string;
  movesLabel: string;
  parLabel: string;
  streak: (n: number) => string;
  tomorrow: string;
  nextSize: (w: number, h: number) => string;
  share: string;
  next: string;
  home: string;
  copied: string;
  resetConfirm: string;
  date: (key: string) => string;
  shareText: (n: number, size: string, lanterns: string, time: string, moves: number, hints: number) => string;
  dailyResume: (time: string) => string;
  undo: string;
  hintBtn: string;
  reset: string;
  noUndo: string;
  hintConfirm: string;
  lockedTap: string;
  hintsUsed: (n: number) => string;
  replayMine: string;
  replayRef: string;
  playerMine: string;
  playerRef: string;
  close: string;
  allLevels: string;
  levelsTitle: string;
  levelsCount: (cleared: number) => string;
  aria: { home: string; reset: string; sound: string; board: string; restart: string; toggle: string; speed: string; seek: string };
}

const zh: Strings = {
  lang: 'zh-CN',
  title: '万家灯火',
  docTitle: '万家灯火 · City Lights',
  tagline: '转动电线，把每一户人家都点亮',
  daily: '今日一题',
  dailySub: (date, n) => `${date} · 第 ${n} 期`,
  dailyDone: (time, streak) => `已完成 · ${time}${streak > 1 ? ` · 连续 ${streak} 天` : ''}`,
  levels: '闯关',
  levelSub: (n, w, h) => `第 ${n} 关 · ${w}×${h}`,
  howto: '点击地块旋转电线，长按或右键锁定。\n每户都亮灯、没有悬空的线头，就过关。',
  hint: '点击旋转 · 长按锁定',
  dailyTitle: (n) => `今日 #${n}`,
  levelTitle: (n) => `第 ${n} 关`,
  moves: (n) => `${n} 步`,
  wonTitle: '灯火通明',
  timeLabel: '用时',
  movesLabel: '步数',
  parLabel: '参考步数',
  streak: (n) => `连续 ${n} 天`,
  tomorrow: '明天还有新的一题',
  nextSize: (w, h) => `下一关 ${w}×${h}`,
  share: '分享成绩',
  next: '下一关',
  home: '主页',
  copied: '成绩已复制',
  resetConfirm: '再点一次，从头开始',
  date: (key) => `${Number(key.slice(5, 7))}月${Number(key.slice(8, 10))}日`,
  shareText: (n, size, lanterns, time, moves, hints) => `万家灯火 #${n} · ${size}\n${lanterns} ${time} · ${moves} 步${hints ? ` · 💡${hints}` : ''}`,
  dailyResume: (time) => `继续 · 已用时 ${time}`,
  undo: '撤销',
  hintBtn: '提示',
  reset: '重来',
  noUndo: '没有可以撤销的操作',
  hintConfirm: '每次提示少一盏灯笼，再点一次确认',
  lockedTap: '这一格锁住了，长按解锁',
  hintsUsed: (n) => `用了 ${n} 次提示`,
  replayMine: '回放',
  replayRef: '参考解法',
  playerMine: '你的解法',
  playerRef: '参考解法',
  close: '返回',
  allLevels: '全部关卡',
  levelsTitle: '选关',
  levelsCount: (n) => `已通过 ${n} 关`,
  aria: { home: '返回主页', reset: '从头开始', sound: '声音开关', board: '电网棋盘', restart: '从头播放', toggle: '播放 / 暂停', speed: '播放速度', seek: '播放进度' },
};

const en: Strings = {
  lang: 'en',
  title: 'City Lights',
  docTitle: 'City Lights · 万家灯火',
  tagline: 'Turn the wires. Light every home.',
  daily: 'Daily puzzle',
  dailySub: (date, n) => `${date} · #${n}`,
  dailyDone: (time, streak) => `Solved · ${time}${streak > 1 ? ` · ${streak}-day streak` : ''}`,
  levels: 'Levels',
  levelSub: (n, w, h) => `Level ${n} · ${w}×${h}`,
  howto: 'Tap a tile to turn it; long-press or right-click to lock it.\nLight every home with no loose wires to win.',
  hint: 'Tap to turn · hold to lock',
  dailyTitle: (n) => `Daily #${n}`,
  levelTitle: (n) => `Level ${n}`,
  moves: (n) => `${n} ${n === 1 ? 'move' : 'moves'}`,
  wonTitle: 'All lights on',
  timeLabel: 'Time',
  movesLabel: 'Moves',
  parLabel: 'Reference',
  streak: (n) => `${n}-day streak`,
  tomorrow: 'A new puzzle tomorrow',
  nextSize: (w, h) => `Next: ${w}×${h}`,
  share: 'Share result',
  next: 'Next level',
  home: 'Home',
  copied: 'Result copied',
  resetConfirm: 'Tap again to start over',
  date: (key) => new Date(`${key}T12:00:00`).toLocaleDateString('en', { month: 'short', day: 'numeric' }),
  shareText: (n, size, lanterns, time, moves, hints) => `City Lights #${n} · ${size}\n${lanterns} ${time} · ${moves} moves${hints ? ` · 💡${hints}` : ''}`,
  dailyResume: (time) => `Continue · ${time} so far`,
  undo: 'Undo',
  hintBtn: 'Hint',
  reset: 'Restart',
  noUndo: 'Nothing to undo',
  hintConfirm: 'Each hint costs a lantern. Tap again to use one',
  lockedTap: 'This tile is locked. Hold to unlock',
  hintsUsed: (n) => `${n} ${n === 1 ? 'hint' : 'hints'} used`,
  replayMine: 'Replay',
  replayRef: 'Solution',
  playerMine: 'Your solve',
  playerRef: 'Reference solution',
  close: 'Done',
  allLevels: 'All levels',
  levelsTitle: 'Levels',
  levelsCount: (n) => `${n} cleared`,
  aria: { home: 'Back to home', reset: 'Start over', sound: 'Sound', board: 'Power grid board', restart: 'Play from the start', toggle: 'Play / pause', speed: 'Playback speed', seek: 'Playback position' },
};

export function pickStrings(languages: readonly string[]): Strings {
  for (const l of languages) {
    const lower = l.toLowerCase();
    if (lower.startsWith('zh')) return zh;
    if (lower.startsWith('en')) return en;
  }
  return en;
}
