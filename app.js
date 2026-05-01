/* ═══════════════════════════════════════════════════════
   NOTES OFFLINE — app.js
   Full IndexedDB-backed PWA Notes Application
   ═══════════════════════════════════════════════════════ */

'use strict';

/* ─── PWA MANIFEST (inline blob) ─────────────────────── */
(function injectManifest() {
  const manifest = {
    name: 'Notes Offline',
    short_name: 'Notes',
    description: 'An offline-first notes app. Create, search and sync notes anywhere.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0f0f11',
    theme_color: '#0f0f11',
    orientation: 'portrait-primary',
    icons: [
      {
        src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'%3E%3Crect width='512' height='512' rx='100' fill='%230f0f11'/%3E%3Crect x='120' y='140' width='272' height='32' rx='8' fill='%23f4c542'/%3E%3Crect x='120' y='200' width='200' height='20' rx='6' fill='%23ffffff' opacity='.6'/%3E%3Crect x='120' y='240' width='240' height='20' rx='6' fill='%23ffffff' opacity='.4'/%3E%3Crect x='120' y='280' width='180' height='20' rx='6' fill='%23ffffff' opacity='.3'/%3E%3Ccircle cx='376' cy='360' r='56' fill='%23f4c542'/%3E%3Ctext x='376' y='375' font-size='44' text-anchor='middle' fill='%230f0f11'%3E%2B%3C/text%3E%3C/svg%3E",
        sizes: '512x512',
        type: 'image/svg+xml',
        purpose: 'any maskable'
      },
      {
        src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'%3E%3Crect width='192' height='192' rx='40' fill='%230f0f11'/%3E%3Crect x='44' y='52' width='104' height='14' rx='4' fill='%23f4c542'/%3E%3Crect x='44' y='76' width='76' height='9' rx='3' fill='%23ffffff' opacity='.6'/%3E%3Crect x='44' y='94' width='90' height='9' rx='3' fill='%23ffffff' opacity='.4'/%3E%3Ccircle cx='142' cy='140' r='22' fill='%23f4c542'/%3E%3Ctext x='142' y='148' font-size='18' text-anchor='middle' fill='%230f0f11'%3E%2B%3C/text%3E%3C/svg%3E",
        sizes: '192x192',
        type: 'image/svg+xml',
        purpose: 'any maskable'
      }
    ],
    categories: ['productivity', 'utilities'],
    screenshots: []
  };
  const blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' });
  const url  = URL.createObjectURL(blob);
  document.getElementById('pwa-manifest').setAttribute('href', url);
})();

/* ─── INDEXEDDB LAYER ────────────────────────────────── */
const DB = (() => {
  const DB_NAME    = 'NotesDB';
  const DB_VERSION = 1;
  const STORE      = 'notes';
  let db = null;

  async function open() {
    if (db) return db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const store = e.target.result.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('title',       'title',       { unique: false });
        store.createIndex('content',     'content',     { unique: false });
        store.createIndex('pinned',      'pinned',      { unique: false });
        store.createIndex('created',     'created',     { unique: false });
        store.createIndex('lastEdited',  'lastEdited',  { unique: false });
      };
      req.onsuccess  = e => { db = e.target.result; resolve(db); };
      req.onerror    = e => reject(e.target.error);
    });
  }

  async function tx(mode, fn) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const t = d.transaction(STORE, mode);
      const s = t.objectStore(STORE);
      const req = fn(s);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = e => reject(e.target.error);
    });
  }

  return {
    getAll: () => tx('readonly', s => s.getAll()),
    get:    id  => tx('readonly', s => s.get(id)),
    put:    note => tx('readwrite', s => s.put(note)),
    delete: id  => tx('readwrite', s => s.delete(id)),
    clear:  ()  => tx('readwrite', s => s.clear()),
  };
})();

/* ─── CRYPTO HELPERS (password hashing) ─────────────── */
async function hashPassword(password) {
  const enc  = new TextEncoder().encode(password);
  const buf  = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ─── UTILS ──────────────────────────────────────────── */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function relativeTime(ts) {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60)  return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7)   return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function wordCount(text) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function highlightMatch(text, query) {
  if (!query) return escapeHtml(text);
  const safeQ = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escapeHtml(text).replace(new RegExp(`(${safeQ})`, 'gi'), '<mark>$1</mark>');
}

function debounce(fn, delay) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

async function estimateStorage() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const { usage, quota } = await navigator.storage.estimate();
      const mb = (usage / 1024 / 1024).toFixed(2);
      return `${mb} MB used`;
    }
  } catch {}
  return '';
}

/* ─── STATE ──────────────────────────────────────────── */
const state = {
  notes:        [],       // All notes from DB
  currentId:    null,     // ID of note being edited
  searchQuery:  '',       // Live search string
  isDark:       true,     // Theme
  unlockedIds:  new Set() // Session-unlocked note IDs
};

/* ─── DOM REFS ───────────────────────────────────────── */
const $ = id => document.getElementById(id);

const dom = {
  viewList:       $('view-list'),
  viewEditor:     $('view-editor'),
  syncBar:        $('sync-bar'),
  syncText:       $('sync-text'),
  toast:          $('toast'),
  searchInput:    $('search-input'),
  searchClear:    $('search-clear'),
  statsCount:     $('stats-count'),
  statsStorage:   $('stats-storage'),
  onlineDot:      $('online-dot'),
  onlineLabel:    $('online-label'),
  notesPinned:    $('notes-pinned'),
  notesAll:       $('notes-all'),
  sectionPinned:  $('section-pinned'),
  sectionAll:     $('section-all'),
  allLabel:       $('all-label'),
  emptyState:     $('empty-state'),
  noResults:      $('no-results'),
  btnNew:         $('btn-new'),
  btnBack:        $('btn-back'),
  btnPin:         $('btn-pin'),
  btnLock:        $('btn-lock'),
  btnDelete:      $('btn-delete'),
  btnTheme:       $('btn-theme'),
  btnExport:      $('btn-export'),
  noteTitle:      $('note-title'),
  noteContent:    $('note-content'),
  saveStatus:     $('save-status'),
  editorMeta:     $('editor-meta'),
  metaCreated:    $('meta-created'),
  metaEdited:     $('meta-edited'),
  wordCount:      $('word-count'),
  charCount:      $('char-count'),
  iconMoon:       $('icon-moon'),
  iconSun:        $('icon-sun'),
  iconLockOpen:   $('icon-lock-open'),
  iconLockClosed: $('icon-lock-closed'),
  themeMeta:      $('theme-meta'),

  // Dialogs
  pwOverlay:      $('pw-overlay'),
  pwTitle:        $('pw-title'),
  pwDesc:         $('pw-desc'),
  pwInput:        $('pw-input'),
  pwConfirm:      $('pw-confirm'),
  pwCancel:       $('pw-cancel'),
  pwSubmit:       $('pw-submit'),
  unlockOverlay:  $('unlock-overlay'),
  unlockInput:    $('unlock-input'),
  unlockCancel:   $('unlock-cancel'),
  unlockSubmit:   $('unlock-submit'),
  exportOverlay:  $('export-overlay'),
  exportJson:     $('export-json'),
  exportTxt:      $('export-txt'),
  exportCancel:   $('export-cancel'),
  confirmOverlay: $('confirm-overlay'),
  confirmCancel:  $('confirm-cancel'),
  confirmDelete:  $('confirm-delete'),
};

/* ─── TOAST ──────────────────────────────────────────── */
let toastTimer;
function showToast(msg, duration = 2500) {
  dom.toast.textContent = msg;
  dom.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.remove('show'), duration);
}

/* ─── NAVIGATION ─────────────────────────────────────── */
function navigateTo(view) {
  const views = document.querySelectorAll('.view');
  views.forEach(v => v.classList.remove('active'));
  view.classList.add('active');
}

/* ─── SYNC SIMULATION ────────────────────────────────── */
function simulateSync(label = 'Syncing notes…') {
  dom.syncText.textContent = label;
  dom.syncBar.classList.remove('hidden');
  return new Promise(resolve => {
    setTimeout(() => {
      dom.syncBar.classList.add('hidden');
      resolve();
    }, Math.random() * 1200 + 800);
  });
}

/* ─── ONLINE/OFFLINE ─────────────────────────────────── */
function updateOnlineStatus() {
  const online = navigator.onLine;
  dom.onlineDot.classList.toggle('online',  online);
  dom.onlineDot.classList.toggle('offline', !online);
  dom.onlineLabel.textContent = online ? 'Online' : 'Offline';

  if (online) {
    // Simulate cloud sync when coming online
    simulateSync('Syncing notes…').then(() => {
      // Occasionally simulate a conflict resolved
      if (Math.random() < 0.25) {
        showToast('⚡ Conflict resolved — latest version kept', 3000);
      } else {
        showToast('✓ Notes synced');
      }
    });
  }
}

window.addEventListener('online',  updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

/* ─── THEME ──────────────────────────────────────────── */
function applyTheme(isDark) {
  document.body.dataset.theme = isDark ? 'dark' : 'light';
  dom.themeMeta.content = isDark ? '#0f0f11' : '#faf9f6';
  dom.iconMoon.style.display = isDark ? 'block' : 'none';
  dom.iconSun.style.display  = isDark ? 'none'  : 'block';
}

dom.btnTheme.addEventListener('click', () => {
  state.isDark = !state.isDark;
  applyTheme(state.isDark);
  localStorage.setItem('notes_theme', state.isDark ? 'dark' : 'light');
  showToast(state.isDark ? '🌙 Dark mode' : '☀️ Light mode');
});

/* ─── STATS ──────────────────────────────────────────── */
async function updateStats() {
  const n = state.notes.length;
  dom.statsCount.textContent = `${n} note${n !== 1 ? 's' : ''}`;
  const storage = await estimateStorage();
  dom.statsStorage.textContent = storage;
}

/* ─── RENDER NOTES ───────────────────────────────────── */
function renderNotes() {
  const query = state.searchQuery.toLowerCase().trim();
  let notes = state.notes;

  // Filter by search
  if (query) {
    notes = notes.filter(n =>
      (n.title || '').toLowerCase().includes(query) ||
      (n.content || '').toLowerCase().includes(query)
    );
  }

  const pinned = notes.filter(n => n.pinned);
  const all    = notes.filter(n => !n.pinned);

  // Pinned section
  dom.sectionPinned.classList.toggle('hidden', pinned.length === 0);
  dom.notesPinned.innerHTML = '';
  pinned.forEach((n, i) => {
    dom.notesPinned.appendChild(createCard(n, i, query));
  });

  // All notes section
  dom.notesAll.innerHTML = '';
  all.forEach((n, i) => {
    dom.notesAll.appendChild(createCard(n, i, query));
  });

  // Label
  dom.allLabel.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
    ${query ? 'Results' : 'Notes'}
  `;

  // Empty states
  const totalNotes = state.notes.length;
  dom.emptyState.classList.toggle('hidden', totalNotes > 0 || !!query);
  dom.noResults.classList.toggle('hidden', !query || notes.length > 0);
  dom.sectionAll.classList.toggle('hidden', all.length === 0 && !query);

  updateStats();
}

function createCard(note, idx, query = '') {
  const card = document.createElement('div');
  card.className = `note-card${note.pinned ? ' pinned' : ''}${note.locked ? ' locked' : ''}`;
  card.style.animationDelay = `${idx * 30}ms`;
  card.dataset.id = note.id;

  const titleHtml   = highlightMatch(note.title || 'Untitled', query);
  const previewText = note.locked && !state.unlockedIds.has(note.id)
    ? '🔒 Password protected'
    : (note.content || '').slice(0, 150);
  const previewHtml = note.locked && !state.unlockedIds.has(note.id)
    ? '🔒 Password protected'
    : highlightMatch(previewText, query);

  card.innerHTML = `
    <div class="note-card-title">${titleHtml}</div>
    <div class="note-card-preview">${previewHtml}</div>
    <div class="note-card-footer">
      <span class="note-card-time">${relativeTime(note.lastEdited || note.created)}</span>
      <div class="card-actions">
        <button class="card-btn pin-btn${note.pinned ? ' active' : ''}" data-id="${note.id}" data-action="pin" title="${note.pinned ? 'Unpin' : 'Pin'}" aria-label="${note.pinned ? 'Unpin' : 'Pin'}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="${note.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>
        </button>
        <button class="card-btn del-btn" data-id="${note.id}" data-action="delete" title="Delete" aria-label="Delete note">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </div>
    </div>
  `;

  // Click card → open editor
  card.addEventListener('click', e => {
    if (e.target.closest('.card-actions')) return;
    openNote(note.id);
  });

  // Pin / delete buttons
  card.querySelectorAll('.card-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const action = btn.dataset.action;
      if (action === 'pin')    await togglePin(note.id);
      if (action === 'delete') confirmDeleteNote(note.id);
    });
  });

  // Swipe-to-delete (touch)
  let touchStartX = 0;
  card.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].clientX; }, { passive: true });
  card.addEventListener('touchend', e => {
    const dx = touchStartX - e.changedTouches[0].clientX;
    if (dx > 80) confirmDeleteNote(note.id);
  }, { passive: true });

  return card;
}

/* ─── CRUD OPERATIONS ────────────────────────────────── */
async function loadNotes() {
  try {
    state.notes = (await DB.getAll()).sort((a, b) => (b.lastEdited || b.created) - (a.lastEdited || a.created));
    renderNotes();
  } catch (e) {
    console.error('Failed to load notes', e);
    showToast('⚠️ Could not load notes');
  }
}

async function createNote() {
  const now  = Date.now();
  const note = {
    id:          uid(),
    title:       '',
    content:     '',
    created:     now,
    lastEdited:  now,
    pinned:      false,
    locked:      false,
    passwordHash: null,
  };
  await DB.put(note);
  state.notes.unshift(note);
  renderNotes();
  openNoteEditor(note.id);
}

async function saveCurrentNote() {
  if (!state.currentId) return;
  const note = state.notes.find(n => n.id === state.currentId);
  if (!note) return;

  const newTitle   = dom.noteTitle.value;
  const newContent = dom.noteContent.value;

  if (note.title === newTitle && note.content === newContent) return;

  note.title      = newTitle;
  note.content    = newContent;
  note.lastEdited = Date.now();

  await DB.put(note);
  renderNotes();
  updateEditorMeta(note);
}

const debouncedSave = debounce(async () => {
  dom.saveStatus.textContent = 'Saving…';
  dom.saveStatus.className   = 'save-status saving';
  await saveCurrentNote();
  dom.saveStatus.textContent = 'All saved';
  dom.saveStatus.className   = 'save-status saved';
  setTimeout(() => {
    dom.saveStatus.textContent = '';
    dom.saveStatus.className   = 'save-status';
  }, 2000);
}, 700);

async function togglePin(id) {
  const note = state.notes.find(n => n.id === id);
  if (!note) return;
  note.pinned = !note.pinned;
  note.lastEdited = Date.now();
  await DB.put(note);
  state.notes.sort((a, b) => (b.lastEdited || b.created) - (a.lastEdited || a.created));
  renderNotes();
  showToast(note.pinned ? '📌 Pinned' : 'Unpinned');

  // Update editor pin button if editing this note
  if (state.currentId === id) updateEditorPinState(note);
}

async function deleteNote(id) {
  state.notes = state.notes.filter(n => n.id !== id);
  await DB.delete(id);
  renderNotes();
  showToast('🗑 Note deleted');

  if (state.currentId === id) {
    state.currentId = null;
    navigateTo(dom.viewList);
  }
}

/* ─── EDITOR ─────────────────────────────────────────── */
async function openNote(id) {
  const note = state.notes.find(n => n.id === id);
  if (!note) return;

  if (note.locked && !state.unlockedIds.has(id)) {
    // Show unlock dialog
    showUnlockDialog(id);
    return;
  }

  openNoteEditor(id);
}

function openNoteEditor(id) {
  const note = state.notes.find(n => n.id === id);
  if (!note) return;

  state.currentId = id;

  dom.noteTitle.value   = note.title;
  dom.noteContent.value = note.content;
  dom.saveStatus.textContent = '';
  dom.saveStatus.className   = 'save-status';

  updateEditorMeta(note);
  updateEditorPinState(note);
  updateEditorLockState(note);
  updateWordCount();

  navigateTo(dom.viewEditor);
  setTimeout(() => {
    if (!note.title) dom.noteTitle.focus();
    else dom.noteContent.focus();
  }, 350);
}

function updateEditorMeta(note) {
  dom.metaCreated.textContent = `Created ${relativeTime(note.created)}`;
  dom.metaEdited.textContent  = note.lastEdited !== note.created
    ? `Edited ${relativeTime(note.lastEdited)}` : '';
}

function updateEditorPinState(note) {
  dom.btnPin.classList.toggle('active', !!note.pinned);
  dom.btnPin.title = note.pinned ? 'Unpin note' : 'Pin note';
}

function updateEditorLockState(note) {
  dom.btnLock.classList.toggle('active', !!note.locked);
  dom.iconLockOpen.style.display   = note.locked ? 'none'  : 'block';
  dom.iconLockClosed.style.display = note.locked ? 'block' : 'none';
}

function updateWordCount() {
  const text = dom.noteContent.value;
  dom.wordCount.textContent = `${wordCount(text)} words`;
  dom.charCount.textContent = `${text.length} chars`;
}

/* ─── EDITOR EVENTS ──────────────────────────────────── */
dom.noteTitle.addEventListener('input', () => {
  debouncedSave();
  dom.saveStatus.textContent = '…';
});

dom.noteContent.addEventListener('input', () => {
  debouncedSave();
  updateWordCount();
  dom.saveStatus.textContent = '…';
});

dom.btnBack.addEventListener('click', async () => {
  await saveCurrentNote();
  state.currentId = null;
  navigateTo(dom.viewList);
});

dom.btnPin.addEventListener('click', async () => {
  if (!state.currentId) return;
  await togglePin(state.currentId);
});

dom.btnDelete.addEventListener('click', () => {
  if (!state.currentId) return;
  confirmDeleteNote(state.currentId);
});

/* ─── CONFIRM DELETE DIALOG ──────────────────────────── */
let pendingDeleteId = null;

function confirmDeleteNote(id) {
  pendingDeleteId = id;
  dom.confirmOverlay.classList.remove('hidden');
}

dom.confirmCancel.addEventListener('click', () => {
  pendingDeleteId = null;
  dom.confirmOverlay.classList.add('hidden');
});

dom.confirmDelete.addEventListener('click', async () => {
  if (pendingDeleteId) {
    await deleteNote(pendingDeleteId);
    pendingDeleteId = null;
  }
  dom.confirmOverlay.classList.add('hidden');
});

/* ─── PASSWORD PROTECTION ────────────────────────────── */
dom.btnLock.addEventListener('click', async () => {
  if (!state.currentId) return;
  const note = state.notes.find(n => n.id === state.currentId);
  if (!note) return;

  if (note.locked) {
    // Remove lock
    note.locked = false;
    note.passwordHash = null;
    state.unlockedIds.delete(note.id);
    note.lastEdited = Date.now();
    await DB.put(note);
    updateEditorLockState(note);
    renderNotes();
    showToast('🔓 Note unlocked');
  } else {
    // Set lock
    dom.pwTitle.textContent = 'Protect Note';
    dom.pwDesc.textContent  = 'Set a password to protect this note.';
    dom.pwInput.value       = '';
    dom.pwConfirm.value     = '';
    dom.pwConfirm.classList.remove('hidden');
    dom.pwOverlay.classList.remove('hidden');
    setTimeout(() => dom.pwInput.focus(), 50);
  }
});

dom.pwCancel.addEventListener('click', () => {
  dom.pwOverlay.classList.add('hidden');
});

dom.pwSubmit.addEventListener('click', async () => {
  const pw1 = dom.pwInput.value.trim();
  const pw2 = dom.pwConfirm.value.trim();
  if (!pw1) { showToast('⚠️ Password is required'); return; }
  if (pw1 !== pw2) { showToast('⚠️ Passwords do not match'); return; }

  const note = state.notes.find(n => n.id === state.currentId);
  if (!note) return;

  note.locked = true;
  note.passwordHash = await hashPassword(pw1);
  note.lastEdited = Date.now();
  state.unlockedIds.add(note.id);
  await DB.put(note);
  dom.pwOverlay.classList.add('hidden');
  updateEditorLockState(note);
  renderNotes();
  showToast('🔒 Note protected');
});

dom.pwInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') dom.pwConfirm.focus();
});
dom.pwConfirm.addEventListener('keydown', e => {
  if (e.key === 'Enter') dom.pwSubmit.click();
});

/* ─── UNLOCK DIALOG ──────────────────────────────────── */
let pendingUnlockId = null;

function showUnlockDialog(id) {
  pendingUnlockId = id;
  dom.unlockInput.value = '';
  dom.unlockOverlay.classList.remove('hidden');
  setTimeout(() => dom.unlockInput.focus(), 50);
}

dom.unlockCancel.addEventListener('click', () => {
  pendingUnlockId = null;
  dom.unlockOverlay.classList.add('hidden');
});

dom.unlockSubmit.addEventListener('click', async () => {
  const note = state.notes.find(n => n.id === pendingUnlockId);
  if (!note) return;

  const entered = dom.unlockInput.value;
  const hash    = await hashPassword(entered);

  if (hash === note.passwordHash) {
    state.unlockedIds.add(note.id);
    dom.unlockOverlay.classList.add('hidden');
    openNoteEditor(note.id);
    showToast('🔓 Unlocked');
  } else {
    showToast('⚠️ Incorrect password');
    dom.unlockInput.value = '';
    dom.unlockInput.focus();
  }
});

dom.unlockInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') dom.unlockSubmit.click();
});

/* ─── EXPORT ─────────────────────────────────────────── */
dom.btnExport.addEventListener('click', () => {
  dom.exportOverlay.classList.remove('hidden');
});

dom.exportCancel.addEventListener('click', () => {
  dom.exportOverlay.classList.add('hidden');
});

dom.exportJson.addEventListener('click', () => {
  const data = state.notes.map(n => ({
    id:         n.id,
    title:      n.title,
    content:    n.locked ? '[LOCKED]' : n.content,
    pinned:     n.pinned,
    created:    new Date(n.created).toISOString(),
    lastEdited: new Date(n.lastEdited || n.created).toISOString(),
  }));
  downloadFile(JSON.stringify(data, null, 2), 'notes-export.json', 'application/json');
  dom.exportOverlay.classList.add('hidden');
  showToast('✓ Exported as JSON');
});

dom.exportTxt.addEventListener('click', () => {
  const lines = state.notes.map(n =>
    `${n.pinned ? '📌 ' : ''}${n.title || 'Untitled'}\n${'-'.repeat(40)}\n${n.locked ? '[LOCKED]' : (n.content || '')}\n\nCreated: ${new Date(n.created).toLocaleString()}\nEdited:  ${new Date(n.lastEdited || n.created).toLocaleString()}\n`
  ).join('\n\n══════════════════════════════════════════\n\n');
  downloadFile(lines, 'notes-export.txt', 'text/plain');
  dom.exportOverlay.classList.add('hidden');
  showToast('✓ Exported as text');
});

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

/* ─── SEARCH ─────────────────────────────────────────── */
dom.searchInput.addEventListener('input', () => {
  state.searchQuery = dom.searchInput.value;
  dom.searchClear.classList.toggle('hidden', !state.searchQuery);
  renderNotes();
});

dom.searchClear.addEventListener('click', () => {
  dom.searchInput.value = '';
  state.searchQuery     = '';
  dom.searchClear.classList.add('hidden');
  renderNotes();
  dom.searchInput.focus();
});

/* ─── NEW NOTE ───────────────────────────────────────── */
dom.btnNew.addEventListener('click', createNote);

/* ─── KEYBOARD SHORTCUTS ─────────────────────────────── */
document.addEventListener('keydown', e => {
  // Escape = back to list
  if (e.key === 'Escape') {
    if (!dom.pwOverlay.classList.contains('hidden'))      { dom.pwCancel.click(); return; }
    if (!dom.unlockOverlay.classList.contains('hidden'))  { dom.unlockCancel.click(); return; }
    if (!dom.exportOverlay.classList.contains('hidden'))  { dom.exportCancel.click(); return; }
    if (!dom.confirmOverlay.classList.contains('hidden')) { dom.confirmCancel.click(); return; }
    if (dom.viewEditor.classList.contains('active'))      { dom.btnBack.click(); return; }
  }
  // Cmd/Ctrl + N = new note
  if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
    e.preventDefault();
    createNote();
  }
  // Cmd/Ctrl + F = focus search
  if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
    e.preventDefault();
    if (dom.viewList.classList.contains('active')) dom.searchInput.focus();
  }
});

/* ─── SEED DATA (first launch) ───────────────────────── */
async function seedDefaultNotes() {
  const existing = await DB.getAll();
  if (existing.length > 0) return;

  const now = Date.now();
  const seed = [
    {
      id:          uid(),
      title:       'Welcome! 👋',
      content:     'Your notes sync automatically when you\'re online.\n\nAll your notes are saved offline, so they\'re always available — even with no internet connection.\n\nTry creating a note, searching, or pinning something important!',
      created:     now - 1000 * 60 * 60 * 3,
      lastEdited:  now - 1000 * 60 * 60 * 3,
      pinned:      true,
      locked:      false,
      passwordHash: null,
    },
    {
      id:          uid(),
      title:       'Pin important notes 📌',
      content:     'Tap the pin icon on any note to keep it at the top.\n\nPinned notes appear in their own section so you never lose track of what matters most.',
      created:     now - 1000 * 60 * 60 * 2,
      lastEdited:  now - 1000 * 60 * 60 * 2,
      pinned:      false,
      locked:      false,
      passwordHash: null,
    },
    {
      id:          uid(),
      title:       'Search your notes 🔍',
      content:     'Use the search bar above to instantly filter notes by title or content.\n\nMatching text is highlighted as you type. Tap × to clear your search.',
      created:     now - 1000 * 60 * 30,
      lastEdited:  now - 1000 * 60 * 30,
      pinned:      false,
      locked:      false,
      passwordHash: null,
    },
  ];

  for (const note of seed) await DB.put(note);
}

/* ─── PULL-TO-REFRESH (sync) ─────────────────────────── */
(function initPullToRefresh() {
  let startY = 0;
  let pulled = false;
  const el   = document.querySelector('.notes-main');

  el.addEventListener('touchstart', e => {
    startY  = e.touches[0].clientY;
    pulled  = el.scrollTop === 0;
  }, { passive: true });

  el.addEventListener('touchend', async e => {
    const dy = e.changedTouches[0].clientY - startY;
    if (pulled && dy > 60 && navigator.onLine) {
      await simulateSync('Refreshing…');
      showToast('✓ Up to date');
    }
  }, { passive: true });
})();

/* ─── INIT ───────────────────────────────────────────── */
async function init() {
  // Restore theme
  const savedTheme = localStorage.getItem('notes_theme');
  if (savedTheme) {
    state.isDark = savedTheme === 'dark';
  } else {
    state.isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  applyTheme(state.isDark);

  // Online status
  updateOnlineStatus();

  // Show list view immediately
  navigateTo(dom.viewList);

  // Seed + load notes
  await seedDefaultNotes();
  await loadNotes();

  // Storage display
  await updateStats();

  // Simulate initial sync on load if online
  if (navigator.onLine) {
    setTimeout(async () => {
      await simulateSync('Syncing notes…');
    }, 1500);
  }
}

// Boot
document.addEventListener('DOMContentLoaded', init);
