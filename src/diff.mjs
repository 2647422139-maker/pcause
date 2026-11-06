// 行级 diff：把"旧提示词 → 新提示词"拆成若干 hunk（连续变更块）
// 每个 hunk 都是可独立回退的最小实验单元。

export function splitLines(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
}

// LCS 动态规划，返回编辑操作序列（equal / del / ins）
function lcsOps(a, b, { onDegrade } = {}) {
  const n = a.length;
  const m = b.length;
  // 提示词通常只有几十到几百行；超过阈值时退化为整段替换，保证不会卡死
  if (n * m > 4_000_000) {
    onDegrade?.(n, m);
    const ops = [];
    for (let i = 0; i < n; i++) ops.push({ op: 'del', ai: i });
    for (let j = 0; j < m; j++) ops.push({ op: 'ins', bi: j });
    return ops;
  }
  const dp = new Array(n + 1);
  for (let i = 0; i <= n; i++) dp[i] = new Int32Array(m + 1);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      ops.push({ op: 'equal', ai: i, bi: j });
      i++;
      j++;
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
      ops.push({ op: 'ins', bi: j });
      j++;
    } else {
      ops.push({ op: 'del', ai: i });
      i++;
    }
  }
  return ops;
}

/**
 * 计算 oldText → newText 的变更块。
 * 返回 [{ id, type: 'added'|'removed'|'modified', oldLines, newLines, oldStart, newStart, newEnd, context }]
 */
export function diffHunks(oldText, newText, { onDegrade } = {}) {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const ops = lcsOps(a, b, { onDegrade });

  const hunks = [];
  let cur = null;
  let oldPos = 0;
  let newPos = 0;
  const flush = () => {
    if (!cur) return;
    const type = cur.oldLines.length === 0 ? 'added' : cur.newLines.length === 0 ? 'removed' : 'modified';
    cur.type = type;
    cur.oldEnd = cur.oldStart + cur.oldLines.length;
    cur.newEnd = cur.newStart + cur.newLines.length;
    // 便于展示的上下文（前后各一行，且不属于任何变更）
    cur.contextBefore = b[Math.max(0, cur.newStart - 1)];
    cur.contextAfter = b[Math.min(b.length - 1, cur.newEnd)];
    hunks.push(cur);
    cur = null;
  };

  for (const op of ops) {
    if (op.op === 'equal') {
      flush();
      oldPos++;
      newPos++;
      continue;
    }
    if (!cur) {
      // 用累计计数定位，而不是靠对象引用，避免任何重排/浅拷贝导致的坐标错乱
      cur = { oldStart: oldPos, newStart: newPos, oldLines: [], newLines: [] };
    }
    if (op.op === 'del') {
      cur.oldLines.push(a[op.ai]);
      oldPos++;
    } else {
      cur.newLines.push(b[op.bi]);
      newPos++;
    }
  }
  flush();

  return hunks.map((h, idx) => ({ ...h, id: 'h' + (idx + 1), index: idx }));
}

/** 把 hunk 从新提示词里"回退"掉：added → 删除；modified → 还原旧行；removed → 插回旧行 */
export function revertHunk(newText, hunk) {
  const lines = splitLines(newText);
  // 防御：先校验 hunk 坐标处的内容确实是该 hunk 的新增行，不匹配就拒绝回退，
  // 否则会静默产出一份错误的提示词，让整个归因实验建立在错误输入上。
  for (let k = 0; k < hunk.newLines.length; k++) {
    if (lines[hunk.newStart + k] !== hunk.newLines[k]) {
      throw new Error(
        `hunk ${hunk.id || '(无 id)'} 与当前提示词不匹配（第 ${hunk.newStart + k} 行），拒绝回退以避免产生错误提示词`
      );
    }
  }
  const before = lines.slice(0, hunk.newStart);
  const after = lines.slice(hunk.newEnd);
  return [...before, ...hunk.oldLines, ...after].join('\n');
}

/** 人类可读的 hunk 摘要 */
export function describeHunk(hunk, maxLen = 60) {
  const clip = (s) => (s.length > maxLen ? s.slice(0, maxLen) + '…' : s);
  const join = (arr) => arr.map((l) => clip(l)).join(' / ');
  if (hunk.type === 'added') return '+ ' + join(hunk.newLines);
  if (hunk.type === 'removed') return '- ' + join(hunk.oldLines);
  return '~ ' + join(hunk.oldLines) + ' → ' + join(hunk.newLines);
}
