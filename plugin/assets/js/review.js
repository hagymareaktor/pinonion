/* PinOnion — frontend JS */
(function () {
  'use strict';

  const cfg = window.pinonionReview;
  if (!cfg) return;

  /* ── State ─────────────────────────────────────────────────────────────── */
  const SESSION_KEY = 'pinonion-rv-ui';

  function loadSavedState() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || '{}'); } catch { return {}; }
  }

  let _saveTimer = null;
  function saveState() {
    const payload = {
      activeTab:       state.activeTab,
      filterAuthors:   state.filterAuthors,
      filterImportant: state.filterImportant,
      filterUnread:    state.filterUnread,
      filterNew:       state.filterNew,
      pageFilter:      state.pageFilter,
      sortBy:          state.sortBy,
      panelOpen:       state.panelOpen,
      speedDialOpen:   state.speedDialOpen,
    };
    // Immediately into session (offline fallback)
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload));
    // For logged-in users, also into DB (debounced)
    if (cfg.user) {
      clearTimeout(_saveTimer);
      _saveTimer = setTimeout(() => {
        api('POST', 'prefs', payload).catch(() => {});
      }, 800);
    }
  }

  // Load preferences — from API for logged-in user, otherwise sessionStorage
  let _saved = loadSavedState();
  async function loadPrefsFromDB() {
    if (!cfg.user) return;
    try {
      const dbPrefs = await api('GET', 'prefs');
      if (dbPrefs && typeof dbPrefs === 'object') {
        // DB preferences overwrite the session
        Object.assign(_saved, dbPrefs);
        // Apply to the live state if already initialized
        const keys = ['activeTab','filterImportant','filterUnread','filterNew','pageFilter','sortBy'];
        keys.forEach(k => { if (k in dbPrefs) state[k] = dbPrefs[k]; });
        if (typeof renderList === 'function') renderList();
      }
    } catch {}
  }

  const _savedInit = loadSavedState();
  const state = {
    pins:            [],
    activePinId:     null,
    addMode:         false,
    panelOpen:       _savedInit.panelOpen || false,
    speedDialOpen:   _savedInit.speedDialOpen || false,
    activeTab:       _savedInit.activeTab       || 'open',
    filterAuthors:   _savedInit.filterAuthors   || [],
    filterImportant: _savedInit.filterImportant || false,
    filterUnread:    _savedInit.filterUnread    || false,
    filterNew:       _savedInit.filterNew       || false,
    pageFilter:      _savedInit.pageFilter      || 'all',
    sortBy:          _savedInit.sortBy          || 'created_desc',
    search:          '',
    listPage:        1,
    listPerPage:     30,
    pendingPin:      null,
    pinsVisible:     _savedInit.speedDialOpen || false,
  };

  /* ── Helpers ────────────────────────────────────────────────────────────── */
  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Detects URLs and converts them to clickable links (XSS-safe: escapes non-URL parts)
  function linkify(str) {
    const urlRe = /(https?:\/\/[^\s<>"]+)/g;
    return String(str ?? '').split(urlRe).map((part, i) => {
      if (i % 2 === 1) {
        const safe = esc(part);
        return `<a href="${safe}" target="_blank" rel="noopener noreferrer" class="pp-rv-link">${safe}</a>`;
      }
      return esc(part);
    }).join('');
  }

  function fmt(d) {
    if (!d) return '';
    let s = String(d).replace(' ', 'T');
    if (!s.endsWith('Z') && !s.includes('+') && s.includes('T')) s += 'Z';
    const dt = new Date(s);
    if (isNaN(dt.getTime())) return String(d);
    
    const diff = Math.floor((Date.now() - dt) / 1000);
    if (diff < 60)       return 'Just now';
    if (diff < 3600)     return Math.floor(diff / 60) + ' minutes ago';
    if (diff < 86400)    return Math.floor(diff / 3600) + ' hours ago';
    return dt.toLocaleString('hu-HU', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function author() {
    return { name: cfg.user.name, wp_id: cfg.user.id };
  }

  function docH() {
    return Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, 1);
  }
  function docW() {
    return Math.max(document.body.scrollWidth, document.documentElement.scrollWidth, 1);
  }

  // Modern confirm modal
  function ppConfirm(message, onConfirm) {
    if (window.confirm(message)) {
      onConfirm();
    }
  }

  // EC-2: stable CSS selector generation (max 6 levels, stops at id)
  function getCssSelector(el) {
    if (!el || el === document.body || el === document.documentElement) return '';
    if (el.closest?.('#pp-rv-toolbar, #pp-rv-panel, #pp-rv-popup, #pp-rv-overlay, .pp-rv-pin')) return '';
    const path = [];
    let node = el;
    let depth = 0;
    while (node && node !== document.documentElement && depth < 6) {
      if (node.id && /^[a-zA-Z]/.test(node.id) && !node.id.startsWith('pp-rv')) {
        path.unshift('#' + CSS.escape(node.id));
        break;
      }
      const tag = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const sibs = [...parent.children].filter(c => c.tagName === node.tagName);
        path.unshift(sibs.length > 1 ? `${tag}:nth-of-type(${sibs.indexOf(node) + 1})` : tag);
      } else {
        path.unshift(tag);
      }
      node = node.parentElement;
      depth++;
    }
    return path.join(' > ');
  }

  // EC-4: save scrollTop of scrolled ancestors
  function getScrollContext(el) {
    const ctx = [];
    let node = el?.parentElement;
    while (node && node !== document.body) {
      if (node.scrollTop > 0) {
        const oy = getComputedStyle(node).overflowY;
        if (oy === 'scroll' || oy === 'auto') {
          const sel = getCssSelector(node);
          if (sel) ctx.push({ sel, top: node.scrollTop });
        }
      }
      node = node.parentElement;
    }
    return ctx;
  }

  // EC-4: restore scroll context when pin is opened
  function restoreScrollContext(pin) {
    if (!pin.scroll_context) return;
    try {
      const ctx = JSON.parse(pin.scroll_context);
      if (!Array.isArray(ctx)) return;
      ctx.forEach(({ sel, top }) => {
        const el = sel ? document.querySelector(sel) : null;
        if (el) el.scrollTop = top;
      });
    } catch { /* invalid JSON — skip */ }
  }

  /* ── REST API ───────────────────────────────────────────────────────────── */
  async function api(method, path, data) {
    const res = await fetch(cfg.apiUrl + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce },
      body: data ? JSON.stringify(data) : undefined,
    });
    if (!res.ok) throw new Error((await res.json())?.message || res.statusText);
    return res.json();
  }

  /* ── URL helpers ────────────────────────────────────────────────────────── */
  function urlPathname(u) {
    try {
      let p = new URL(u, location.origin).pathname;
      return p.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
    } catch {
      return String(u).replace(/\/$/, '') || '/';
    }
  }
  function isCurrentPage(pinUrl) {
    return urlPathname(pinUrl) === urlPathname(cfg.pageUrl);
  }
  function navUrlForPin(pin) {
    try {
      const u = new URL(pin.page_url);
      u.search = '';
      u.searchParams.set('review', '1');
      u.searchParams.set('open_pin', pin.id);
      return u.toString();
    } catch {
      return pin.page_url + '?review=1&open_pin=' + pin.id;
    }
  }

  /* ── Load pins ──────────────────────────────────────────────────────────── */
  async function loadPins() {
    // Always load globally — page filtering happens in the panel
    state.pins = await api('GET', 'pins');
    renderMarkers();
    if (cfg.user || cfg.canManage) {
      renderList();
      updateBadge();
      populateAuthorDropdown();
    }
  }

  function populateAuthorDropdown() {
    const menu = document.getElementById('pp-rv-dd-author-menu');
    if (!menu) return;
    const authors = [...new Set(state.pins.map(p => p.author_name))].sort();
    menu.innerHTML = authors.map(a =>
      `<label class="pp-rv-dd-opt"><input type="checkbox" value="${esc(a)}"${state.filterAuthors.includes(a) ? ' checked' : ''}>${esc(a)}</label>`
    ).join('') || '<div class="pp-rv-dd-empty">No author</div>';
    // Re-bind the change event (menu innerHTML was rewritten)
    menu.addEventListener('change', () => {
      const checked = [...menu.querySelectorAll('input:checked')].map(i => i.value);
      state.filterAuthors = checked;
      updateDdBtn(document.getElementById('pp-rv-dd-author-btn'), 'Beküldő', checked);
      renderActiveFilters();
      renderList();
    });
  }

  /* ── Pin markers on page ────────────────────────────────────────────────── */
  function renderMarkers() {
    document.querySelectorAll('.pp-rv-pin').forEach(el => el.remove());
    if (!state.pinsVisible) return;

    state.pins.filter(p => isCurrentPage(p.page_url)).forEach((pin, idx) => {
      const m = document.createElement('div');
      m.className = 'pp-rv-pin pp-rv-pin--' + pin.status;
      m.dataset.pinId = pin.id;
      if (String(pin.id) === String(state.activePinId)) m.classList.add('active');

      const unread = parseInt(pin.unread_count) || 0;
      const numStr = String(pin.id);
      let numCls = '';
      if (numStr.length === 3) numCls = ' pp-rv-pin-num--sm';
      else if (numStr.length >= 4) numCls = ' pp-rv-pin-num--xs';

      m.innerHTML =
        `<span class="pp-rv-pin-num${numCls}">${pin.id}</span>` +
        (unread ? `<span class="pp-rv-unread">${unread}</span>` : '');

      if (parseInt(pin.is_fixed)) {
        m.style.position = 'fixed';
        m.style.left = pin.x_pct + '%';
        m.style.top  = pin.y_pct + '%';
      } else {
        m.style.left = (pin.x_pct / 100 * docW()) + 'px';
        m.style.top  = (pin.y_pct / 100 * docH()) + 'px';
      }

      if (cfg.user || cfg.canManage) {
        m.addEventListener('click', e => { e.stopPropagation(); openPinDetail(pin.id, e.clientX, e.clientY); });
      } else {
        m.classList.add('pp-rv-pin--guest');
        m.title = 'Login required to view';
      }
      document.body.appendChild(m);
    });
  }

  /* ── Badge ──────────────────────────────────────────────────────────────── */
  function updateBadge() {
    const badge = document.getElementById('pp-rv-badge');
    if (!badge) return;
    const total = state.pins.reduce((s, p) => s + (parseInt(p.unread_count) || 0), 0);
    badge.textContent = total;
    badge.style.display = total > 0 ? 'flex' : 'none';
  }

  /* ── Panel list ─────────────────────────────────────────────────────────── */
  function filteredPins(ignoreTab = false) {
    let pins = state.pins.filter(p => {
      if (!ignoreTab && p.status !== state.activeTab) return false;
      if (state.filterAuthors.length && !state.filterAuthors.includes(p.author_name)) return false;
      if (state.filterImportant && !parseInt(p.important)) return false;
      if (state.filterUnread && !(parseInt(p.unread_count) > 0)) return false;
      if (state.filterNew && getOpenedPins().has(String(p.id))) return false;
      if (state.pageFilter === 'current' && !isCurrentPage(p.page_url)) return false;
      if (state.pageFilter !== 'all' && state.pageFilter !== 'current') {
        if (urlPathname(p.page_url) !== urlPathname(state.pageFilter)) return false;
      }
      if (state.search) {
        const q = state.search.toLowerCase();
        if (!String(p.author_name ).toLowerCase().includes(q) &&
            !String(p.page_title  ).toLowerCase().includes(q) &&
            !String(p.description || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });

    pins.sort((a, b) => {
      if (state.sortBy === 'important') {
        const diff = parseInt(b.important) - parseInt(a.important);
        if (diff !== 0) return diff;
        return new Date(b.created_at) - new Date(a.created_at);
      }
      if (state.sortBy === 'created_asc')  return new Date(a.created_at) - new Date(b.created_at);
      if (state.sortBy === 'comment_desc') return new Date(b.updated_at) - new Date(a.updated_at);
      if (state.sortBy === 'comment_asc')  return new Date(a.updated_at) - new Date(b.updated_at);
      return new Date(b.created_at) - new Date(a.created_at); // created_desc default
    });

    return pins;
  }

  /* ── Megnyitott pinek nyomon követése (localStorage) ───────────────────── */
  function getOpenedPins() {
    try { return new Set(JSON.parse(localStorage.getItem('pinonion-rv-opened') || '[]')); } catch { return new Set(); }
  }
  function markPinOpened(id) {
    const s = getOpenedPins();
    s.add(String(id));
    localStorage.setItem('pinonion-rv-opened', JSON.stringify([...s]));
  }

  // Saját pin-ek nyilvántartása (submitter jogosultsághoz)
  function getMyPins() {
    try { return new Set(JSON.parse(localStorage.getItem('pinonion-rv-my-pins') || '[]')); } catch { return new Set(); }
  }
  function trackMyPin(id) {
    const s = getMyPins();
    s.add(String(id));
    localStorage.setItem('pinonion-rv-my-pins', JSON.stringify([...s]));
  }
  function isMyPin(id) {
    // WP bejelentkezett felhasználó esetén a szerver ellenőriz;
    // vendég esetén a localStorage alapján döntünk
    if (cfg.user) return true; // szerver úgyis ellenőriz, engedjük próbálni
    return getMyPins().has(String(id));
  }

  /* ── Tab számláló frissítés ─────────────────────────────────────────────── */
  function renderTabs() {
    const counts = { open: 0, in_progress: 0, done: 0 };
    state.pins.forEach(p => { if (counts[p.status] !== undefined) counts[p.status]++; });
    ['open', 'in_progress', 'done'].forEach(tab => {
      const countEl = document.getElementById('pp-rv-tab-count-' + tab);
      if (countEl) countEl.textContent = counts[tab] || '';
      const btn = document.querySelector('.pp-rv-tab[data-tab="' + tab + '"]');
      if (btn) btn.classList.toggle('active', tab === state.activeTab);
    });
  }

  let listObserver = null;

  function renderList(resetPage = false) {
    if (resetPage) state.listPage = 1;

    const list = document.getElementById('pp-rv-pin-list');
    if (!list) return;

    renderTabs();
    const pins = filteredPins();
    if (!pins.length) {
      list.innerHTML = '<div class="pp-rv-empty">No results</div>';
      return;
    }

    const statusColor = { open: '#a855f7', in_progress: '#3b82f6', done: '#22c55e' };
    const openedPins  = getOpenedPins();

    const limit = state.listPage * state.listPerPage;
    const pinsToRender = pins.slice(0, limit);

    let html = pinsToRender.map((pin) => {
      const unread      = parseInt(pin.unread_count) || 0;
      const comments    = parseInt(pin.comment_count) || 0;
      const active      = String(pin.id) === String(state.activePinId) ? ' active' : '';
      const globalN     = state.pins.indexOf(pin) + 1;
      const isImportant = parseInt(pin.important) === 1;
      const isCurrent   = isCurrentPage(pin.page_url);

      // New pin = never opened by anyone; unread = was opened, but new comment arrived
      const neverOpened = !openedPins.has(String(pin.id));
      const hasUnread   = !neverOpened && unread > 0;

      // CSS classes
      let itemCls = 'pp-rv-pin-item';
      if (active)      itemCls += ' active';
      if (isImportant) itemCls += ' pp-rv-pin-item--important';
      if (neverOpened) itemCls += ' pp-rv-pin-item--new';
      if (hasUnread)   itemCls += ' pp-rv-pin-item--unread';
      if (!isCurrent)  itemCls += ' pp-rv-pin-item--other-page';

      // Num badge color: if Done, always green, otherwise status color (no red overwrite)
      const numBg = (pin.status === 'done') ? '#22c55e' : (statusColor[pin.status] || '#4f46e5');

      // Unread badge text
      const unreadLabel = neverOpened
        ? ''
        : (unread > 0 ? `<span class="pp-rv-unread-msg">+${unread} new message(s)</span>` : '');

      const pinVw = parseInt(pin.viewport_width) || 0;
      const curVw = window.innerWidth;
      const viewportMismatch = pinVw > 0 && Math.abs(curVw - pinVw) / pinVw > 0.3;
      const viewportBadge = pinVw > 0 && viewportMismatch
        ? `<span class="pp-rv-viewport-badge pp-rv-viewport-badge--warn" title="Mást viewport: ${pinVw}px">⚠</span>`
        : '';

      const descRaw  = pin.description || '';
      const descText = descRaw.length > 72 ? descRaw.slice(0, 72) + '…' : (descRaw || '—');

      const isUnread = neverOpened || hasUnread;
      const numStyle = isUnread
        ? `background:${numBg}; color:#fff; border:2px solid transparent; box-sizing:border-box;`
        : `background:transparent; color:${numBg}; border:2px solid ${numBg}; box-sizing:border-box;`;

      return `<div class="${itemCls}" data-pid="${pin.id}">
        <div class="pp-rv-pin-item-head">
          <span class="pp-rv-pin-item-num" style="${numStyle}">${globalN}</span>
          <div class="pp-rv-pin-item-info">
            <span class="pp-rv-pin-item-author">${esc(descText)}</span>
            <span class="pp-rv-pin-item-meta-row">
              <span class="pp-rv-pin-item-byline">${esc(pin.author_name)}</span>
              <span>${fmt(pin.created_at)}</span>
              ${unreadLabel}
            </span>
            ${viewportBadge}
            ${isCurrent ? `<span class="pp-rv-current-page-badge">${esc(pin.page_title || urlPathname(pin.page_url))} (page)</span>` 
                        : `<span class="pp-rv-other-page-text">${esc(pin.page_title || urlPathname(pin.page_url))} (page)</span>`}
          </div>
          <div class="pp-rv-pin-item-actions">
            ${cfg.canManage ? `<button class="pp-rv-star-btn${isImportant ? ' active' : ''}" data-pid="${pin.id}" title="${isImportant ? 'Remove urgency' : 'Mark as urgent'}"><svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="10" fill="${isImportant ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"/><line x1="12" y1="7" x2="12" y2="13" stroke="${isImportant ? '#ffffff' : 'currentColor'}" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="17" x2="12.01" y2="17" stroke="${isImportant ? '#ffffff' : 'currentColor'}" stroke-width="2.5" stroke-linecap="round"/></svg></button>` : ''}
            ${cfg.canManage && state.activeTab !== 'done' ? `<button class="pp-rv-done-btn" data-pid="${pin.id}" title="Kész">✓</button>` : ''}
          </div>
        </div>
      </div>`;
    }).join('');

    if (limit < pins.length) {
      html += `<div id="pp-rv-list-sentry" style="height:20px; flex-shrink:0;"></div>`;
    }

    list.innerHTML = html;

    if (listObserver) {
      listObserver.disconnect();
      listObserver = null;
    }

    if (limit < pins.length) {
      setTimeout(() => {
        const sentry = document.getElementById('pp-rv-list-sentry');
        if (sentry) {
          listObserver = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
              state.listPage++;
              renderList(false);
            }
          }, { root: document.querySelector('.pp-rv-pin-list'), rootMargin: '200px' });
          listObserver.observe(sentry);
        }
      }, 0);
    }

    list.querySelectorAll('.pp-rv-pin-item').forEach(item => {
      item.addEventListener('click', e => {
        if (e.target.closest('.pp-rv-done-btn')) {
          e.stopPropagation();
          const btn = e.target.closest('.pp-rv-done-btn');
          
          ppConfirm('Are you sure you want to close this issue?', async () => {
            btn.disabled = true;
            const pid = parseInt(btn.dataset.pid);
            const a   = author();
            await api('PATCH', `pins/${pid}`, { status: 'done', author_name: a.name, author_wp_id: a.wp_id });
            loadPins();
          });
          return;
        }
        if (e.target.closest('.pp-rv-star-btn')) {
          e.stopPropagation();
          const btn = e.target.closest('.pp-rv-star-btn');
          const pid = parseInt(btn.dataset.pid);
          const pin = state.pins.find(p => String(p.id) === String(pid));
          if (!pin) return;
          const newVal = parseInt(pin.important) ? 0 : 1;
          const a = author();
          api('PATCH', `pins/${pid}`, { important: newVal, author_name: a.name, author_wp_id: a.wp_id })
            .then(() => {
              pin.important = newVal;
              renderMarkers();
              renderList();
              if (String(state.activePinId) === String(pid)) {
                const urgentCheckbox = document.querySelector('#pp-rv-urgent-checkbox');
                if (urgentCheckbox) urgentCheckbox.checked = !!newVal;
              }
            });
          return;
        }
        scrollToPinAndOpen(parseInt(item.dataset.pid));
      });
    });

    const uniquePages = {};
    state.pins.forEach(p => {
      const pUrl = urlPathname(p.page_url);
      if (!uniquePages[pUrl]) uniquePages[pUrl] = p.page_title || pUrl;
    });
    const pageMenu = document.getElementById('pp-rv-page-filter-menu');
    if (pageMenu) {
      const isAll = state.pageFilter === 'all';
      const isCur = state.pageFilter === 'current';
      let html = `
        <div class="pp-rv-sort-menu-title">Page filter</div>
        <button class="pp-rv-dd-pageopt${isAll ? ' selected' : ''}" data-page="all">All pages (Global)</button>
        <button class="pp-rv-dd-pageopt${isCur ? ' selected' : ''}" data-page="current">Only current page</button>
        <div style="border-top: 1px solid #2d2d44; margin: 4px 0;"></div>
      `;
      Object.keys(uniquePages).forEach(url => {
        const isSel = state.pageFilter === url;
        html += `<button class="pp-rv-dd-pageopt${isSel ? ' selected' : ''}" data-page="${url}">${esc(uniquePages[url])}</button>`;
      });
      pageMenu.innerHTML = html;
    }

    saveState();
  }

  function setNavInfo(cur, total) {
    const el = document.getElementById('pp-rv-nav-info');
    if (el) el.textContent = total ? `${cur} / ${total}` : '–';
  }

  /* ── Scroll to pin ──────────────────────────────────────────────────────── */
  function scrollToPin(pinId) {
    const pin = state.pins.find(p => String(p.id) === String(pinId));
    if (!pin) return;
    const targetY = (pin.y_pct / 100) * docH() - window.innerHeight / 2;
    window.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' });

    const marker = document.querySelector(`.pp-rv-pin[data-pin-id="${pinId}"]`);
    if (marker) {
      marker.classList.add('highlight');
      setTimeout(() => marker.classList.remove('highlight'), 2000);
    }
    const item = document.querySelector(`.pp-rv-pin-item[data-pid="${pinId}"]`);
    if (state.panelOpen && item) {
      item.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  /* ── Nav confirm modal (más oldali pin) ────────────────────────────────── */
  function showNavConfirm(pin) {
    document.getElementById('pp-rv-nav-confirm')?.remove();
    const modal = document.createElement('div');
    modal.id        = 'pp-rv-nav-confirm';
    modal.className = 'pp-rv-nav-confirm-backdrop';
    modal.innerHTML = `
      <div class="pp-rv-nav-confirm-card">
        <div class="pp-rv-nav-confirm-icon">📄</div>
        <div class="pp-rv-nav-confirm-title">Located on another page</div>
        <div class="pp-rv-nav-confirm-page">${esc(pin.page_title || urlPathname(pin.page_url))}</div>
        <div class="pp-rv-nav-confirm-btns">
          <button class="pp-rv-nav-confirm-yes">Navigate</button>
          <button class="pp-rv-nav-confirm-no">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('.pp-rv-nav-confirm-yes').addEventListener('click', () => {
      location.href = navUrlForPin(pin);
    });
    modal.querySelector('.pp-rv-nav-confirm-no').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  }

  // Sidebar-ból: scroll → vár a smooth scrollra → popup a pin marker helyén nyílik
  function scrollToPinAndOpen(pinId) {
    const pin = state.pins.find(p => String(p.id) === String(pinId));
    if (pin && !isCurrentPage(pin.page_url)) {
      location.href = navUrlForPin(pin);
      return;
    }
    
    // If this pin is already open, just focus on it, do not close and reload it (so the nav doesn't flash/disappear)
    if (String(state.activePinId) === String(pinId) && document.getElementById('pp-rv-popup')) {
      scrollToPin(pinId);
      return;
    }

    closePopup();
    state.activePinId = pinId;
    renderMarkers();
    renderList();

    const pinAfterRender = state.pins.find(p => String(p.id) === String(pinId));
    const isFixed = pinAfterRender && parseInt(pinAfterRender.is_fixed);

    function openAtMarker() {
      const marker = document.querySelector(`.pp-rv-pin[data-pin-id="${pinId}"]`);
      if (marker) {
        const rect = marker.getBoundingClientRect();
        // Simulate hover: restore CSS/JS hover state
        const hoverX = rect.left + rect.width / 2;
        const hoverY = rect.top  + rect.height / 2;
        const hovered = document.elementFromPoint(hoverX, hoverY);
        if (hovered) {
          let node = hovered;
          while (node && node !== document.body) {
            node.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, cancelable: true, clientX: hoverX, clientY: hoverY }));
            node.dispatchEvent(new MouseEvent('mouseover',  { bubbles: true,  cancelable: true, clientX: hoverX, clientY: hoverY }));
            node = node.parentElement;
          }
        }
        openPinDetail(pinId, rect.left + rect.width / 2, rect.top + rect.height);
      } else {
        openPinDetail(pinId, null, null);
      }
    }

    if (isFixed) {
      setTimeout(openAtMarker, 50);
    } else {
      // EC-4: restore inner scroll context before positioning
      restoreScrollContext(pinAfterRender);

      // EC-2: if CSS selector is present, scroll the element into view directly
      const sel = pinAfterRender?.css_selector;
      if (sel) {
        const target = document.querySelector(sel);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(openAtMarker, 420);
          return;
        }
      }
      scrollToPin(pinId);
      setTimeout(openAtMarker, 420);
    }
  }

  /* ── Panel toggle ───────────────────────────────────────────────────────── */
  function openPanel()  {
    state.panelOpen = true;
    document.getElementById('pp-rv-panel')?.classList.add('open');
    document.getElementById('pp-rv-panel-btn')?.classList.add('active');
    renderList();
    saveState();
  }
  function closePanel() {
    state.panelOpen = false;
    document.getElementById('pp-rv-panel')?.classList.remove('open');
    document.getElementById('pp-rv-panel-btn')?.classList.remove('active');
    saveState();
  }
  function togglePanel() { state.panelOpen ? closePanel() : openPanel(); }

  /* ── Add-mode toggle ────────────────────────────────────────────────────── */
  function canAddPin() {
    return true;
  }

  function isFixedAncestor(el) {
    let node = el;
    while (node && node !== document.body) {
      const pos = getComputedStyle(node).position;
      if (pos === 'fixed' || pos === 'sticky') return true;
      node = node.parentElement;
    }
    return false;
  }

  function onAddModeClick(e) {
    if (e.target.closest('#pp-rv-toolbar, #pp-rv-panel, #pp-rv-popup, #pp-rv-nav-confirm, #pp-rv-add-cancel-bar')) return;
    e.preventDefault();
    e.stopPropagation();

    const fixed = isFixedAncestor(e.target);
    // For fixed/sticky elements store viewport % (independent of scroll)
    const x_pct = fixed
      ? (e.clientX / window.innerWidth  * 100).toFixed(4)
      : ((e.clientX + window.scrollX)   / docW() * 100).toFixed(4);
    const y_pct = fixed
      ? (e.clientY / window.innerHeight * 100).toFixed(4)
      : ((e.clientY + window.scrollY)   / docH() * 100).toFixed(4);

    // EC-2/3/4: Save CSS selector, viewport width, inner scroll context
    const css_selector   = fixed ? '' : getCssSelector(e.target);
    const scroll_context = fixed ? '[]' : JSON.stringify(getScrollContext(e.target));

    state.pendingPin = {
      x_pct, y_pct, is_fixed: fixed ? 1 : 0,
      viewport_width: window.innerWidth,
      css_selector,
      scroll_context,
    };
    toggleAddMode();
    showNewPinPopup(e.clientX, e.clientY);
  }

  function toggleAddMode() {
    if (!canAddPin()) {
      alert('Pin placement is not allowed.');
      return;
    }
    state.addMode = !state.addMode;
    document.getElementById('pp-rv-overlay').classList.toggle('active', state.addMode);
    document.getElementById('pp-rv-fab')?.classList.toggle('add-active', state.addMode);
    document.getElementById('pp-rv-toolbar')?.classList.toggle('pp-rv-toolbar--hidden', state.addMode);
    document.getElementById('pp-rv-add-cancel-bar')?.classList.toggle('active', state.addMode);
    document.body.classList.toggle('pp-rv-add-mode', state.addMode);
    if (state.addMode) {
      state.pinsVisible = true;
      renderMarkers();
      document.addEventListener('click', onAddModeClick, true);
      document.addEventListener('keydown', onSpaceFreeze, true);
    } else {
      document.removeEventListener('click', onAddModeClick, true);
      document.removeEventListener('keydown', onSpaceFreeze, true);
      unfreezeHover();
    }
  }

  function onSpaceFreeze(e) {
    if (e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    freezeHoverAt(state.mouseX ?? 0, state.mouseY ?? 0);
    document.getElementById('pp-rv-overlay')?.classList.add('frozen');
    document.getElementById('pp-rv-add-cancel-bar')?.classList.add('frozen');
  }

  /* ── Popup positioning ──────────────────────────────────────────────────── */
  // isFixed=true  -> position:fixed  (navbar/fixed elements, or opened from panel)
  // isFixed=false -> position:absolute (normal page element, moves with scroll)
  function positionPopup(popup, cx, cy, isFixed) {
    if (cx !== null && cy !== null) {
      const pw = popup.offsetWidth || 320;
      const ph = popup.offsetHeight || 300;
      let left = cx + 14;
      let top  = cy + 14;
      const wpBar = document.getElementById('wpadminbar');
      const offsetTop = wpBar ? wpBar.offsetHeight : 0;
      const minTop = 8 + offsetTop;
      
      if (left + pw > window.innerWidth  - 12) left = cx - pw - 14;
      if (top  + ph > window.innerHeight - 12) top  = cy - ph - 14;
      
      left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
      top  = Math.max(minTop, Math.min(top, window.innerHeight - ph - 8));

      if (isFixed) {
        popup.style.position = 'fixed';
      } else {
        popup.style.position = 'absolute';
        left += window.scrollX;
        top  += window.scrollY;
      }
      popup.style.left      = left + 'px';
      popup.style.top       = top  + 'px';
      popup.style.right     = 'auto';
      popup.style.transform = 'none';
    } else {
      // Opened from panel: always fixed, aligned to right
      popup.style.position  = 'fixed';
      if (cfg.fabPosition === 'left') {
        popup.style.left      = '375px';
        popup.style.right     = 'auto';
      } else {
        popup.style.right     = '375px';
        popup.style.left      = 'auto';
      }
      popup.style.top       = '50%';
      popup.style.transform = 'translateY(-50%)';
    }
  }

  /* ── Hover freeze: keeps the open navigation menu visible while popup is open ── */
  let _frozenNodes = [];

  function freezeHoverAt(cx, cy) {
    unfreezeHover();
    // Use pre-saved elements on mousemove — when pressing Space
    // the browser already removed the :hover state by the time this runs
    const all = (state.hoveredEls && state.hoveredEls.length)
      ? state.hoveredEls
      : document.elementsFromPoint(cx, cy);
    const el = all.find(e => !e.closest(
      '.pp-rv-pin, #pp-rv-toolbar, #pp-rv-popup, #pp-rv-panel, .pp-rv-overlay, #pp-rv-add-cancel-bar'
    ));
    if (!el) return;

    // Mark all affected elements (hovered + all ancestors)
    const seen = new Set();
    all.forEach(n => {
      let node = n;
      while (node && node !== document.body && !seen.has(node)) {
        if (!node.closest('.pp-rv-pin, #pp-rv-toolbar, #pp-rv-popup, #pp-rv-panel, .pp-rv-overlay, #pp-rv-add-cancel-bar')) {
          node.setAttribute('data-pp-frozen', '1');
          _frozenNodes.push(node);
          seen.add(node);
        }
        node = node.parentElement;
      }
    });

    // CSS injection: force-show direct child dropdown/submenu elements
    // Do not touch transform so we do not break positioning
    let style = document.getElementById('pp-rv-freeze-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'pp-rv-freeze-style';
      document.head.appendChild(style);
    }
    style.textContent = `
      [data-pp-frozen] > ul,
      [data-pp-frozen] > .sub-menu,
      [data-pp-frozen] > [class*="sub-menu"],
      [data-pp-frozen] > [class*="submenu"],
      [data-pp-frozen] > [class*="dropdown"],
      [data-pp-frozen] > [class*="nav-drop"] {
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        pointer-events: none !important;
        max-height: none !important;
        clip: auto !important;
        clip-path: none !important;
      }
    `;
  }

  function unfreezeHover() {
    _frozenNodes.forEach(n => n.removeAttribute('data-pp-frozen'));
    _frozenNodes = [];
    const style = document.getElementById('pp-rv-freeze-style');
    if (style) style.textContent = '';
    document.getElementById('pp-rv-overlay')?.classList.remove('frozen');
    document.getElementById('pp-rv-add-cancel-bar')?.classList.remove('frozen');
  }

  function closePopup() {
    unfreezeHover();
    document.getElementById('pp-rv-popup')?.remove();
  }

  /* ── New pin popup ──────────────────────────────────────────────────────── */
  function showNewPinPopup(cx, cy) {
    closePopup();
    const a = author();

    const popup = document.createElement('div');
    popup.id        = 'pp-rv-popup';
    popup.className = 'pp-rv-popup pp-rv-popup--new';
    popup.innerHTML = `
      <div class="pp-rv-popup-head">
        <div style="display:flex;align-items:center;gap:8px;">
          <b>${cfg.strings.newPin}</b>
          <span style="opacity:0.5;font-size:11px;">•</span>
          <span class="pp-rv-author-name" style="font-size:12px;opacity:0.8">${esc(a.name)}</span>
        </div>
        <button class="pp-rv-close" id="pp-rv-popup-x">✕</button>
      </div>
      <textarea id="pp-rv-desc-in" class="pp-rv-input pp-rv-textarea" placeholder="${cfg.strings.descPlaceholder}" rows="3"></textarea>
      <div class="pp-rv-popup-actions" style="display:flex;justify-content:space-between;align-items:center;">
        <div style="display:flex;align-items:center;gap:8px;">
          <label class="pp-rv-switch" style="margin:0;">
            <input type="checkbox" id="pp-rv-urgent-chk">
            <span class="pp-rv-switch-track"></span>
          </label>
          <span style="font-size:12px;color:#cbd5e1;user-select:none;">Urgent task</span>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="pp-rv-btn-cancel" id="pp-rv-popup-cancel">Cancel</button>
          <button class="pp-rv-btn-submit" id="pp-rv-popup-submit">Drop pin</button>
        </div>
      </div>`;

    positionPopup(popup, cx, cy, !!(state.pendingPin?.is_fixed));
    document.body.appendChild(popup);

    const focus = popup.querySelector('#pp-rv-name-in') || popup.querySelector('#pp-rv-comment-in');
    focus?.focus();

    const urgentChk = popup.querySelector('#pp-rv-urgent-chk');

    popup.querySelector('#pp-rv-popup-x').addEventListener('click', () => { state.pendingPin = null; closePopup(); });
    popup.querySelector('#pp-rv-popup-cancel').addEventListener('click', () => { state.pendingPin = null; closePopup(); });
    popup.querySelector('#pp-rv-popup-submit').addEventListener('click', submitNewPin);

    popup.querySelector('#pp-rv-desc-in')?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitNewPin();
    });
  }

  async function submitNewPin() {
    const popup = document.getElementById('pp-rv-popup');
    if (!popup || !state.pendingPin) return;

    let a = author();

    const descIn = popup.querySelector('#pp-rv-desc-in');
    const description = descIn?.value.trim() || '';

    if (!description) {
      descIn?.focus();
      descIn?.classList.add('shake');
      setTimeout(() => descIn?.classList.remove('shake'), 400);
      return;
    }

    const important   = popup.querySelector('#pp-rv-urgent-chk')?.checked ? 1 : 0;
    const btn = popup.querySelector('#pp-rv-popup-submit');
    if (btn.disabled) return;
    btn.disabled    = true;
    btn.textContent = '…';

    try {
      const res = await api('POST', 'pins', {
        page_url:        cfg.pageUrl,
        page_title:      cfg.pageTitle,
        x_pct:           state.pendingPin.x_pct,
        y_pct:           state.pendingPin.y_pct,
        is_fixed:        state.pendingPin.is_fixed || 0,
        important,
        author_name:     a.name,
        author_wp_id:    a.wp_id,
        description,
        viewport_width:  state.pendingPin.viewport_width || window.innerWidth,
        css_selector:    state.pendingPin.css_selector   || '',
        scroll_context:  state.pendingPin.scroll_context || '[]',
      });
      state.pendingPin  = null;
      state.activePinId = null;
      closePopup();
      await loadPins();

      // Bejelentkezett: nyilvántartás + azonnal újra add-módba, hogy a következő pint le lehessen dobni
      trackMyPin(res.id);
      if (!state.addMode) toggleAddMode();
    } catch (err) {
      btn.disabled    = false;
      btn.textContent = 'Pin elhelyezése';
      alert('Error: ' + err.message);
    }
  }

  /* ── Megosztási modal ───────────────────────────────────────────────────── */
  function genPin() {
    const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let r = '';
    for (let i = 0; i < 6; i++) r += c[Math.floor(Math.random() * c.length)];
    return r;
  }

  function copyText(text) {
    return navigator.clipboard.writeText(text).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity  = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    });
  }

  function showShareModal(pin = null) {
    document.getElementById('pp-rv-share-modal')?.remove();

    if (!pin) return;

    const reviewUrl  = navUrlForPin(pin);
    const modalTitle = `🔗 Pin #${pin.id}`;
    const modal = document.createElement('div');
    modal.id        = 'pp-rv-share-modal';
    modal.className = 'pp-rv-share-backdrop';
    modal.innerHTML = `
      <div class="pp-rv-share-card">
        <div class="pp-rv-share-head">
          <span class="pp-rv-share-title">${esc(modalTitle)}</span>
          <button class="pp-rv-close" id="pp-rv-share-close">✕</button>
        </div>
        <div class="pp-rv-share-section">
          <label class="pp-rv-share-label">This link opens the page directly to pin <strong>#${pin.id}</strong></label>
          <div class="pp-rv-share-url-row">
            <input type="text" class="pp-rv-share-url-input" id="pp-rv-share-url" readonly value="${esc(reviewUrl)}">
            <button class="pp-rv-share-copy-btn" id="pp-rv-share-copy-url" title="Copy link">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              Copy
            </button>
          </div>
        </div>
      </div>`;

    document.body.appendChild(modal);

    const closeModal = () => modal.remove();
    document.getElementById('pp-rv-share-close').addEventListener('click', closeModal);
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

    document.getElementById('pp-rv-share-copy-url').addEventListener('click', () => {
      copyText(reviewUrl).then(() => {
        const btn = document.getElementById('pp-rv-share-copy-url');
        if (btn) { btn.textContent = '✓ Copied'; setTimeout(() => { if (btn) btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy`; }, 2000); }
      });
    });
  }

  /* ── Megosztott link toast ──────────────────────────────────────────────── */
  function showShareToast(url) {
    const toast = document.createElement('div');
    toast.className = 'pp-rv-toast' + (cfg.fabPosition === 'left' ? ' pp-rv-toast--left' : '');
    toast.innerHTML = `
      <div class="pp-rv-toast-icon" style="background:rgba(79,70,229,.15);color:#818cf8">🔗</div>
      <div class="pp-rv-toast-body">
        <strong>Link copied!</strong>
        <span>${url}</span>
      </div>
      <button class="pp-rv-toast-close">✕</button>`;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('visible'));
    const remove = () => { toast.classList.remove('visible'); setTimeout(() => toast.remove(), 300); };
    toast.querySelector('.pp-rv-toast-close').addEventListener('click', remove);
    setTimeout(remove, 4000);
  }

  /* ── Vendég köszönőüzenet ───────────────────────────────────────────────── */
  function showGuestThankYou() {
    const toast = document.createElement('div');
    toast.className = 'pp-rv-toast' + (cfg.fabPosition === 'left' ? ' pp-rv-toast--left' : '');
    toast.innerHTML = `
      <div class="pp-rv-toast-icon">✓</div>
      <div class="pp-rv-toast-body">
        <strong>Thank you!</strong>
        <span>Your feedback has been sent to the developer.</span>
      </div>
      <button class="pp-rv-toast-close">✕</button>`;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('visible'));

    const remove = () => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    };
    toast.querySelector('.pp-rv-toast-close').addEventListener('click', remove);
    setTimeout(remove, 5000);
  }

  /* ── Pin detail popup ───────────────────────────────────────────────────── */
  async function openPinDetail(pinId, cx, cy) {
    closePopup();
    state.activePinId = pinId;
    renderMarkers();
    renderList();

    const pin = state.pins.find(p => String(p.id) === String(pinId));
    if (!pin) return;

    // Hover freeze: keep the navigation element under the pin open
    const isFixedPin = parseInt(pin.is_fixed);
    const hvX = isFixedPin
      ? (pin.x_pct / 100) * window.innerWidth
      : (pin.x_pct / 100) * docW() - window.scrollX;
    const hvY = isFixedPin
      ? (pin.y_pct / 100) * window.innerHeight
      : (pin.y_pct / 100) * docH() - window.scrollY;
    freezeHoverAt(hvX, hvY);

    // Mark opened pin + mark as read
    markPinOpened(pinId);
    api('POST', `pins/${pinId}/read`).catch(() => {});
    pin.unread_count = 0;
    updateBadge();

    const comments = await api('GET', `pins/${pinId}/comments`);

    // Update cx, cy coordinates, because if the user / smooth scroll scrolled during await, it might slip
    const marker = document.querySelector(`.pp-rv-pin[data-pin-id="${pinId}"]`);
    if (marker) {
      const rect = marker.getBoundingClientRect();
      cx = rect.left + rect.width / 2;
      cy = rect.top + rect.height;
    }

    const a        = author();
    const canDel   = !!cfg.canManage;

    // ── Status permissions ─────────────────────────────────────────────────
    const myPin           = isMyPin(pinId);
    const canChangeStatus = cfg.canManage || (cfg.clientCanClose && myPin);
    const allowedStatuses = cfg.canManage ? ['open', 'in_progress', 'done'] : ['open', 'done'];
    const statusLabels    = { open: cfg.strings.statusOpen, in_progress: cfg.strings.statusInProgress, done: cfg.strings.statusDone };

    // Custom status pill (not <select>, but dropdown)
    const statusMenuItems = allowedStatuses
      .filter(s => s !== pin.status)
      .map(s => `<button class="pp-rv-status-opt" data-status="${s}">
        <span class="pp-rv-sdot pp-rv-sdot--${s}"></span>${statusLabels[s]}
      </button>`).join('');
    const statusPillHtml = canChangeStatus && statusMenuItems
      ? `<div class="pp-rv-status-dd" id="pp-rv-status-dd">
           <button class="pp-rv-status-pill pp-rv-status-pill--${pin.status}" id="pp-rv-status-pill">
             <span class="pp-rv-sdot pp-rv-sdot--${pin.status}"></span>
             <span id="pp-rv-status-label">${statusLabels[pin.status] ?? pin.status}</span>
             <span class="pp-rv-status-arrow">▾</span>
           </button>
           <div class="pp-rv-status-menu" id="pp-rv-status-menu">${statusMenuItems}</div>
         </div>`
      : `<span class="pp-rv-status-pill pp-rv-status-pill--${pin.status} pp-rv-status-pill--static">
           <span class="pp-rv-sdot pp-rv-sdot--${pin.status}"></span>
           ${statusLabels[pin.status] ?? pin.status}
         </span>`;

    const commentsHtml = buildCommentsHtml(comments);

    const popup = document.createElement('div');
    popup.id        = 'pp-rv-popup';
    popup.className = 'pp-rv-popup pp-rv-popup--detail';
    popup.innerHTML = `
      <div class="pp-rv-popup-head">
        <div class="pp-rv-popup-nav">
          <span class="pp-rv-popup-id" style="color:#94a3b8; font-weight:bold; margin-right:8px;">
            ${parseInt(pin.important) ? '<span style="color:#f59e0b; font-weight:bold; margin-right:4px;">!</span>' : ''}#${pin.id}
          </span>
          <button class="pp-rv-popup-nav-btn" id="pp-rv-popup-prev" title="Previous pin">‹</button>
          <span class="pp-rv-popup-nav-info" id="pp-rv-popup-nav-info">–</span>
          <button class="pp-rv-popup-nav-btn" id="pp-rv-popup-next" title="Next pin">›</button>
        </div>
        <div class="pp-rv-popup-head-right">
          ${statusPillHtml}
          ${canDel || canChangeStatus ? `<div class="pp-rv-kebab-wrap" id="pp-rv-kebab-wrap">
            <button class="pp-rv-kebab-btn" id="pp-rv-kebab-btn" title="Actions">⋮</button>
            <div class="pp-rv-kebab-menu" id="pp-rv-kebab-menu">
              ${cfg.canManage ? `<button class="pp-rv-kebab-item" id="pp-rv-edit-desc-trigger"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;flex-shrink:0"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit description</button>` : ''}
              ${cfg.canManage ? `<button class="pp-rv-kebab-item" id="pp-rv-set-unread-trigger"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;flex-shrink:0"><path d="M4 22h14a2 2 0 0 0 2-2V7.5L14.5 2H6a2 2 0 0 0-2 2v4"/><polyline points="14 2 14 8 20 8"/><path d="M2 15h10"/><path d="m9 18 3-3-3-3"/></svg>Set unread</button>` : ''}
              ${canChangeStatus ? `
                <label class="pp-rv-kebab-item pp-rv-kebab-item--switch">
                  <span>Urgent</span>
                  <div class="pp-rv-switch">
                    <input type="checkbox" id="pp-rv-urgent-checkbox" ${parseInt(pin.important) ? 'checked' : ''}>
                    <span class="pp-rv-switch-track"></span>
                  </div>
                </label>
              ` : ''}
              ${canDel ? `<button class="pp-rv-kebab-item pp-rv-kebab-item--danger" id="pp-rv-del-trigger">Delete review</button>` : ''}
            </div>
          </div>` : ''}
          <button class="pp-rv-close" id="pp-rv-popup-x">✕</button>
        </div>
      </div>
      <div class="pp-rv-confirm-bar" id="pp-rv-confirm-bar" style="display:none">
        <span>Are you sure you want to delete this review?</span>
        <div class="pp-rv-confirm-btns">
          <button class="pp-rv-confirm-yes" id="pp-rv-confirm-yes">Yes</button>
          <button class="pp-rv-confirm-no"  id="pp-rv-confirm-no">Cancel</button>
        </div>
      </div>
      <div class="pp-rv-pin-desc-block">
        <div class="pp-rv-pin-desc-text">${linkify(pin.description || '')}</div>
        <div class="pp-rv-pin-desc-meta" id="pp-rv-desc-meta">
          <span>${esc(pin.author_name)}</span>
          <span class="pp-rv-pin-desc-sep">·</span>
          <span>${esc(pin.page_title || urlPathname(pin.page_url))}</span>
          <span class="pp-rv-pin-desc-sep">·</span>
          <span>${fmt(pin.created_at)}</span>
          ${pin.description_updated_at ? `<span class="pp-rv-pin-desc-sep">·</span><span class="pp-rv-desc-edited"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:3px;vertical-align:middle"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edited · ${fmt(pin.description_updated_at)}</span>` : ''}
        </div>
      </div>
      <div class="pp-rv-comments-list" id="pp-rv-clist">${commentsHtml}</div>
      ${pin.status === 'done' && (cfg.canManage || isMyPin(pinId)) ? `
        <div class="pp-rv-reopen-bar">
          <button class="pp-rv-reopen-btn" id="pp-rv-reopen-btn">Reopen issue</button>
        </div>` : ''}
      ${pin.status !== 'done' ? `<div class="pp-rv-reply">
        <textarea id="pp-rv-reply-txt" class="pp-rv-input pp-rv-textarea" placeholder="Reply... (Ctrl+Enter)" rows="2"></textarea>
        <div class="pp-rv-popup-actions" style="padding:0">
          <button class="pp-rv-btn-submit pp-rv-btn-reply" id="pp-rv-reply-btn">Send</button>
        </div>
      </div>` : ''}`;

    document.body.appendChild(popup);
    positionPopup(popup, cx, cy, !!isFixedPin);

    // Handle expand buttons with delegation (clist innerHTML might rewrite)
    popup.addEventListener('click', e => {
      const btn = e.target.closest('.pp-rv-expand-btn');
      if (!btn) return;
      const bubble = btn.previousElementSibling;
      if (bubble) {
        bubble.classList.toggle('pp-rv-expanded');
        btn.textContent = bubble.classList.contains('pp-rv-expanded') ? 'Less ▴' : 'More ▾';
      }
    });

    // Newest on top -> no need to scroll
    const clist = popup.querySelector('#pp-rv-clist');
    clist.scrollTop = clist.scrollHeight;

    popup.querySelector('#pp-rv-popup-x').addEventListener('click', closePopup);

    // Popup navigation
    const isDone = pin.status === 'done';
    const navPins = filteredPins(true).filter(p => isDone ? p.status === 'done' : p.status !== 'done');
    const idx  = navPins.findIndex(p => String(p.id) === String(pinId));
    const navInfo = popup.querySelector('#pp-rv-popup-nav-info');
    if (idx === -1) {
      if (navInfo) navInfo.textContent = '1 / 1';
      popup.querySelector('#pp-rv-popup-prev')?.setAttribute('disabled', '');
      popup.querySelector('#pp-rv-popup-next')?.setAttribute('disabled', '');
    } else {
      if (navInfo) navInfo.textContent = `${idx + 1} / ${navPins.length}`;
      if (navPins.length <= 1) {
        popup.querySelector('#pp-rv-popup-prev')?.setAttribute('disabled', '');
        popup.querySelector('#pp-rv-popup-next')?.setAttribute('disabled', '');
      }
    }
    popup.querySelector('#pp-rv-popup-prev')?.addEventListener('click', e => { e.stopPropagation(); navigatePin(-1); });
    popup.querySelector('#pp-rv-popup-next')?.addEventListener('click', e => { e.stopPropagation(); navigatePin(1); });

    // ── Status dropdown ────────────────────────────────────────────────────
    const statusMenu = popup.querySelector('#pp-rv-status-menu');
    const statusPill = popup.querySelector('#pp-rv-status-pill');
    if (statusPill && statusMenu) {
      statusPill.addEventListener('click', e => {
        e.stopPropagation();
        statusMenu.classList.toggle('open');
        const kebabMenu = popup.querySelector('#pp-rv-kebab-menu');
        kebabMenu?.classList.remove('open');
        
        if (statusMenu.classList.contains('open')) {
          const closeStatus = (ev) => {
            if (!ev.target.closest('#pp-rv-status-dd')) {
              statusMenu.classList.remove('open');
              document.removeEventListener('click', closeStatus);
            }
          };
          document.addEventListener('click', closeStatus);
        }
      });
      
      statusMenu.addEventListener('click', async e => {
        const btn = e.target.closest('.pp-rv-status-opt');
        if (!btn) return;
        {
          const s  = btn.dataset.status;
          const ra = author();
          statusMenu.classList.remove('open');
          statusPill.disabled = true;
          await api('PATCH', `pins/${pinId}`, { status: s, author_name: ra.name, author_wp_id: ra.wp_id });
          pin.status = s;
          openPinDetail(pinId);
          renderMarkers();
          renderList();
        }
      });
      document.addEventListener('click', function closeStatusMenu(ev) {
        if (!popup.contains(ev.target)) return;
        if (!ev.target.closest('#pp-rv-status-dd')) {
          statusMenu.classList.remove('open');
          document.removeEventListener('click', closeStatusMenu);
        }
      });
    }

    // ── Kebab (⋮) menu ─────────────────────────────────────────────────────
    const kebabBtn  = popup.querySelector('#pp-rv-kebab-btn');
    const kebabMenu = popup.querySelector('#pp-rv-kebab-menu');
    if (kebabBtn && kebabMenu) {
      kebabBtn.addEventListener('click', e => {
        e.stopPropagation();
        kebabMenu.classList.toggle('open');
        statusMenu?.classList.remove('open');
        
        if (kebabMenu.classList.contains('open')) {
          const closeKebab = (ev) => {
            if (!ev.target.closest('#pp-rv-kebab-wrap')) {
              kebabMenu.classList.remove('open');
              document.removeEventListener('click', closeKebab);
            }
          };
          document.addEventListener('click', closeKebab);
        }
      });
    }

    // ── Delete pin: Yes / Cancel confirm bar ───────────────────────────
    const confirmBar = popup.querySelector('#pp-rv-confirm-bar');
    if (canDel && confirmBar) {
      popup.querySelector('#pp-rv-del-trigger').addEventListener('click', () => {
        kebabMenu.classList.remove('open');
        confirmBar.style.display = 'flex';
      });
      popup.querySelector('#pp-rv-confirm-no').addEventListener('click', () => {
        confirmBar.style.display = 'none';
      });
      popup.querySelector('#pp-rv-confirm-yes').addEventListener('click', async () => {
        await api('DELETE', `pins/${pinId}`);
        closePopup();
        state.activePinId = null;
        await loadPins();
      });
    }

    // ── Urgent toggle: from Kebab menu (switch) ──────────────────────────────
    const urgentCheckbox = popup.querySelector('#pp-rv-urgent-checkbox');
    if (urgentCheckbox) {
      urgentCheckbox.addEventListener('change', async (e) => {
        const newVal = e.target.checked ? 1 : 0;
        const ra = author();
        urgentCheckbox.disabled = true;
        await api('PATCH', `pins/${pinId}`, { important: newVal, author_name: ra.name, author_wp_id: ra.wp_id });
        pin.important = newVal;
        const updated = await api('GET', `pins/${pinId}/comments`);
        clist.innerHTML = buildCommentsHtml(updated);
        renderMarkers();
        renderList();
        urgentCheckbox.disabled = false;
      });
    }
    // ── Set unread ───────────────────────────────────────────────────────────
    const unreadTrigger = popup.querySelector('#pp-rv-set-unread-trigger');
    if (unreadTrigger) {
      unreadTrigger.addEventListener('click', async () => {
        kebabMenu.classList.remove('open');
        unreadTrigger.disabled = true;
        try {
          await api('POST', `pins/${pinId}/unread`);
          pin.unread_count = pin.comment_count || 1; // Mark as unread locally
          renderMarkers();
          renderList();
          updateBadge();
        } catch (err) {
          alert('Error: ' + err.message);
        }
        unreadTrigger.disabled = false;
      });
    }

    // ── Edit description ─────────────────────────────
    const editDescTrigger = popup.querySelector('#pp-rv-edit-desc-trigger');
    if (editDescTrigger) {
      editDescTrigger.addEventListener('click', () => {
        kebabMenu.classList.remove('open');
        const descBlock = popup.querySelector('.pp-rv-pin-desc-block');
        const descText  = popup.querySelector('.pp-rv-pin-desc-text');
        if (!descBlock || !descText) return;

        // If already editing, do not open another
        if (descBlock.querySelector('.pp-rv-desc-edit-area')) return;

        const original = pin.description || '';
        descText.style.display = 'none';

        const editArea = document.createElement('textarea');
        editArea.className   = 'pp-rv-input pp-rv-textarea pp-rv-desc-edit-area';
        editArea.rows        = 4;
        editArea.value       = original;
        editArea.style.cssText = 'width:100%;margin-bottom:8px;resize:vertical;font-size:13px;';
        descBlock.insertBefore(editArea, descText.nextSibling);
        editArea.focus();
        editArea.setSelectionRange(editArea.value.length, editArea.value.length);

        const actRow = document.createElement('div');
        actRow.style.cssText = 'display:flex;gap:6px;margin-bottom:8px;';
        actRow.innerHTML = `
          <button class="pp-rv-btn-cancel" id="pp-rv-desc-cancel" style="flex:1">Cancel</button>
          <button class="pp-rv-btn-submit" id="pp-rv-desc-save" style="flex:2">Save</button>`;
        descBlock.insertBefore(actRow, editArea.nextSibling);

        function cancelEdit() {
          editArea.remove();
          actRow.remove();
          descText.style.display = '';
        }

        actRow.querySelector('#pp-rv-desc-cancel').addEventListener('click', cancelEdit);

        actRow.querySelector('#pp-rv-desc-save').addEventListener('click', async () => {
          const newDesc = editArea.value.trim();
          const saveBtn = actRow.querySelector('#pp-rv-desc-save');
          if (saveBtn.disabled) return;
          saveBtn.disabled    = true;
          saveBtn.textContent = '…';
          try {
            const ra = author();
            await api('PATCH', `pins/${pinId}`, {
              description:   newDesc,
              author_name:   ra.name,
              author_wp_id:  ra.wp_id,
            });
            const now = new Date().toISOString();
            pin.description            = newDesc;
            pin.description_updated_at = now;
            descText.innerHTML         = linkify(newDesc);
            // Update meta row
            const descMeta = popup.querySelector('#pp-rv-desc-meta');
            if (descMeta) {
              const editedSpan = descMeta.querySelector('.pp-rv-desc-edited');
              if (editedSpan) {
                editedSpan.previousElementSibling.style.display = '';
                editedSpan.innerHTML = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:3px;vertical-align:middle"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edited · ${fmt(now)}`;
              } else {
                descMeta.insertAdjacentHTML('beforeend',
                  `<span class="pp-rv-pin-desc-sep">·</span><span class="pp-rv-desc-edited"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:3px;vertical-align:middle"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edited · ${fmt(now)}</span>`
                );
              }
            }
            cancelEdit();
            renderList();
          } catch (err) {
            saveBtn.disabled    = false;
            saveBtn.textContent = 'Save';
            alert('Error: ' + err.message);
          }
        });
      });
    }

    // EC-5: "Returned error" button — reopens done pin + auto comment

    popup.querySelector('#pp-rv-reopen-btn')?.addEventListener('click', async () => {
      const btn = popup.querySelector('#pp-rv-reopen-btn');
      btn.disabled = true;
      btn.textContent = '…';
      const ra = author();
      try {
        await api('PATCH', `pins/${pinId}`, { status: 'open', author_name: ra.name, author_wp_id: ra.wp_id });
        await api('POST', `pins/${pinId}/comments`, {
          author_name: ra.name, author_wp_id: ra.wp_id,
          content: 'This issue reappeared.',
        });
        closePopup();
        state.activePinId = null;
        await loadPins();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Reopen issue';
        alert('Error: ' + err.message);
      }
    });

    popup.querySelector('#pp-rv-reply-txt')?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendReply();
    });

    popup.querySelector('#pp-rv-reply-btn')?.addEventListener('click', sendReply);

    async function sendReply() {
      let ra = author();

      const txtEl  = popup.querySelector('#pp-rv-reply-txt');
      const content = txtEl.value.trim();
      if (!content) { txtEl.focus(); return; }

      const btn = popup.querySelector('#pp-rv-reply-btn');
      if (btn.disabled) return;
      btn.disabled    = true;
      btn.textContent = '…';

      try {
        await api('POST', `pins/${pinId}/comments`, {
          author_name:  ra.name,
          author_wp_id: ra.wp_id,
          content,
        });
        txtEl.value = '';
        const updated = await api('GET', `pins/${pinId}/comments`);
        clist.innerHTML  = buildCommentsHtml(updated);
        clist.scrollTop  = clist.scrollHeight;
        pin.comment_count = updated.length;
        renderList();
      } catch (err) {
        alert('Error: ' + err.message);
      }

      btn.disabled    = false;
      btn.textContent = 'Send';
    }
  }

  function avatarInitial(name) {
    return esc(String(name || '?')[0].toUpperCase());
  }

  function buildCommentsHtml(comments) {
    if (!comments.length) return '<div class="pp-rv-empty">No messages yet</div>';

    let lastAuthor = null;
    return comments.map(c => {
      if (c.type === 'event') {
        lastAuthor = null;
        return `<div class="pp-rv-event">
          <span class="pp-rv-event-content">${esc(c.content)}</span>
          <span class="pp-rv-event-meta">${esc(c.author_name)} · ${fmt(c.created_at)}</span>
        </div>`;
      }

      // Logged-in user: based on wp_id
      const isMine   = String(c.author_wp_id) === String(cfg.user.id);
      const isNew    = lastAuthor !== c.author_name;
      lastAuthor     = c.author_name;
      const body     = linkify(c.content);
      const isLong   = c.content.length > 180;
      const expandBtn = isLong
        ? `<button class="pp-rv-expand-btn">More ▾</button>`
        : '';

      return `<div class="pp-rv-msg${isMine ? ' pp-rv-msg--mine' : ''}">
        ${isNew && !isMine ? `<div class="pp-rv-msg-author">
          <span class="pp-rv-avatar">${avatarInitial(c.author_name)}</span>
          <span>${esc(c.author_name)}</span>
          <span class="pp-rv-msg-time">${fmt(c.created_at)}</span>
        </div>` : ''}
        ${isNew && isMine ? `<div class="pp-rv-msg-author pp-rv-msg-author--mine">
          <span class="pp-rv-msg-time">${fmt(c.created_at)}</span>
          <span>${esc(c.author_name)}</span>
          <span class="pp-rv-avatar pp-rv-avatar--mine">${avatarInitial(c.author_name)}</span>
        </div>` : ''}
        <div class="pp-rv-bubble${isMine ? ' pp-rv-bubble--mine' : ''}${isLong ? ' pp-rv-collapsible' : ''}">${body}</div>
        ${expandBtn}
        ${!isNew ? `<div class="pp-rv-msg-time-inline${isMine ? ' right' : ''}">${fmt(c.created_at)}</div>` : ''}
      </div>`;
    }).join('');
  }

  /* ── Navigate prev / next ───────────────────────────────────────────────── */
  function navigatePin(dir) {
    let pins = filteredPins(true).filter(p => p.status !== 'done');
    if (!pins.length) return;

    const idx  = pins.findIndex(p => String(p.id) === String(state.activePinId));
    let next   = idx + dir;
    if (next < 0) next = pins.length - 1;
    if (next >= pins.length) next = 0;

    const pin = pins[next];
    scrollToPinAndOpen(pin.id);
  }

  /* ── Dropdown helpers (callable outside panel) ───────────────────── */
  function updateDdBtn(btn, label, selected) {
    if (!btn) return;
    btn.innerHTML = selected.length
      ? `${label} <span class="pp-rv-dd-badge">${selected.length}</span>`
      : `${label} <span class="pp-rv-dd-arrow">▾</span>`;
    btn.classList.toggle('pp-rv-dd-trigger--active', selected.length > 0);
  }

  function renderActiveFilters() {
    // filterPages handled by page filter dropdown
  }

  /* ── Build DOM ──────────────────────────────────────────────────────────── */
  function buildUI() {
    if (document.getElementById('pp-rv-toolbar')) return;
    // Overlay
    const overlay = document.createElement('div');
    overlay.id        = 'pp-rv-overlay';
    overlay.className = 'pp-rv-overlay';
    document.body.appendChild(overlay);

    // Add-mode cancel bar
    const cancelBar = document.createElement('div');
    cancelBar.id = 'pp-rv-add-cancel-bar';
    cancelBar.innerHTML = `
      <span class="pp-rv-acb-hint">Click an element to drop a pin</span>
      <button class="pp-rv-acb-btn" id="pp-rv-add-cancel-btn">✕ Cancel</button>
    `;
    document.body.appendChild(cancelBar);
    document.getElementById('pp-rv-add-cancel-btn').addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      if (state.addMode) toggleAddMode();
    });

    // Cursor-preview pin (follows mouse in add-mode)
    const cursorPin = document.createElement('div');
    cursorPin.className = 'pp-rv-cursor-pin';
    cursorPin.id = 'pp-rv-cursor-pin';
    document.body.appendChild(cursorPin);
    document.addEventListener('mousemove', e => {
      if (!state.addMode) return;
      state.mouseX = e.clientX;
      state.mouseY = e.clientY;
      // Pre-save elements under hover, because when pressing Space
      // a böngésző már elveszi a :hover state-et mire elementsFromPoint fut
      state.hoveredEls = document.elementsFromPoint(e.clientX, e.clientY);
      cursorPin.style.left = e.clientX + 'px';
      cursorPin.style.top  = e.clientY + 'px';
    });

    // Toolbar – 1 FAB + speed-dial
    const toolbar = document.createElement('div');
    toolbar.id        = 'pp-rv-toolbar';
    toolbar.className = 'pp-rv-toolbar' + (cfg.fabPosition === 'left' ? ' pp-rv-toolbar--left' : '');
    toolbar.innerHTML = `
      <div class="pp-rv-speed-dial" id="pp-rv-speed-dial">
        <div class="pp-rv-sd-item" id="pp-rv-sd-add">
          <span class="pp-rv-sd-label">${cfg.strings.pinPlaceLabel}</span>
          <button class="pp-rv-sd-btn" title="${cfg.strings.newPin}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <line x1="12" y1="4" x2="12" y2="20"/><line x1="4" y1="12" x2="20" y2="12"/>
            </svg>
          </button>
        </div>
        ${cfg.user || cfg.canManage ? `
        <div class="pp-rv-sd-item" id="pp-rv-sd-panel">
          <span class="pp-rv-sd-label pp-rv-sd-label--with-badge">Reviews <span class="pp-rv-badge pp-rv-badge--inline" id="pp-rv-badge" style="display:none">0</span></span>
          <button class="pp-rv-sd-btn" id="pp-rv-sd-panel-btn" title="Review list" style="position:relative">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              ${cfg.fabPosition === 'left'
                ? '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><polyline points="13 8 17 12 13 16"/>'
                : '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/><polyline points="11 8 7 12 11 16"/>'}
            </svg>
          </button>
        </div>` : ''}
      </div>
      <button class="pp-rv-fab" id="pp-rv-fab" title="Click here for feedback">
        <svg class="pp-rv-fab-icon-pin" viewBox="300 120 760 760" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="fabG1" gradientUnits="userSpaceOnUse" x1="570.982" y1="880.328" x2="754.184" y2="241.812">
              <stop offset="0" stop-color="rgb(50,28,189)"/>
              <stop offset="1" stop-color="rgb(142,64,240)"/>
            </linearGradient>
          </defs>
          <path fill="url(#fabG1)" d="M 599.763 194.423 C 690.416 164.209 800.292 183.904 873.947 244.164 C 893.592 260.236 917.262 282.756 931.099 304.166 C 947.249 323.338 964.073 360.729 971.666 384.147 C 994.821 456.695 988.06 535.485 952.883 603.027 C 894.2 717.505 772.333 773.345 646.862 756.612 C 640.92 755.82 634.902 755.02 629.067 753.63 C 618.678 751.155 596.567 741.546 586.855 745.196 C 570.683 751.273 582.596 803.815 575.563 820.439 C 572.462 827.768 566.925 833.471 559.495 836.408 C 555.168 838.118 550.727 838.638 546.109 838.882 C 528.096 839.834 509.512 838.326 491.425 838.406 C 469.401 838.502 446.481 840.236 424.564 838.878 C 419.628 838.572 414.391 837.851 409.848 835.801 C 402.471 832.473 396.375 825.622 393.791 817.952 C 390.415 807.929 392.41 719.4 392.411 701.16 C 392.415 621.681 390.81 541.808 392.876 462.377 C 393.075 453.535 393.767 444.711 394.951 435.946 C 399.329 402.144 409.763 369.408 425.754 339.307 C 462.205 269.812 524.815 217.682 599.763 194.423 z"/>
          <path fill="rgb(140,68,236)" d="M 599.763 194.423 C 690.416 164.209 800.292 183.904 873.947 244.164 C 893.592 260.236 917.262 282.756 931.099 304.166 C 931.137 307.862 931.762 308.284 929.948 310.984 C 929.841 311.006 889.909 316.201 890.628 316.26 C 876.882 315.119 855.238 301.68 842.892 297.224 C 822.386 289.823 800.173 283.322 780.039 274.445 C 767.765 269.033 753.669 258.649 740.567 254.198 C 734.957 252.293 725.058 250.925 718.676 249.548 C 705.677 246.744 694.504 244.258 681.089 242.653 C 667.989 241.086 657.176 240.974 643.589 239.632 C 629.626 238.253 606.795 234.416 596.688 223.341 C 594.83 221.305 596.205 216.295 596.617 213.387 C 594.708 209.874 595.277 214.102 591.698 211.177 C 592.312 203.336 598.145 201.633 599.763 194.423 z"/>
          <path fill="rgb(255,255,255)" d="M 681.981 300.435 C 703.132 299.701 721.893 301.63 742.208 307.77 C 786.023 321.314 822.729 351.591 844.36 392.029 C 865.278 431.364 869.645 477.416 856.493 519.981 C 843.12 563.531 813.007 599.992 772.77 621.355 C 728.712 644.581 681.85 646.735 634.776 632.272 L 613.979 624.284 C 598.278 631.03 527.047 672.769 517.448 671.347 C 515.012 670.986 512.491 669.56 511.179 667.435 C 509.584 664.853 509.78 661.82 510.164 658.94 C 511.458 649.22 514.785 639.308 517.273 629.798 C 523.757 605.019 531.553 579.914 535.909 554.68 C 524.907 525.116 516.936 517.461 514.72 481.155 C 512.314 436.324 527.829 392.376 557.848 358.992 C 590.414 322.473 633.508 303.249 681.981 300.435 z"/>
          <path fill="rgb(140,68,236)" d="M 612.332 403.145 C 662.892 401.823 714.547 404 765.193 403.268 C 785.922 402.968 792.454 428.915 769.73 434.952 C 752.151 435.344 612.712 436.411 607.172 433.84 C 603.192 431.994 599.113 428.254 597.62 424.041 C 596.013 419.507 597.267 416.44 599.355 412.358 C 602.234 406.728 606.593 404.965 612.332 403.145 z"/>
          <path fill="rgb(140,68,236)" d="M 608.894 457.178 C 628.479 456.386 764.09 454.641 774.681 458.532 C 777.92 459.722 780.414 462.505 781.803 465.607 C 783.692 469.829 783.996 475.223 782.22 479.539 C 780.269 484.281 776.33 486.078 771.861 487.882 C 758.874 489.447 727.614 488.555 712.952 488.514 C 678.576 488.417 641.24 489.468 607.005 487.921 C 592.86 478.676 594.086 465.04 608.894 457.178 z"/>
          <path fill="rgb(140,68,236)" d="M 610.445 510.422 C 624.29 509.712 702.358 507.906 711.321 511.484 C 715.924 513.322 719.759 517.302 721.57 521.911 C 722.807 525.059 723.011 528.478 721.591 531.612 C 718.818 537.734 715.547 539.615 709.45 541.902 C 676.338 542.393 641.348 542.067 608.222 541.86 C 593.362 532.267 592.706 516.02 610.445 510.422 z"/>
        </svg>
        <svg class="pp-rv-fab-icon-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
      `;
    document.body.appendChild(toolbar);

    // FAB toggle speed-dial
    const fab      = document.getElementById('pp-rv-fab');
    const speedDial = document.getElementById('pp-rv-speed-dial');
    function toggleSpeedDial(forceClose) {
      if (state.addMode) { toggleAddMode(); }
      const isOpen = speedDial.classList.contains('open');
      if (forceClose || isOpen) {
        speedDial.classList.remove('open');
        fab.classList.remove('open');
        if (!forceClose) state.pinsVisible = false;
        closePopup();
        closePanel();
        state.speedDialOpen = false;
        saveState();
      } else {
        speedDial.classList.add('open');
        fab.classList.add('open');
        state.pinsVisible = true;
        state.speedDialOpen = true;
        saveState();
      }
      renderMarkers();
    }
    fab.addEventListener('click', e => { e.stopPropagation(); toggleSpeedDial(); });

    // Close popup when clicking outside — but speed-dial stays open
    document.addEventListener('click', e => {
      const popup = document.getElementById('pp-rv-popup');
      if ( popup &&
           !popup.contains(e.target) &&
           !e.target.closest('.pp-rv-pin') &&
           !e.target.closest('#pp-rv-toolbar') &&
           !e.target.closest('#pp-rv-panel') ) {
        closePopup();
      }
    });

    document.getElementById('pp-rv-sd-add').addEventListener('click', () => {
      if (!state.addMode) toggleAddMode();
    });
    document.getElementById('pp-rv-sd-panel')?.addEventListener('click', () => {
      togglePanel();
    });

    // Panel
    const panel = document.createElement('div');
    panel.id        = 'pp-rv-panel';
    panel.className = 'pp-rv-panel' + (cfg.fabPosition === 'left' ? ' pp-rv-panel--left' : '');
    panel.innerHTML = `
      <div class="pp-rv-panel-header">
        <span class="pp-rv-panel-title">
          <svg class="pp-rv-panel-logo" viewBox="0 0 1180 1100"><defs><linearGradient id="ppGrad1" gradientUnits="userSpaceOnUse" x1="570.982" y1="880.328" x2="754.184" y2="241.812"><stop offset="0" stop-color="rgb(50,28,189)"/><stop offset="1" stop-color="rgb(142,64,240)"/></linearGradient></defs><path fill="url(#ppGrad1)" d="M599.763 194.423C690.416 164.209 800.292 183.904 873.947 244.164C893.592 260.236 917.262 282.756 931.099 304.166C947.249 323.338 964.073 360.729 971.666 384.147C994.821 456.695 988.06 535.485 952.883 603.027C894.2 717.505 772.333 773.345 646.862 756.612C640.92 755.82 634.902 755.02 629.067 753.63C618.678 751.155 596.567 741.546 586.855 745.196C570.683 751.273 582.596 803.815 575.563 820.439C572.462 827.768 566.925 833.471 559.495 836.408C555.168 838.118 550.727 838.638 546.109 838.882C528.096 839.834 509.512 838.326 491.425 838.406C469.401 838.502 446.481 840.236 424.564 838.878C419.628 838.572 414.391 837.851 409.848 835.801C402.471 832.473 396.375 825.622 393.791 817.952C390.415 807.929 392.41 719.4 392.411 701.16C392.415 621.681 390.81 541.808 392.876 462.377C393.075 453.535 393.767 444.711 394.951 435.946C399.329 402.144 409.763 369.408 425.754 339.307C462.205 269.812 524.815 217.682 599.763 194.423z"/><path fill="rgb(140,68,236)" d="M599.763 194.423C690.416 164.209 800.292 183.904 873.947 244.164C893.592 260.236 917.262 282.756 931.099 304.166C931.137 307.862 931.762 308.284 929.948 310.984C929.841 311.006 889.909 316.201 890.628 316.26C876.882 315.119 855.238 301.68 842.892 297.224C822.386 289.823 800.173 283.322 780.039 274.445C767.765 269.033 753.669 258.649 740.567 254.198C734.957 252.293 725.058 250.925 718.676 249.548C705.677 246.744 694.504 244.258 681.089 242.653C667.989 241.086 657.176 240.974 643.589 239.632C629.626 238.253 606.795 234.416 596.688 223.341C594.83 221.305 596.205 216.295 596.617 213.387C594.708 209.874 595.277 214.102 591.698 211.177C592.312 203.336 598.145 201.633 599.763 194.423z"/><path fill="rgb(255,255,255)" d="M681.981 300.435C703.132 299.701 721.893 301.63 742.208 307.77C786.023 321.314 822.729 351.591 844.36 392.029C865.278 431.364 869.645 477.416 856.493 519.981C843.12 563.531 813.007 599.992 772.77 621.355C728.712 644.581 681.85 646.735 634.776 632.272L613.979 624.284C598.278 631.03 527.047 672.769 517.448 671.347C515.012 670.986 512.491 669.56 511.179 667.435C509.584 664.853 509.78 661.82 510.164 658.94C511.458 649.22 514.785 639.308 517.273 629.798C523.757 605.019 531.553 579.914 535.909 554.68C524.907 525.116 516.936 517.461 514.72 481.155C512.314 436.324 527.829 392.376 557.848 358.992C590.414 322.473 633.508 303.249 681.981 300.435z"/><path fill="rgb(140,68,236)" d="M612.332 403.145C662.892 401.823 714.547 404 765.193 403.268C785.922 402.968 792.454 428.915 769.73 434.952C752.151 435.344 612.712 436.411 607.172 433.84C603.192 431.994 599.113 428.254 597.62 424.041C596.013 419.507 597.267 416.44 599.355 412.358C602.234 406.728 606.593 404.965 612.332 403.145z"/><path fill="rgb(140,68,236)" d="M608.894 457.178C628.479 456.386 764.09 454.641 774.681 458.532C777.92 459.722 780.414 462.505 781.803 465.607C783.692 469.829 783.996 475.223 782.22 479.539C780.269 484.281 776.33 486.078 771.861 487.882C758.874 489.447 727.614 488.555 712.952 488.514C678.576 488.417 641.24 489.468 607.005 487.921C592.86 478.676 594.086 465.04 608.894 457.178z"/><path fill="rgb(140,68,236)" d="M610.445 510.422C624.29 509.712 702.358 507.906 711.321 511.484C715.924 513.322 719.759 517.302 721.57 521.911C722.807 525.059 723.011 528.478 721.591 531.612C718.818 537.734 715.547 539.615 709.45 541.902C676.338 542.393 641.348 542.067 608.222 541.86C593.362 532.267 592.706 516.02 610.445 510.422z"/></svg>
          PinOnion
        </span>
        <button class="pp-rv-close pp-rv-panel-close-btn" id="pp-rv-panel-close" title="Close panel">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              ${cfg.fabPosition === 'left'
                ? '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/><polyline points="11 8 7 12 11 16"/>'
                : '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><polyline points="13 8 17 12 13 16"/>'}
            </svg>
          </button>
      </div>
      <div class="pp-rv-panel-filters">
        <div class="pp-rv-search-row">
          <div class="pp-rv-search-wrap">
            <svg class="pp-rv-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="7"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input type="text" id="pp-rv-search" class="pp-rv-input" placeholder="Search by name or page..." autocomplete="off">
          </div>
          <div class="pp-rv-sort-wrap" id="pp-rv-sort-wrap">
            <button class="pp-rv-sort-btn" id="pp-rv-sort-btn" title="Sort by">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="3" y1="6"  x2="21" y2="6"/>
                <line x1="3" y1="12" x2="14" y2="12"/>
                <line x1="3" y1="18" x2="8"  y2="18"/>
                <polyline points="17 15 20 18 23 15"/>
                <line x1="20" y1="18" x2="20" y2="9"/>
              </svg>
            </button>
            <div class="pp-rv-sort-menu" id="pp-rv-dd-sort-menu">
              <div class="pp-rv-sort-menu-title">Sort by</div>
              <button class="pp-rv-dd-opt selected" data-sort="created_desc">Newest pin first</button>
              <button class="pp-rv-dd-opt" data-sort="created_asc">Oldest pin first</button>
              <button class="pp-rv-dd-opt" data-sort="comment_desc">Newest comment first</button>
              <button class="pp-rv-dd-opt" data-sort="comment_asc">Oldest comment first</button>
              <button class="pp-rv-dd-opt" data-sort="important">Important first</button>
            </div>
          </div>
          <div class="pp-rv-page-filter-wrap" id="pp-rv-page-filter-wrap">
            <button class="pp-rv-sort-btn" id="pp-rv-page-btn" title="Filter by page">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
              </svg>
            </button>
            <div class="pp-rv-sort-menu" id="pp-rv-page-filter-menu">
            </div>
          </div>
          <div class="pp-rv-filter-wrap" id="pp-rv-filter-wrap">
            <button class="pp-rv-filter-btn${(state.filterImportant || state.filterUnread || state.filterNew) ? ' has-value' : ''}" id="pp-rv-filter-btn" title="Filters">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
              </svg>
            </button>
            <div class="pp-rv-filter-menu" id="pp-rv-filter-menu">
              <div class="pp-rv-filter-row">
                <span class="pp-rv-filter-label">Only urgent</span>
                <label class="pp-rv-switch">
                  <input type="checkbox" id="pp-rv-sw-important"${state.filterImportant ? ' checked' : ''}>
                  <span class="pp-rv-switch-track"></span>
                </label>
              </div>
              <div class="pp-rv-filter-row">
                <span class="pp-rv-filter-label">${cfg.strings.filterUnread}</span>
                <label class="pp-rv-switch">
                  <input type="checkbox" id="pp-rv-sw-unread"${state.filterUnread ? ' checked' : ''}>
                  <span class="pp-rv-switch-track"></span>
                </label>
              </div>
              <div class="pp-rv-filter-row">
                <span class="pp-rv-filter-label">${cfg.strings.filterNew}</span>
                <label class="pp-rv-switch">
                  <input type="checkbox" id="pp-rv-sw-new"${state.filterNew ? ' checked' : ''}>
                  <span class="pp-rv-switch-track"></span>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="pp-rv-tabs" id="pp-rv-tabs">
        <button class="pp-rv-tab${state.activeTab === 'open'        ? ' active' : ''}" data-tab="open">${cfg.strings.tabOpen} <span class="pp-rv-tab-count" id="pp-rv-tab-count-open"></span></button>
        <button class="pp-rv-tab${state.activeTab === 'in_progress' ? ' active' : ''}" data-tab="in_progress">${cfg.strings.tabInProgress} <span class="pp-rv-tab-count" id="pp-rv-tab-count-in_progress"></span></button>
        <button class="pp-rv-tab${state.activeTab === 'done'        ? ' active' : ''}" data-tab="done">${cfg.strings.tabDone} <span class="pp-rv-tab-count" id="pp-rv-tab-count-done"></span></button>
      </div>
      <div class="pp-rv-pin-list" id="pp-rv-pin-list"></div>
      `;
    document.body.appendChild(panel);

    document.getElementById('pp-rv-panel-close').addEventListener('click', closePanel);

    // Scroll list if user scrolls anywhere in the panel
    document.getElementById('pp-rv-panel').addEventListener('wheel', e => {
      const pinList = document.getElementById('pp-rv-pin-list');
      if (!pinList) return;
      
      const inList = e.target.closest('#pp-rv-pin-list');
      const inMenu = e.target.closest('.pp-rv-sort-menu, .pp-rv-filter-menu, .pp-rv-page-filter-menu');
      
      if (!inList && !inMenu) {
        e.preventDefault();
        pinList.scrollTop += e.deltaY;
      }
    }, { passive: false });

    document.getElementById('pp-rv-search').addEventListener('input', e => {
      state.search = e.target.value;
      renderList(true);
    });

    // ── Dropdown logika ──────────────────────────────────────────────────────
    function initDropdown(ddId, menuId, btnId, stateKey, labelDefault) {
      const dd   = document.getElementById(ddId);
      const menu = document.getElementById(menuId);
      const btn  = document.getElementById(btnId);

      btn.addEventListener('click', e => {
        e.stopPropagation();
        // Close other dropdowns
        document.querySelectorAll('.pp-rv-dd-menu.open').forEach(m => {
          if (m !== menu) m.classList.remove('open');
        });
        menu.classList.toggle('open');
      });

      menu.addEventListener('change', () => {
        const checked = [...menu.querySelectorAll('input:checked')].map(i => i.value);
        state[stateKey] = checked;
        updateDdBtn(btn, labelDefault, checked);
        renderActiveFilters();
        renderList(true);
      });
    }

    document.getElementById('pp-rv-tabs').addEventListener('click', e => {
      const btn = e.target.closest('.pp-rv-tab');
      if (!btn) return;
      state.activeTab = btn.dataset.tab;
      renderList(true);
      saveState();
    });

    // Filter dropdown (filter button)
    const filterBtn  = document.getElementById('pp-rv-filter-btn');
    const filterMenu = document.getElementById('pp-rv-filter-menu');
    filterBtn.addEventListener('click', e => {
      e.stopPropagation();
      document.getElementById('pp-rv-dd-sort-menu')?.classList.remove('open');
      document.getElementById('pp-rv-sort-btn')?.classList.remove('active');
      filterMenu.classList.toggle('open');
      filterBtn.classList.toggle('active', filterMenu.classList.contains('open'));
    });
    filterMenu.addEventListener('click', e => e.stopPropagation());

    function updateFilterBtnState() {
      const active = state.filterImportant || state.filterUnread || state.filterNew;
      filterBtn.classList.toggle('has-value', active);
    }

    document.getElementById('pp-rv-sw-important').addEventListener('change', e => {
      state.filterImportant = e.target.checked;
      updateFilterBtnState(); renderList(true); saveState();
    });
    document.getElementById('pp-rv-sw-unread').addEventListener('change', e => {
      state.filterUnread = e.target.checked;
      updateFilterBtnState(); renderList(true); saveState();
    });
    document.getElementById('pp-rv-sw-new').addEventListener('change', e => {
      state.filterNew = e.target.checked;
      updateFilterBtnState(); renderList(true); saveState();
    });
    // Sort dropdown (radio) - with icon button
    const sortBtn  = document.getElementById('pp-rv-sort-btn');
    const sortMenu = document.getElementById('pp-rv-dd-sort-menu');
    const sortWrap = document.getElementById('pp-rv-sort-wrap');
    sortBtn.addEventListener('click', e => {
      e.stopPropagation();
      sortMenu.classList.toggle('open');
      sortBtn.classList.toggle('active', sortMenu.classList.contains('open'));
    });
    sortMenu.addEventListener('click', e => e.stopPropagation());
    sortMenu.querySelectorAll('.pp-rv-dd-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        state.sortBy = btn.dataset.sort;
        const isDefault = state.sortBy === 'created_desc';
        sortBtn.classList.toggle('has-value', !isDefault);
        sortMenu.querySelectorAll('.pp-rv-dd-opt').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        sortMenu.classList.remove('open');
        sortBtn.classList.remove('active');
        renderList(true);
      });
    });

    // Page filter dropdown
    const pageBtn  = document.getElementById('pp-rv-page-btn');
    const pageMenu = document.getElementById('pp-rv-page-filter-menu');
    if (pageBtn && pageMenu) {
      pageBtn.addEventListener('click', e => {
        e.stopPropagation();
        pageMenu.classList.toggle('open');
        pageBtn.classList.toggle('active', pageMenu.classList.contains('open'));
      });
      pageMenu.addEventListener('click', e => {
        e.stopPropagation();
        const btn = e.target.closest('.pp-rv-dd-pageopt');
        if (btn) {
          state.pageFilter = btn.dataset.page;
          const isDefault = state.pageFilter === 'all';
          pageBtn.classList.toggle('has-value', !isDefault);
          pageMenu.classList.remove('open');
          pageBtn.classList.remove('active');
          renderList(true);
          saveState();
        }
      });
    }


    // ── Restore visual state based on saved state ────────────────
    // Restore sort button
    const savedSortBtn = document.querySelector(`#pp-rv-dd-sort-menu .pp-rv-dd-opt[data-sort="${CSS.escape(state.sortBy)}"]`);
    if (savedSortBtn) {
      sortMenu.querySelectorAll('.pp-rv-dd-opt').forEach(b => b.classList.remove('selected'));
      savedSortBtn.classList.add('selected');
      document.getElementById('pp-rv-sort-btn')?.classList.toggle('has-value', state.sortBy !== 'created_desc');
    }

    const pageBtnUi = document.getElementById('pp-rv-page-btn');
    if (pageBtnUi) {
      pageBtnUi.classList.toggle('has-value', state.pageFilter !== 'all');
    }


    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
      document.querySelectorAll('.pp-rv-dd-menu.open').forEach(m => m.classList.remove('open'));
    });

    // Prev/next is in popup, removed from panel

    // Escape closes add-mode or popup
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (state.addMode) { toggleAddMode(); return; }
        if (document.getElementById('pp-rv-popup')) { closePopup(); return; }
      }
    });
  }

  /* ── Consider Admin bar height ────────────────────────────────── */
  function applyAdminBarOffset() {
    const bar = document.getElementById('wpadminbar');
    const h   = bar ? bar.offsetHeight : 0;
    const panel   = document.getElementById('pp-rv-panel');
    const toolbar = document.getElementById('pp-rv-toolbar');
    if (panel) {
      panel.style.top    = h + 'px';
      panel.style.height = 'calc(100vh - ' + h + 'px)';
    }
    if (toolbar) {
      toolbar.style.bottom = '24px';
    }
  }

  /* ── Init ───────────────────────────────────────────────────────────────── */
  function init() {
    buildUI();
    applyAdminBarOffset();
    if (state.speedDialOpen) {
      state.pinsVisible = true;
      const fab2 = document.getElementById('pp-rv-fab');
      const sd2  = document.getElementById('pp-rv-speed-dial');
      fab2?.classList.add('open');
      sd2?.classList.add('open');
    }
    if (state.panelOpen) {
      openPanel();
    }
    loadPins().then(() => {
      const openPinId = new URLSearchParams(location.search).get('open_pin');
      if (openPinId) {
        const cleanUrl = new URL(location.href);
        cleanUrl.searchParams.delete('open_pin');
        history.replaceState(null, '', cleanUrl.toString());
        setTimeout(() => scrollToPinAndOpen(parseInt(openPinId)), 300);
      }
    });

    // Load DB preferences in background — updates list if differs from session
    loadPrefsFromDB();

    // Redraw on window resize (px positions update)
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(renderMarkers, 150);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();





