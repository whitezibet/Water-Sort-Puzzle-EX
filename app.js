"use strict";

/* ゲーム設定：色数や容量はここから変更できます。 */
const SETTINGS = {
  capacity: 5,
  colorCount: 6,
  emptyTubeCount: 2,
  scrambleMoves: 90,
  pointsPerCompletedTube: 1000,
  mistakePenalty: 100,
  maximumMoveBonus: 3000,
  pointsLostPerMove: 50
};

const PALETTE_SETTINGS = {
  minimumHueSpread: 7,
  maximumHueSpread: 11,
  saturation: 68,
  lightness: 52
};

const boardElement = document.getElementById("tube-board");
const statusElement = document.getElementById("status");
const moveCountElement = document.getElementById("move-count");
const undoButton = document.getElementById("undo-button");
const restartButton = document.getElementById("restart-button");
const newGameButton = document.getElementById("new-game-button");
const clearDialog = document.getElementById("clear-dialog");
const clearMoves = document.getElementById("clear-moves");
const clearScore = document.getElementById("clear-score");
const scoreBreakdown = document.getElementById("score-breakdown");
const clearNewGameButton = document.getElementById("clear-new-game");

let tubes = [];
let initialTubes = [];
let selectedTubeIndex = null;
let history = [];
let moveCount = 0;
let mistakeCount = 0;
let animationLocked = false;
let currentPalette = [];

const cloneTubes = (source) => source.map((tube) => [...tube]);

/** クリア時だけ、完成数・お手つき・手数から最終スコアを計算します。 */
function calculateFinalScore(state = tubes, moves = moveCount, mistakes = mistakeCount) {
  const completedTubeCount = state.filter((tube) => tube.length > 0 && isTubeComplete(tube)).length;
  const completionScore = completedTubeCount * SETTINGS.pointsPerCompletedTube;
  const mistakeDeduction = mistakes * SETTINGS.mistakePenalty;
  const moveBonus = Math.max(0, SETTINGS.maximumMoveBonus - moves * SETTINGS.pointsLostPerMove);

  return {
    completedTubeCount,
    completionScore,
    mistakeDeduction,
    moveBonus,
    total: Math.max(0, completionScore - mistakeDeduction + moveBonus)
  };
}

/** NEW GAMEごとに、ランダムな色帯から互いに近い6色を作ります。 */
function createCloseColorPalette() {
  const centerHue = Math.floor(Math.random() * 360);
  const hueSpread = PALETTE_SETTINGS.minimumHueSpread
    + Math.random() * (PALETTE_SETTINGS.maximumHueSpread - PALETTE_SETTINGS.minimumHueSpread);
  const hueStep = hueSpread / Math.max(1, SETTINGS.colorCount - 1);
  const firstHue = centerHue - hueSpread / 2;

  const palette = Array.from({ length: SETTINGS.colorCount }, (_, index) => {
    const hue = (firstHue + hueStep * index + 360) % 360;
    // 彩度・明度にもごく小さな差を付け、判別可能なぎりぎりを狙います。
    const saturation = PALETTE_SETTINGS.saturation + (index % 3 - 1) * 0.5;
    const lightness = PALETTE_SETTINGS.lightness + (index % 2 === 0 ? -0.55 : 0.55);
    return `hsl(${hue.toFixed(1)} ${saturation.toFixed(1)}% ${lightness.toFixed(1)}%)`;
  });

  // 色番号と明暗の並びが毎回同じにならないよう、表示色だけを並べ替えます。
  for (let index = palette.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [palette[index], palette[randomIndex]] = [palette[randomIndex], palette[index]];
  }
  return palette;
}

/** 通常ルールで移せる液体の色と個数を返します。 */
function getValidMove(state, fromIndex, toIndex) {
  if (fromIndex === toIndex) return null;

  const from = state[fromIndex];
  const to = state[toIndex];
  if (!from || !to || from.length === 0 || to.length >= SETTINGS.capacity) return null;

  const color = from[from.length - 1];
  const destinationTop = to[to.length - 1];
  if (destinationTop !== undefined && destinationTop !== color) return null;

  let consecutiveCount = 1;
  for (let index = from.length - 2; index >= 0 && from[index] === color; index -= 1) {
    consecutiveCount += 1;
  }

  return {
    color,
    amount: Math.min(consecutiveCount, SETTINGS.capacity - to.length)
  };
}

function applyMove(state, fromIndex, toIndex, amount) {
  const moved = state[fromIndex].splice(-amount);
  state[toIndex].push(...moved);
}

/** 完成状態から逆向きに崩すため、生成された問題には必ず解法が存在します。 */
function generateSolvablePuzzle() {
  let puzzle = null;

  // 逆操作を何度か試し、混ざった6本＋空2本の状態を採用します。
  for (let attempt = 0; attempt < 20 && !puzzle; attempt += 1) {
    const state = Array.from({ length: SETTINGS.colorCount }, (_, color) =>
      Array(SETTINGS.capacity).fill(color)
    );
    state.push(...Array.from({ length: SETTINGS.emptyTubeCount }, () => []));
    let previousMove = null;

    for (let step = 0; step < SETTINGS.scrambleMoves; step += 1) {
      const candidates = [];

      state.forEach((from, fromIndex) => {
        if (from.length === 0) return;
        const color = from[from.length - 1];
        let groupSize = 1;
        while (groupSize < from.length && from[from.length - 1 - groupSize] === color) groupSize += 1;

        state.forEach((to, toIndex) => {
          if (fromIndex === toIndex || to.length >= SETTINGS.capacity) return;
          const targetColor = to[to.length - 1];
          // 同色の上へ置くと逆操作時に塊が結合するため、生成処理では除外します。
          if (targetColor === color) return;
          const maxAmount = Math.min(groupSize, SETTINGS.capacity - to.length);
          for (let amount = 1; amount <= maxAmount; amount += 1) {
            const inverseMoveIsValid = amount < groupSize || from.length === amount;
            if (!inverseMoveIsValid) continue;
            if (previousMove && previousMove.from === toIndex && previousMove.to === fromIndex && previousMove.amount === amount) continue;
            candidates.push({ from: fromIndex, to: toIndex, amount });
          }
        });
      });

      if (candidates.length === 0) break;
      const move = candidates[Math.floor(Math.random() * candidates.length)];
      applyMove(state, move.from, move.to, move.amount);
      previousMove = move;

      const emptyCount = state.filter((tube) => tube.length === 0).length;
      const mixedCount = state.filter((tube) => new Set(tube).size > 1).length;
      if (step > SETTINGS.colorCount * 4
        && emptyCount === SETTINGS.emptyTubeCount
        && mixedCount === SETTINGS.colorCount) {
        puzzle = cloneTubes(state);
      }
    }
  }

  // ごく稀に候補ができない場合も、逆操作を再実行します。
  if (!puzzle) return generateSolvablePuzzle();

  // 容器の並びも変え、同じ問題に見えにくくします。
  for (let index = puzzle.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [puzzle[index], puzzle[randomIndex]] = [puzzle[randomIndex], puzzle[index]];
  }
  return puzzle;
}

function isTubeComplete(tube) {
  return tube.length === 0 || (
    tube.length === SETTINGS.capacity && tube.every((color) => color === tube[0])
  );
}

function isPuzzleComplete(state = tubes) {
  return state.every(isTubeComplete);
}

function renderBoard() {
  boardElement.replaceChildren();

  tubes.forEach((tube, tubeIndex) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tube-button";
    button.dataset.tubeIndex = String(tubeIndex);
    button.setAttribute("aria-label", `試験管${tubeIndex + 1}、液体${tube.length}層`);
    button.setAttribute("aria-pressed", String(selectedTubeIndex === tubeIndex));
    button.classList.toggle("is-selected", selectedTubeIndex === tubeIndex);
    const tubeIsComplete = tube.length === SETTINGS.capacity && isTubeComplete(tube);
    button.classList.toggle("is-complete", tubeIsComplete);
    if (tubeIsComplete) {
      button.setAttribute("aria-label", `試験管${tubeIndex + 1}、完成済み`);
    }

    const tubeElement = document.createElement("span");
    tubeElement.className = "tube";
    tube.forEach((colorIndex) => {
      const layer = document.createElement("span");
      layer.className = "liquid-layer";
      layer.style.setProperty("--liquid-color", currentPalette[colorIndex]);
      tubeElement.append(layer);
    });

    button.append(tubeElement );
    boardElement.append(button);
  });

  moveCountElement.textContent = String(moveCount);
  undoButton.disabled = history.length === 0;
}

/** 対象の試験管へgood／badの画像をポヨンと表示し、終了後に削除します。 */
function showTubeEffect(tubeIndex, effectName) {
  const tubeButton = boardElement.querySelector(`[data-tube-index="${tubeIndex}"]`);
  if (!tubeButton) return;

  const effect = document.createElement("img");
  effect.className = "result-effect";
  effect.src = `asset/Effect/${effectName}.svg`;
  effect.alt = "";
  effect.setAttribute("aria-hidden", "true");
  tubeButton.append(effect);
  effect.addEventListener("animationend", () => effect.remove(), { once: true });
  window.setTimeout(() => effect.remove(), 850);
}

function registerMistake(tubeIndex, message) {
  mistakeCount += 1;
  setStatus(message, true);
  renderBoard();
  showTubeEffect(tubeIndex, "bad");
}

function setStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.classList.remove("is-error");
  if (isError) {
    void statusElement.offsetWidth;
    statusElement.classList.add("is-error");
  }
}

function selectTube(tubeIndex) {
  if (animationLocked) return;

  if (selectedTubeIndex === null) {
    if (tubes[tubeIndex].length === 0) {
      registerMistake(tubeIndex, "移動できません。");
      return;
    }
    selectedTubeIndex = tubeIndex;
    setStatus(``);
    renderBoard();
    return;
  }

  if (selectedTubeIndex === tubeIndex) {
    selectedTubeIndex = null;
    setStatus("選択を解除しました");
    renderBoard();
    return;
  }

  const fromIndex = selectedTubeIndex;
  const move = getValidMove(tubes, fromIndex, tubeIndex);
  if (!move) {
    selectedTubeIndex = null;
    registerMistake(tubeIndex, "そこには移せません。(-100)");
    return;
  }

  const destinationWasComplete = isTubeComplete(tubes[tubeIndex]) && tubes[tubeIndex].length > 0;
  history.push(cloneTubes(tubes));
  applyMove(tubes, fromIndex, tubeIndex, move.amount);
  selectedTubeIndex = null;
  moveCount += 1;
  animationLocked = true;
  const destinationIsNewlyComplete = !destinationWasComplete
    && isTubeComplete(tubes[tubeIndex])
    && tubes[tubeIndex].length === SETTINGS.capacity;
  renderBoard();
  const destination = boardElement.querySelector(`[data-tube-index="${tubeIndex}"]`);
  destination?.classList.add("is-pouring");
  if (destinationIsNewlyComplete) showTubeEffect(tubeIndex, "good");
  setStatus(`${move.amount}層の液体を移しました`);

  window.setTimeout(() => {
    animationLocked = false;
    destination?.classList.remove("is-pouring");
    if (isPuzzleComplete()) showClearDialog();
  }, 370);
}

function undoMove() {
  if (history.length === 0 || animationLocked) return;
  tubes = history.pop();
  selectedTubeIndex = null;
  moveCount = Math.max(0, moveCount - 1);
  clearDialog.hidden = true;
  setStatus("一手戻しました");
  renderBoard();
}

function restartGame() {
  tubes = cloneTubes(initialTubes);
  selectedTubeIndex = null;
  history = [];
  moveCount = 0;
  mistakeCount = 0;
  animationLocked = false;
  clearDialog.hidden = true;
  setStatus("最初の状態に戻しました");
  renderBoard();
}

function startNewGame() {
  let nextPuzzle;
  do {
    nextPuzzle = generateSolvablePuzzle();
  } while (isPuzzleComplete(nextPuzzle));

  tubes = nextPuzzle;
  currentPalette = createCloseColorPalette();
  initialTubes = cloneTubes(tubes);
  selectedTubeIndex = null;
  history = [];
  moveCount = 0;
  mistakeCount = 0;
  animationLocked = false;
  clearDialog.hidden = true;
  setStatus("新しい問題です。移動元を選んでください");
  renderBoard();
}

function showClearDialog() {
  const result = calculateFinalScore();
  clearMoves.textContent = String(moveCount);
  clearScore.textContent = result.total.toLocaleString("ja-JP");
  scoreBreakdown.textContent = `完成 ${result.completionScore.toLocaleString("ja-JP")} ＋ 手数ボーナス ${result.moveBonus.toLocaleString("ja-JP")} − お手つき ${result.mistakeDeduction.toLocaleString("ja-JP")}`;
  clearDialog.hidden = false;
  clearNewGameButton.focus();
}

boardElement.addEventListener("click", (event) => {
  const tubeButton = event.target.closest(".tube-button");
  if (tubeButton) selectTube(Number(tubeButton.dataset.tubeIndex));
});

undoButton.addEventListener("click", undoMove);
restartButton.addEventListener("click", restartGame);
newGameButton.addEventListener("click", startNewGame);
clearNewGameButton.addEventListener("click", startNewGame);

// 簡単な自動テストやデバッグに使える公開APIです。
window.waterSortGame = {
  SETTINGS,
  getValidMove,
  applyMove,
  isPuzzleComplete,
  generateSolvablePuzzle,
  createCloseColorPalette,
  getState: () => cloneTubes(tubes),
  getPalette: () => [...currentPalette],
  getMoveCount: () => moveCount,
  getMistakeCount: () => mistakeCount,
  getSelectedTubeIndex: () => selectedTubeIndex,
  calculateFinalScore,
  getHistoryLength: () => history.length,
  selectTube,
  undoMove,
  restartGame,
  startNewGame
};

startNewGame();
