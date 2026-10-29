'use strict';

/* --------------------------------------------------------------------- api */

function createPreviewApi() {
  const KEY = 'simple-todo-preview-v1';
  const now = Date.now();
  const seed = {
    items: [
      { id: 'p1', text: '整理本周的测试记录', createdAt: now - 3600e3 },
      { id: 'p2', text: '把评审意见汇总成一页', createdAt: now - 3000e3 },
    ],
    history: [
      { id: 'p3', text: '确认新板的默认配置', createdAt: now - 9000e3, completedAt: now - 5400e3 },
      { id: 'p4', text: '整理会议纪要并发给组里', createdAt: now - 90000e3, completedAt: now - 86400e3 },
    ],
    settings: { alwaysOnTop: false, launchAtLogin: false },
  };
  let data = null;
  try {
    data = JSON.parse(localStorage.getItem(KEY));
  } catch (_) {}
  if (!data || !data.items) data = seed;
  return {
    init: async () => ({
      data: { items: data.items, history: data.history },
      settings: data.settings || {},
      version: '1.0.0',
      packaged: false,
    }),
    save: (p) => {
      data = Object.assign({}, data, p);
      try {
        localStorage.setItem(KEY, JSON.stringify(data));
      } catch (_) {}
    },
    pin: () => {},
    hide: () => {},
    quit: () => {},
    launchAtLogin: (on) => {
      data.settings = Object.assign({}, data.settings, { launchAtLogin: !!on });
    },
    openDataFolder: () => {},
    bounds: async () => ({ x: 0, y: 0, width: 320, height: 300 }),
    setBounds: () => {},
    onState: () => {},
  };
}

const bridge = window.api || createPreviewApi();

/* ------------------------------------------------------------------- state */

const state = {
  items: [],
  history: [],
  settings: { alwaysOnTop: false, launchAtLogin: false },
  version: '1.0.0',
  view: 'main',
  editingId: null,
  dragId: null,
};

const els = {
  list: document.getElementById('list'),
  addrow: document.getElementById('addrow'),
  viewMain: document.getElementById('view-main'),
  viewHistory: document.getElementById('view-history'),
  hlist: document.getElementById('hlist'),
  btnAdd: document.getElementById('btn-add'),
  btnBack: document.getElementById('btn-back'),
  barTitle: document.getElementById('bar-title'),
  btnPin: document.getElementById('btn-pin'),
  btnHistory: document.getElementById('btn-history'),
  btnMore: document.getElementById('btn-more'),
  btnClose: document.getElementById('btn-close'),
  btnClear: document.getElementById('btn-clear'),
  toast: document.getElementById('toast'),
  toastText: document.getElementById('toast-text'),
  toastUndo: document.getElementById('toast-undo'),
  menu: document.getElementById('menu'),
  miStartup: document.getElementById('mi-startup'),
  ckStartup: document.getElementById('ck-startup'),
  miFolder: document.getElementById('mi-folder'),
  miAbout: document.getElementById('mi-about'),
  miQuit: document.getElementById('mi-quit'),
};

/* --------------------------------------------------------------- utilities */

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function persist() {
  bridge.save({ items: state.items, history: state.history });
}

function findRow(id) {
  return Array.prototype.find.call(els.list.children, (el) => el && el.dataset.id === id);
}

function dayStart(ts) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function dayKey(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
}

function dayLabel(ts) {
  const diff = Math.round((dayStart(Date.now()) - dayStart(ts)) / 86400000);
  const d = new Date(ts);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  if (d.getFullYear() === new Date().getFullYear()) {
    return d.getMonth() + 1 + ' 月 ' + d.getDate() + ' 日';
  }
  return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
}

function clockText(ts) {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function keepScroll(el, fn) {
  const top = el.scrollTop;
  fn();
  el.scrollTop = top;
}

/* ------------------------------------------------------------------ toast */

let toastTimer = null;
let toastUndo = null;

function showToast(text, options) {
  const opts = options || {};
  els.toastText.textContent = text;
  els.toast.hidden = false;
  els.toastUndo.hidden = !opts.undo;
  toastUndo = opts.undo || null;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, opts.ttl || (opts.undo ? 5200 : 1900));
}

function hideToast() {
  clearTimeout(toastTimer);
  els.toast.hidden = true;
  toastUndo = null;
}

els.toastUndo.addEventListener('click', () => {
  const fn = toastUndo;
  hideToast();
  if (fn) fn();
});

/* -------------------------------------------------------------- main list */

function renderMain() {
  keepScroll(els.list, () => {
    els.list.textContent = '';
    if (!state.items.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.innerHTML = '还没有待办<br>点下面一行开始';
      els.list.appendChild(li);
      return;
    }
    state.items.forEach((item) => els.list.appendChild(itemRow(item)));
  });
}

function itemRow(item) {
  const li = document.createElement('li');
  li.className = 'item';
  li.dataset.id = item.id;
  li.draggable = true;

  const box = document.createElement('button');
  box.className = 'box';
  box.type = 'button';
  box.title = '标记完成';
  box.setAttribute('aria-label', '标记完成');
  box.addEventListener('mousedown', (e) => e.preventDefault());
  box.addEventListener('click', () => complete(item.id));

  const text = document.createElement('div');
  text.className = 'text';
  text.textContent = item.text;
  text.addEventListener('dblclick', () => startEdit(item.id));

  const del = document.createElement('button');
  del.className = 'del';
  del.type = 'button';
  del.textContent = '×';
  del.title = '删除';
  del.addEventListener('mousedown', (e) => e.stopPropagation());
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    removeItem(item.id);
  });

  li.append(box, text, del);

  li.addEventListener('dragstart', (e) => {
    if (state.editingId) {
      e.preventDefault();
      return;
    }
    state.dragId = item.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.id);
    setTimeout(() => li.classList.add('dragging'), 0);
  });

  li.addEventListener('dragend', () => {
    state.dragId = null;
    li.classList.remove('dragging');
    clearDropMarks();
    persist();
  });

  li.addEventListener('dragover', (e) => {
    if (!state.dragId || state.dragId === item.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    li.classList.add('over');
  });

  li.addEventListener('dragleave', () => li.classList.remove('over'));

  li.addEventListener('drop', (e) => {
    e.preventDefault();
    li.classList.remove('over');
    if (!state.dragId || state.dragId === item.id) return;
    moveItem(state.dragId, item.id);
  });

  return li;
}

function clearDropMarks() {
  Array.prototype.forEach.call(els.list.querySelectorAll('.over'), (n) => n.classList.remove('over'));
}

function moveItem(fromId, toId) {
  const from = state.items.findIndex((x) => x.id === fromId);
  const to = state.items.findIndex((x) => x.id === toId);
  if (from < 0 || to < 0 || from === to) return;
  const [moved] = state.items.splice(from, 1);
  state.items.splice(to, 0, moved);
  persist();
  renderMain();
}

function addItem() {
  if (state.view !== 'main') showMain();
  const item = { id: uid(), text: '', createdAt: Date.now() };
  state.items.push(item);
  renderMain();
  const li = findRow(item.id);
  if (li) startEdit(item.id);
  els.list.scrollTop = els.list.scrollHeight;
}

function startEdit(id) {
  if (state.editingId) return;
  const item = state.items.find((x) => x.id === id);
  const li = findRow(id);
  if (!item || !li) return;

  const text = li.querySelector('.text');
  state.editingId = id;
  li.classList.add('editing');
  text.contentEditable = 'true';
  text.spellcheck = false;
  text.focus();

  const range = document.createRange();
  range.selectNodeContents(text);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  let closed = false;

  function cleanup() {
    closed = true;
    state.editingId = null;
    text.contentEditable = 'false';
    li.classList.remove('editing');
    text.removeEventListener('keydown', onKey);
    text.removeEventListener('paste', onPaste);
  }

  function finish(commit) {
    if (closed) return;
    const raw = text.innerText || text.textContent || '';
    const value = raw.replace(/\s*\n\s*/g, ' ').replace(/\u00a0/g, ' ').trim();
    cleanup();

    if (commit) {
      if (!value) {
        const idx = state.items.findIndex((x) => x.id === id);
        if (idx >= 0) state.items.splice(idx, 1);
      } else {
        item.text = value;
      }
    }
    persist();
    renderMain();
  }

  function onKey(e) {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  }

  function onPaste(e) {
    e.preventDefault();
    const paste = (e.clipboardData || window.clipboardData).getData('text');
    document.execCommand('insertText', false, paste.replace(/\s*\n\s*/g, ' '));
  }

  text.addEventListener('keydown', onKey);
  text.addEventListener('paste', onPaste);
  text.addEventListener('blur', () => finish(true), { once: true });
}

/* ---------------------------------------------------------- complete flow */

function animateOut(li) {
  return new Promise((resolve) => {
    if (!li) return resolve();
    const height = li.getBoundingClientRect().height;
    li.style.height = height + 'px';
    li.style.overflow = 'hidden';
    li.classList.add('done');
    li.style.pointerEvents = 'none';
    requestAnimationFrame(() => {
      li.style.transition = 'height .2s ease, opacity .2s ease, padding .2s ease, margin .2s ease';
      li.style.height = '0px';
      li.style.paddingTop = '0px';
      li.style.paddingBottom = '0px';
      li.style.opacity = '0';
    });
    setTimeout(resolve, 215);
  });
}

function complete(id) {
  if (state.editingId) return;
  const idx = state.items.findIndex((x) => x.id === id);
  if (idx < 0) return;
  const item = state.items[idx];
  const li = findRow(id);

  if (li) li.classList.add('done');

  animateOut(li).then(() => {
    const at = state.items.findIndex((x) => x.id === id);
    if (at < 0) return;
    state.items.splice(at, 1);
    const entry = Object.assign({}, item, { completedAt: Date.now() });
    state.history.unshift(entry);
    persist();
    renderMain();
    showToast('已完成', {
      undo: () => {
        state.history = state.history.filter((h) => h.id !== entry.id);
        state.items.splice(Math.min(at, state.items.length), 0, item);
        persist();
        renderMain();
        if (state.view === 'history') renderHistory();
        showToast('已还原');
      },
    });
  });
}

function removeItem(id) {
  const idx = state.items.findIndex((x) => x.id === id);
  if (idx < 0) return;
  const item = state.items[idx];
  state.items.splice(idx, 1);
  persist();
  renderMain();
  showToast('已删除', {
    undo: () => {
      state.items.splice(Math.min(idx, state.items.length), 0, item);
      persist();
      renderMain();
    },
  });
}

/* ---------------------------------------------------------------- history */

function renderHistory() {
  keepScroll(els.hlist, () => {
    els.hlist.textContent = '';
    els.btnClear.disabled = !state.history.length;
    disarmClear();

    if (!state.history.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.innerHTML = '还没有完成记录<br>在主界面勾掉一件事就会来这里';
      els.hlist.appendChild(empty);
      return;
    }

    let lastKey = null;
    state.history.forEach((entry) => {
      const key = dayKey(entry.completedAt);
      if (key !== lastKey) {
        lastKey = key;
        const group = document.createElement('div');
        group.className = 'hgroup';
        group.textContent = dayLabel(entry.completedAt);
        els.hlist.appendChild(group);
      }
      els.hlist.appendChild(historyRow(entry));
    });
  });
}

function historyRow(entry) {
  const row = document.createElement('div');
  row.className = 'hitem';
  row.dataset.id = entry.id;

  const box = document.createElement('span');
  box.className = 'box on';

  const text = document.createElement('div');
  text.className = 'text';
  text.textContent = entry.text;
  text.title = entry.text;

  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = clockText(entry.completedAt);

  const acts = document.createElement('span');
  acts.className = 'acts';

  const restore = document.createElement('button');
  restore.className = 'hact';
  restore.type = 'button';
  restore.textContent = '↺';
  restore.title = '还原到待办';
  restore.addEventListener('click', () => restoreEntry(entry.id));

  const del = document.createElement('button');
  del.className = 'hact';
  del.type = 'button';
  del.textContent = '×';
  del.title = '删除记录';
  del.addEventListener('click', () => deleteEntry(entry.id));

  acts.append(restore, del);
  row.append(box, text, time, acts);
  return row;
}

function restoreEntry(id) {
  const idx = state.history.findIndex((x) => x.id === id);
  if (idx < 0) return;
  const entry = state.history[idx];
  state.history.splice(idx, 1);
  state.items.push({ id: entry.id, text: entry.text, createdAt: entry.createdAt || Date.now() });
  persist();
  renderMain();
  renderHistory();
  showToast('已还原到待办');
}

function deleteEntry(id) {
  const idx = state.history.findIndex((x) => x.id === id);
  if (idx < 0) return;
  const entry = state.history[idx];
  state.history.splice(idx, 1);
  persist();
  renderHistory();
  showToast('已删除记录', {
    undo: () => {
      state.history.splice(Math.min(idx, state.history.length), 0, entry);
      persist();
      renderHistory();
    },
  });
}

let clearArmed = false;
let clearTimer = null;

function disarmClear() {
  clearArmed = false;
  clearTimeout(clearTimer);
  els.btnClear.textContent = '清空历史';
  els.btnClear.classList.remove('danger');
}

els.btnClear.addEventListener('click', () => {
  if (!state.history.length) return;
  if (!clearArmed) {
    clearArmed = true;
    els.btnClear.textContent = '再点一次清空';
    els.btnClear.classList.add('danger');
    clearTimer = setTimeout(disarmClear, 3200);
    return;
  }
  const backup = state.history.slice();
  state.history = [];
  persist();
  renderHistory();
  showToast('历史已清空', {
    undo: () => {
      state.history = backup;
      persist();
      renderHistory();
    },
  });
});

/* ------------------------------------------------------------- view switch */

function showMain() {
  state.view = 'main';
  els.viewMain.hidden = false;
  els.viewHistory.hidden = true;
  els.btnAdd.hidden = false;
  els.btnBack.hidden = true;
  els.barTitle.hidden = true;
  els.btnHistory.classList.remove('active');
  closeMenu();
}

function showHistory() {
  state.view = 'history';
  renderHistory();
  els.viewMain.hidden = true;
  els.viewHistory.hidden = false;
  els.btnAdd.hidden = true;
  els.btnBack.hidden = false;
  els.barTitle.hidden = false;
  els.btnHistory.classList.add('active');
  closeMenu();
  els.hlist.scrollTop = 0;
}

function toggleHistory() {
  if (state.view === 'history') showMain();
  else showHistory();
}

/* --------------------------------------------------------------- settings */

function updatePin() {
  els.btnPin.classList.toggle('active', !!state.settings.alwaysOnTop);
  els.btnPin.title = state.settings.alwaysOnTop ? '取消置顶' : '置顶显示';
}

function updateMenu() {
  els.ckStartup.classList.toggle('on', !!state.settings.launchAtLogin);
}

function openMenu() {
  els.menu.hidden = false;
  updateMenu();
}

function closeMenu() {
  els.menu.hidden = true;
}

function toggleMenu() {
  if (els.menu.hidden) openMenu();
  else closeMenu();
}

/* ----------------------------------------------------------------- events */

els.btnAdd.addEventListener('click', addItem);
els.addrow.addEventListener('click', addItem);
els.addrow.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    addItem();
  }
});

els.btnPin.addEventListener('click', () => {
  state.settings.alwaysOnTop = !state.settings.alwaysOnTop;
  bridge.pin(state.settings.alwaysOnTop);
  updatePin();
});

els.btnHistory.addEventListener('click', toggleHistory);
els.btnBack.addEventListener('click', showMain);
els.btnClose.addEventListener('click', () => bridge.hide());

els.btnMore.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleMenu();
});

els.menu.addEventListener('click', (e) => e.stopPropagation());

els.miStartup.addEventListener('click', () => {
  state.settings.launchAtLogin = !state.settings.launchAtLogin;
  bridge.launchAtLogin(state.settings.launchAtLogin);
  updateMenu();
  showToast(state.settings.launchAtLogin ? '已设为开机启动' : '已取消开机启动');
});

els.miFolder.addEventListener('click', () => {
  bridge.openDataFolder();
  closeMenu();
});

els.miAbout.addEventListener('click', () => {
  closeMenu();
  showToast('简单待办 v' + state.version + ' · 数据在 %APPDATA%\\SimpleTodo');
});

els.miQuit.addEventListener('click', () => {
  closeMenu();
  bridge.quit();
});

document.addEventListener('click', closeMenu);

document.addEventListener('keydown', (e) => {
  if (state.editingId) return;
  if (e.ctrlKey && !e.shiftKey && !e.altKey) {
    const key = e.key.toLowerCase();
    if (key === 'n') {
      e.preventDefault();
      addItem();
      return;
    }
    if (key === 'h') {
      e.preventDefault();
      toggleHistory();
      return;
    }
  }
  if (e.key === 'Escape') {
    if (!els.menu.hidden) closeMenu();
    else if (state.view === 'history') showMain();
  }
});

bridge.onState((payload) => {
  if (payload && payload.settings) {
    state.settings = Object.assign({}, state.settings, payload.settings);
    updatePin();
    updateMenu();
  }
  if (payload && payload.reason === 'about') {
    showToast('简单待办 v' + state.version + ' · 数据在 %APPDATA%\\SimpleTodo', { ttl: 5000 });
  }
});

window.addEventListener('focus', () => {
  if (state.view === 'history') renderHistory();
});

/* ------------------------------------------------------------ resize edges */

const MIN_W = 240;
const MIN_H = 200;

document.querySelectorAll('.rz').forEach((handle) => {
  handle.addEventListener('pointerdown', async (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = await bridge.bounds();
    if (!start) return;

    const dir = handle.dataset.rz;
    const sx = e.screenX;
    const sy = e.screenY;
    const cursor = getComputedStyle(handle).cursor;
    document.body.style.cursor = cursor;
    try {
      handle.setPointerCapture(e.pointerId);
    } catch (_) {}

    const move = (ev) => {
      const dx = ev.screenX - sx;
      const dy = ev.screenY - sy;
      let x = start.x;
      let y = start.y;
      let width = start.width;
      let height = start.height;

      if (dir.indexOf('e') >= 0) width = Math.max(MIN_W, start.width + dx);
      if (dir.indexOf('s') >= 0) height = Math.max(MIN_H, start.height + dy);
      if (dir.indexOf('w') >= 0) {
        width = Math.max(MIN_W, start.width - dx);
        x = start.x + start.width - width;
      }
      if (dir.indexOf('n') >= 0) {
        height = Math.max(MIN_H, start.height - dy);
        y = start.y + start.height - height;
      }
      bridge.setBounds({ x, y, width, height });
    };

    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
      document.body.style.cursor = '';
    };

    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  });
});

/* ------------------------------------------------------------------- boot */

(async function boot() {
  const res = await bridge.init();
  state.items = (res.data && res.data.items) || [];
  state.history = (res.data && res.data.history) || [];
  state.settings = Object.assign({}, state.settings, res.settings || {});
  state.version = res.version || state.version;
  renderMain();
  updatePin();
  updateMenu();
  showMain();

  if (!state.settings.hintShown) {
    state.settings.hintShown = true;
    bridge.save({ settings: { hintShown: true } });
    setTimeout(() => {
      showToast('点 × 只收进托盘 · Ctrl+Alt+T 随时唤出', { ttl: 5600 });
    }, 900);
  }
})();
