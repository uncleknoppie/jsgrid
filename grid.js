const _jsgridBase = (() => {
  const s = document.currentScript;
  return s ? s.src.replace(/[^/]+$/, '') : '';
})();

function jsgrid(div_node, row_count, col_count) {
  // Cell data: row 0 is header row
  const cellData = [];
  for (let r = 0; r <= row_count; r++) {
    cellData[r] = new Array(col_count).fill('');
    if (r === 0)
      for (let c = 0; c < col_count; c++) cellData[0][c] = colLabel(c);
  }

  function colLabel(c) {
    let s = '', n = c + 1;
    while (n > 0) {
      s = String.fromCharCode(64 + ((n - 1) % 26 + 1)) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  // Navigation state
  let anchorRow = 1, anchorCol = 0;
  let activeRow = 1, activeCol = 0;
  let selMode = 'cell'; // 'cell' | 'row' | 'col'

  // Edit state
  let editMode = false, editCell = null, editInput = null;

  // Cut/clipboard state
  let cutClipboard = null; // { srcRow, srcCol, rows, cols }

  // Drag state
  let dragging = false, draggingMode = 'cell'; // 'cell' | 'row' | 'col'

  // Undo / redo
  const undoStack = [], redoStack = [];

  // ── Build DOM ──────────────────────────────────────────────────────────────

  div_node.innerHTML = '';
  div_node.tabIndex = 0;
  div_node.style.cssText = 'outline:none; overflow:auto; position:relative;';

  if (!document.querySelector('link[data-jsg-css]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.dataset.jsgCss = '';
    link.href = _jsgridBase + 'grid.css';
    document.head.appendChild(link);
  }

  const wrap = document.createElement('div');
  wrap.className = 'jsg';
  div_node.appendChild(wrap);

  const table = document.createElement('table');
  wrap.appendChild(table);

  const domRows = []; // domRows[r][c] = th/td element
  const rnCells = []; // rnCells[r] = row-number cell element

  for (let r = 0; r <= row_count; r++) {
    const tr = document.createElement('tr');
    const drow = [];

    const rnEl = r === 0 ? document.createElement('th') : document.createElement('td');
    rnEl.className = 'rn';
    rnEl.textContent = r === 0 ? '' : r;
    rnEl.dataset.rn = r;
    tr.appendChild(rnEl);
    rnCells.push(rnEl);

    for (let c = 0; c < col_count; c++) {
      const el = r === 0 ? document.createElement('th') : document.createElement('td');
      el.className = r === 0 ? 'hdr' : 'cell';
      el.textContent = cellData[r][c];
      el.dataset.r = r;
      el.dataset.c = c;
      tr.appendChild(el);
      drow.push(el);
    }
    domRows.push(drow);
    table.appendChild(tr);
  }

  const dom = (r, c) => domRows[r]?.[c];

  // ── Selection helpers ──────────────────────────────────────────────────────

  // Returns the data bounds of the current selection.
  // Row/col modes expand to the full width/height of data rows.
  function selBounds() {
    if (selMode === 'row') return {
      r1: Math.min(anchorRow, activeRow), r2: Math.max(anchorRow, activeRow),
      c1: 0, c2: col_count - 1,
    };
    if (selMode === 'col') return {
      r1: 1, r2: row_count, // data rows only; header highlighting is separate
      c1: Math.min(anchorCol, activeCol), c2: Math.max(anchorCol, activeCol),
    };
    return {
      r1: Math.min(anchorRow, activeRow), r2: Math.max(anchorRow, activeRow),
      c1: Math.min(anchorCol, activeCol), c2: Math.max(anchorCol, activeCol),
    };
  }

  function inSel(r, c) {
    const b = selBounds();
    return r >= b.r1 && r <= b.r2 && c >= b.c1 && c <= b.c2;
  }

  function inCut(r, c) {
    if (!cutClipboard) return false;
    const { srcRow, srcCol, rows, cols } = cutClipboard;
    return r >= srcRow && r < srcRow + rows && c >= srcCol && c < srcCol + cols;
  }

  // The cell that shows the blue focus border
  function activeCell() {
    if (selMode === 'row') return { r: activeRow, c: 0 };
    if (selMode === 'col') return { r: 1,         c: activeCol };
    return { r: activeRow, c: activeCol };
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  function render() {
    const ac = activeCell();
    const single = selMode === 'cell' && anchorRow === activeRow && anchorCol === activeCol;

    for (let r = 0; r <= row_count; r++) {
      for (let c = 0; c < col_count; c++) {
        const el = dom(r, c);
        if (!el) continue;
        const isActive = r === ac.r && c === ac.c;
        const isSel    = !single && inSel(r, c) && !isActive;
        const isCut    = !isActive && inCut(r, c);
        el.classList.toggle('active',  isActive);
        el.classList.toggle('sel',     isSel);
        el.classList.toggle('cut',     isCut);
      }
    }

    // Row-number cells: highlight when their row is selected
    for (let r = 1; r <= row_count; r++) {
      const sel = selMode === 'row' &&
        r >= Math.min(anchorRow, activeRow) && r <= Math.max(anchorRow, activeRow);
      rnCells[r]?.classList.toggle('hdr-sel', sel);
    }

    // Column header cells (row 0): highlight when their column is selected
    for (let c = 0; c < col_count; c++) {
      const sel = selMode === 'col' &&
        c >= Math.min(anchorCol, activeCol) && c <= Math.max(anchorCol, activeCol);
      dom(0, c)?.classList.toggle('hdr-sel', sel);
    }
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  function go(r, c, extend = false) {
    selMode = 'cell';
    r = Math.max(0, Math.min(row_count, r));
    c = Math.max(0, Math.min(col_count - 1, c));
    activeRow = r; activeCol = c;
    if (!extend) { anchorRow = r; anchorCol = c; }
    render();
    dom(r, c)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function selectRows(r1, r2) {
    selMode = 'row';
    anchorRow = r1; activeRow = r2;
    anchorCol = 0;  activeCol = 0;
    render();
    rnCells[r2]?.scrollIntoView({ block: 'nearest' });
  }

  function selectCols(c1, c2) {
    selMode = 'col';
    anchorCol = c1; activeCol = c2;
    anchorRow = 1;  activeRow = 1;
    render();
    dom(0, c2)?.scrollIntoView({ inline: 'nearest' });
  }

  // ── Edit mode ──────────────────────────────────────────────────────────────

  function startEdit(r, c, initChar = null) {
    if (editMode) commitEdit();
    if (r < 0 || r > row_count || c < 0 || c >= col_count) return;

    editMode = true;
    editCell = { r, c };
    go(r, c);

    const el = dom(r, c);
    editInput = document.createElement('input');
    editInput.type = 'text';
    editInput.className = 'jsg-inp';
    editInput.value = initChar !== null ? initChar : cellData[r][c];
    el.textContent = '';
    el.appendChild(editInput);
    editInput.focus();
    editInput.selectionStart = editInput.selectionEnd = editInput.value.length;

    editInput.addEventListener('keydown', onEditKey);
    editInput.addEventListener('blur', () => { if (editMode) commitEdit(); });
  }

  function commitEdit() {
    if (!editMode) return;
    const { r, c } = editCell;
    const newVal = editInput.value, oldVal = cellData[r][c];
    editMode = false; editInput = null; editCell = null;
    if (newVal !== oldVal) applyChanges([{ r, c, newVal, oldVal }]);
    dom(r, c).textContent = cellData[r][c];
    render();
    div_node.focus();
  }

  function cancelEdit() {
    if (!editMode) return;
    const { r, c } = editCell;
    editMode = false; editInput = null; editCell = null;
    dom(r, c).textContent = cellData[r][c];
    render();
    div_node.focus();
  }

  function onEditKey(e) {
    switch (e.key) {
      case 'Enter':
        e.preventDefault(); e.stopPropagation();
        commitEdit();
        go(e.shiftKey ? activeRow - 1 : activeRow + 1, activeCol);
        break;
      case 'Tab':
        e.preventDefault(); e.stopPropagation();
        commitEdit();
        go(activeRow, e.shiftKey ? activeCol - 1 : activeCol + 1);
        break;
      case 'Escape':
        e.preventDefault(); e.stopPropagation();
        cancelEdit();
        break;
      case 'ArrowUp':
      case 'ArrowDown':
        e.preventDefault(); e.stopPropagation();
        commitEdit();
        go(activeRow + (e.key === 'ArrowDown' ? 1 : -1), activeCol);
        break;
    }
  }

  // ── Undo / Redo ────────────────────────────────────────────────────────────

  // changes: [{r, c, oldVal, newVal}, ...]
  function applyChanges(changes) {
    undoStack.push(changes);
    redoStack.length = 0;
    for (const { r, c, newVal } of changes) {
      cellData[r][c] = newVal;
      dom(r, c).textContent = newVal;
    }
  }

  function undo() {
    if (!undoStack.length) return;
    const ch = undoStack.pop();
    redoStack.push(ch);
    for (const { r, c, oldVal } of ch) { cellData[r][c] = oldVal; dom(r, c).textContent = oldVal; }
    render();
  }

  function redo() {
    if (!redoStack.length) return;
    const ch = redoStack.pop();
    undoStack.push(ch);
    for (const { r, c, newVal } of ch) { cellData[r][c] = newVal; dom(r, c).textContent = newVal; }
    render();
  }

  // ── Clipboard ──────────────────────────────────────────────────────────────

  function selToTSV() {
    const b = selBounds();
    return Array.from({ length: b.r2 - b.r1 + 1 }, (_, i) =>
      Array.from({ length: b.c2 - b.c1 + 1 }, (_, j) =>
        cellData[b.r1 + i][b.c1 + j]
      ).join('\t')
    ).join('\n');
  }

  div_node.addEventListener('copy', (e) => {
    if (editMode) return;
    e.preventDefault();
    cutClipboard = null;
    e.clipboardData.setData('text/plain', selToTSV());
    render();
  });

  div_node.addEventListener('cut', (e) => {
    if (editMode) return;
    e.preventDefault();
    const b = selBounds();
    cutClipboard = { srcRow: b.r1, srcCol: b.c1, rows: b.r2 - b.r1 + 1, cols: b.c2 - b.c1 + 1 };
    e.clipboardData.setData('text/plain', selToTSV());
    render();
  });

  div_node.addEventListener('paste', (e) => {
    if (editMode) return;
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;

    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    const pasteData = lines.map(l => l.split('\t'));

    // Paste starts at the top-left corner of the current selection
    const { r1: pasteRow, c1: pasteCol } = selBounds();

    const changes = [];

    if (cutClipboard) {
      const { srcRow, srcCol, rows, cols } = cutClipboard;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const tr = srcRow + r, tc = srcCol + c;
          if (cellData[tr][tc] !== '')
            changes.push({ r: tr, c: tc, oldVal: cellData[tr][tc], newVal: '' });
        }
      cutClipboard = null;
    }

    for (let r = 0; r < pasteData.length; r++)
      for (let c = 0; c < pasteData[r].length; c++) {
        const tr = pasteRow + r, tc = pasteCol + c;
        if (tr <= row_count && tc < col_count)
          changes.push({ r: tr, c: tc, oldVal: cellData[tr][tc], newVal: pasteData[r][c] });
      }

    if (changes.length) applyChanges(changes);
    render();
  });

  function deleteSelection() {
    const b = selBounds();
    const changes = [];
    for (let r = b.r1; r <= b.r2; r++)
      for (let c = b.c1; c <= b.c2; c++)
        if (cellData[r][c] !== '')
          changes.push({ r, c, oldVal: cellData[r][c], newVal: '' });
    if (changes.length) applyChanges(changes);
  }

  // ── Mouse ──────────────────────────────────────────────────────────────────

  table.addEventListener('mousedown', (e) => {
    // Row-number header click → select entire row(s)
    const rnEl = e.target.closest('[data-rn]');
    if (rnEl) {
      const r = +rnEl.dataset.rn;
      if (r === 0) return; // corner cell — ignore
      if (editMode) commitEdit();
      dragging = true; draggingMode = 'row';
      if (e.shiftKey && selMode === 'row') {
        activeRow = r; render();
      } else {
        selectRows(r, r);
      }
      div_node.focus();
      e.preventDefault();
      return;
    }

    const el = e.target.closest('[data-r]');
    if (!el) return;
    const r = +el.dataset.r, c = +el.dataset.c;

    // Column header click (row 0) → select entire column(s)
    if (r === 0) {
      if (editMode && (editCell.r !== 0 || editCell.c !== c)) commitEdit();
      else if (editMode) return;
      dragging = true; draggingMode = 'col';
      if (e.shiftKey && selMode === 'col') {
        activeCol = c; render();
      } else {
        selectCols(c, c);
      }
      div_node.focus();
      e.preventDefault();
      return;
    }

    // Data cell click
    if (editMode) {
      if (editCell.r === r && editCell.c === c) return;
      commitEdit();
    }
    dragging = true; draggingMode = 'cell';
    go(r, c, e.shiftKey);
    div_node.focus();
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    if (draggingMode === 'row') {
      const rnEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-rn]');
      if (rnEl) {
        const r = +rnEl.dataset.rn;
        if (r > 0) { activeRow = r; render(); }
      }
    } else if (draggingMode === 'col') {
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-r]');
      if (el && +el.dataset.r === 0) { activeCol = +el.dataset.c; render(); }
    } else {
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-r]');
      if (!el) return;
      activeRow = +el.dataset.r; activeCol = +el.dataset.c;
      render();
    }
  });

  document.addEventListener('mouseup', () => { dragging = false; });

  table.addEventListener('dblclick', (e) => {
    const el = e.target.closest('[data-r]');
    if (el) startEdit(+el.dataset.r, +el.dataset.c);
  });

  // ── Keyboard ───────────────────────────────────────────────────────────────

  div_node.addEventListener('keydown', (e) => {
    if (editMode) return;
    const ctrl = e.ctrlKey || e.metaKey;

    // Undo / Redo
    if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if (ctrl && (e.key.toLowerCase() === 'z' && e.shiftKey || e.key.toLowerCase() === 'y')) {
      e.preventDefault(); redo(); return;
    }

    // Let Ctrl+C / Ctrl+X / Ctrl+V bubble to clipboard events
    if (ctrl && 'cxv'.includes(e.key.toLowerCase())) return;

    // Row/col mode: Shift+arrow expands the header selection
    if (selMode === 'row' && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      activeRow = Math.max(1, Math.min(row_count, activeRow + (e.key === 'ArrowDown' ? 1 : -1)));
      render();
      rnCells[activeRow]?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (selMode === 'col' && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      activeCol = Math.max(0, Math.min(col_count - 1, activeCol + (e.key === 'ArrowRight' ? 1 : -1)));
      render();
      dom(0, activeCol)?.scrollIntoView({ inline: 'nearest' });
      return;
    }

    // Resolve the focused cell for commands that operate on a single cell
    const ac = activeCell();

    switch (e.key) {
      case 'ArrowUp':    e.preventDefault(); go(ac.r - 1, ac.c, e.shiftKey); break;
      case 'ArrowDown':  e.preventDefault(); go(ac.r + 1, ac.c, e.shiftKey); break;
      case 'ArrowLeft':  e.preventDefault(); go(ac.r, ac.c - 1, e.shiftKey); break;
      case 'ArrowRight': e.preventDefault(); go(ac.r, ac.c + 1, e.shiftKey); break;
      case 'Tab':
        e.preventDefault();
        go(ac.r, e.shiftKey ? ac.c - 1 : ac.c + 1);
        break;
      case 'Enter':
        e.preventDefault();
        go(e.shiftKey ? ac.r - 1 : ac.r + 1, ac.c);
        break;
      case 'F2':
        e.preventDefault();
        startEdit(ac.r, ac.c);
        break;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        deleteSelection();
        break;
      case 'Escape':
        e.preventDefault();
        cutClipboard = null;
        render();
        break;
      default:
        if (e.key.length === 1 && !ctrl && !e.altKey) {
          e.preventDefault();
          startEdit(ac.r, ac.c, e.key);
        }
    }
  });

  // ── Init ───────────────────────────────────────────────────────────────────

  render();
  div_node.focus();
}
