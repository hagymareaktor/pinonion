/* PurePin Review — frontend JS */
(function () {
  'use strict';

  const cfg = window.purePinReview;
  if (!cfg) return;

  /* ── State ─────────────────────────────────────────────────────────────── */
  const SESSION_KEY = 'purepin-rv-ui';

  function loadSavedState() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || '{}'); } catch { return {}; }
  }
  function saveState() {
    const s = loadSavedState();
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      ...s,
      activeTab:       state.activeTab,
      filterAuthors:   state.filterAuthors,
      filterImportant: state.filterImportant,
      filterPages:     state.filterPages,
      sortBy:          state.sortBy,
      panelOpen:       state.panelOpen,
    }));
  }

  const _saved = loadSavedState();
  const state = {
    pins:            [],
    activePinId:     null,
    addMode:         false,
    panelOpen:       _saved.panelOpen || false,
    activeTab:       _saved.activeTab       || 'open',
    filterAuthors:   _saved.filterAuthors   || [],
    filterImportant: _saved.filterImportant || false,
    filterPages:     _saved.filterPages     || [],
    sortBy:          _saved.sortBy          || 'created_desc',
    search:          '',
    guestName:       localStorage.getItem('purepin-rv-name') || '',
    pendingPin:      null,
    pinsVisible:     false,   // pinmarkerek csak akkor látszanak, ha a FAB nyitva van
  };

  /* ── Helpers ────────────────────────────────────────────────────────────── */
  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // URL-eket felismeri és kattintható linkké alakítja (XSS-safe: nem-URL részeket escape-eli)
  function linkify(str) {
    const urlRe = /(https?:\/\/[^\s<>"]+)/g;
    return String(str ?? '').split(urlRe).map((part, i) => {
      if (i % 2 === 1) {
        const safe = esc(part);
        return `<a href="${safe}" target="_blank" rel="noopener noreferrer" class="kgb-rv-link">${safe}</a>`;
      }
      return esc(part);
    }).join('');
  }

  function fmt(d) {
    if (!d) return '';
    const dt   = new Date(String(d).replace(' ', 'T'));
    const diff = Math.floor((Date.now() - dt) / 1000);
    if (diff < 60)       return 'Most';
    if (diff < 3600)     return Math.floor(diff / 60) + ' perce';
    if (diff < 86400)    return Math.floor(diff / 3600) + ' órája';
    if (diff < 7*86400)  return Math.floor(diff / 86400) + ' napja';
    return dt.toLocaleString('hu-HU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function author() {
    if (cfg.user) return { name: cfg.user.name, wp_id: cfg.user.id };
    return { name: state.guestName, wp_id: 0 };
  }

  function docH() {
    return Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, 1);
  }
  function docW() {
    return Math.max(document.body.scrollWidth, document.documentElement.scrollWidth, 1);
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
  function urlPathname(url) {
    try { return new URL(url).pathname.replace(/\/$/, '') || '/'; } catch { return url; }
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
    const isGlobal = cfg.displayMode === 'global';
    const params   = isGlobal ? '' : '?' + new URLSearchParams({ url: cfg.pageUrl });
    state.pins = await api('GET', 'pins' + params);
    renderMarkers();
    if (cfg.user || cfg.canManage) {
      renderList();
      updateBadge();
      populateAuthorDropdown();
      if (isGlobal) populatePageDropdown();
    }
  }

  function populatePageDropdown() {
    const menu = document.getElementById('kgb-rv-dd-page-menu');
    if (!menu) return;
    const pages = [...new Map(state.pins.map(p => [p.page_title || urlPathname(p.page_url), p.page_title || urlPathname(p.page_url)])).values()].sort();
    menu.innerHTML = pages.map(t =>
      `<label class="kgb-rv-dd-opt"><input type="checkbox" value="${esc(t)}"${state.filterPages.includes(t) ? ' checked' : ''}>${esc(t)}</label>`
    ).join('') || '<div class="kgb-rv-dd-empty">Nincs oldal</div>';
    menu.addEventListener('change', () => {
      const checked = [...menu.querySelectorAll('input:checked')].map(i => i.value);
      state.filterPages = checked;
      updateDdBtn(document.getElementById('kgb-rv-dd-page-btn'), 'Oldal', checked);
      renderActiveFilters();
      renderList();
    });
  }

  function populateAuthorDropdown() {
    const menu = document.getElementById('kgb-rv-dd-author-menu');
    if (!menu) return;
    const authors = [...new Set(state.pins.map(p => p.author_name))].sort();
    menu.innerHTML = authors.map(a =>
      `<label class="kgb-rv-dd-opt"><input type="checkbox" value="${esc(a)}"${state.filterAuthors.includes(a) ? ' checked' : ''}>${esc(a)}</label>`
    ).join('') || '<div class="kgb-rv-dd-empty">Nincs beküldő</div>';
    // Újra bindeli a change event-et (menu innerHTML újraíródott)
    menu.addEventListener('change', () => {
      const checked = [...menu.querySelectorAll('input:checked')].map(i => i.value);
      state.filterAuthors = checked;
      updateDdBtn(document.getElementById('kgb-rv-dd-author-btn'), 'Beküldő', checked);
      renderActiveFilters();
      renderList();
    });
  }

  /* ── Pin markers on page ────────────────────────────────────────────────── */
  function renderMarkers() {
    document.querySelectorAll('.kgb-rv-pin').forEach(el => el.remove());
    if (!state.pinsVisible) return;

    state.pins.filter(p => isCurrentPage(p.page_url)).forEach((pin, idx) => {
      const m = document.createElement('div');
      m.className = 'kgb-rv-pin kgb-rv-pin--' + pin.status;
      m.dataset.pinId = pin.id;
      if (String(pin.id) === String(state.activePinId)) m.classList.add('active');

      const unread = parseInt(pin.unread_count) || 0;
      m.innerHTML =
        `<span class="kgb-rv-pin-num">${idx + 1}</span>` +
        (unread ? `<span class="kgb-rv-unread">${unread}</span>` : '');

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
        m.classList.add('kgb-rv-pin--guest');
        m.title = 'Bejelentkezés szükséges a megtekintéshez';
      }
      document.body.appendChild(m);
    });
  }

  /* ── Badge ──────────────────────────────────────────────────────────────── */
  function updateBadge() {
    const badge = document.getElementById('kgb-rv-badge');
    if (!badge) return;
    const total = state.pins.reduce((s, p) => s + (parseInt(p.unread_count) || 0), 0);
    badge.textContent = total;
    badge.style.display = total > 0 ? 'flex' : 'none';
  }

  /* ── Panel list ─────────────────────────────────────────────────────────── */
  function filteredPins() {
    let pins = state.pins.filter(p => {
      if (p.status !== state.activeTab) return false;
      if (state.filterAuthors.length && !state.filterAuthors.includes(p.author_name)) return false;
      if (state.filterImportant && !parseInt(p.important)) return false;
      if (state.filterPages.length && !state.filterPages.includes(p.page_title)) return false;
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
    try { return new Set(JSON.parse(localStorage.getItem('purepin-rv-opened') || '[]')); } catch { return new Set(); }
  }
  function markPinOpened(id) {
    const s = getOpenedPins();
    s.add(String(id));
    localStorage.setItem('purepin-rv-opened', JSON.stringify([...s]));
  }

  // Saját pin-ek nyilvántartása (submitter jogosultsághoz)
  function getMyPins() {
    try { return new Set(JSON.parse(localStorage.getItem('purepin-rv-my-pins') || '[]')); } catch { return new Set(); }
  }
  function trackMyPin(id) {
    const s = getMyPins();
    s.add(String(id));
    localStorage.setItem('purepin-rv-my-pins', JSON.stringify([...s]));
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
      const countEl = document.getElementById('kgb-rv-tab-count-' + tab);
      if (countEl) countEl.textContent = counts[tab] || '';
      const btn = document.querySelector('.kgb-rv-tab[data-tab="' + tab + '"]');
      if (btn) btn.classList.toggle('active', tab === state.activeTab);
    });
  }

  function renderList() {
    const list = document.getElementById('kgb-rv-pin-list');
    if (!list) return;

    renderTabs();
    const pins = filteredPins();
    if (!pins.length) {
      list.innerHTML = '<div class="kgb-rv-empty">Nincs találat</div>';
      return;
    }

    const statusColor = { open: '#f59e0b', in_progress: '#3b82f6', done: '#22c55e' };
    const openedPins  = getOpenedPins();

    list.innerHTML = pins.map((pin) => {
      const unread      = parseInt(pin.unread_count) || 0;
      const comments    = parseInt(pin.comment_count) || 0;
      const active      = String(pin.id) === String(state.activePinId) ? ' active' : '';
      const globalN     = state.pins.indexOf(pin) + 1;
      const isImportant = parseInt(pin.important) === 1;
      const otherPage   = cfg.displayMode === 'global' && !isCurrentPage(pin.page_url);

      // Új pin = sosem nyitotta meg senki; olvasatlan = volt megnyitva, de érkezett új komment
      const neverOpened = !openedPins.has(String(pin.id));
      const hasUnread   = !neverOpened && unread > 0;

      // CSS class-ok
      let itemCls = 'kgb-rv-pin-item';
      if (active)      itemCls += ' active';
      if (isImportant) itemCls += ' kgb-rv-pin-item--important';
      if (neverOpened) itemCls += ' kgb-rv-pin-item--new';
      if (hasUnread)   itemCls += ' kgb-rv-pin-item--unread';
      if (otherPage)   itemCls += ' kgb-rv-pin-item--other-page';

      // Num badge szín
      const numBg = isImportant ? '#dc2626' : (statusColor[pin.status] || '#4f46e5');

      // Unread jelzés szöveg
      const unreadLabel = neverOpened
        ? ''
        : (unread > 0 ? `<span class="kgb-rv-unread-msg">+${unread} új üzenet</span>` : '');

      const descRaw  = pin.description || '';
      const descText = descRaw.length > 72 ? descRaw.slice(0, 72) + '…' : (descRaw || '—');

      return `<div class="${itemCls}" data-pid="${pin.id}">
        <div class="kgb-rv-pin-item-head">
          <span class="kgb-rv-pin-item-num" style="background:${numBg}">${globalN}${neverOpened || hasUnread ? '<span class="kgb-rv-num-dot"></span>' : ''}</span>
          <div class="kgb-rv-pin-item-info">
            <span class="kgb-rv-pin-item-author">${esc(descText)}</span>
            <span class="kgb-rv-pin-item-meta-row">
              <span class="kgb-rv-pin-item-byline">👤 ${esc(pin.author_name)}</span>
              <span>${fmt(pin.created_at)}</span>
              ${unreadLabel}
            </span>
            ${otherPage ? `<span class="kgb-rv-other-page-badge">📄 ${esc(pin.page_title || urlPathname(pin.page_url))}</span>` : ''}
          </div>
          <div class="kgb-rv-pin-item-actions">
            ${cfg.canManage ? `<button class="kgb-rv-star-btn${isImportant ? ' active' : ''}" data-pid="${pin.id}" title="${isImportant ? 'Fontos jelölés törlése' : 'Fontosnak jelölés'}"><svg viewBox="0 0 24 24" fill="${isImportant ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg></button>` : ''}
            ${cfg.canManage && state.activeTab !== 'done' ? `<button class="kgb-rv-done-btn" data-pid="${pin.id}" title="Kész">✓</button>` : ''}
          </div>
        </div>
      </div>`;
    }).join('');

    list.querySelectorAll('.kgb-rv-pin-item').forEach(item => {
      item.addEventListener('click', e => {
        if (e.target.closest('.kgb-rv-done-btn')) {
          e.stopPropagation();
          const pid = parseInt(e.target.closest('.kgb-rv-done-btn').dataset.pid);
          const a   = author();
          api('PATCH', `pins/${pid}`, { status: 'done', author_name: a.name, author_wp_id: a.wp_id })
            .then(() => loadPins());
          return;
        }
        if (e.target.closest('.kgb-rv-star-btn')) {
          e.stopPropagation();
          const btn = e.target.closest('.kgb-rv-star-btn');
          const pid = parseInt(btn.dataset.pid);
          const pin = state.pins.find(p => String(p.id) === String(pid));
          if (!pin) return;
          const newVal = parseInt(pin.important) ? 0 : 1;
          const a = author();
          api('PATCH', `pins/${pid}`, { important: newVal, author_name: a.name, author_wp_id: a.wp_id })
            .then(() => { pin.important = newVal; renderMarkers(); renderList(); });
          return;
        }
        scrollToPinAndOpen(parseInt(item.dataset.pid));
      });
    });

    saveState();
  }

  function setNavInfo(cur, total) {
    const el = document.getElementById('kgb-rv-nav-info');
    if (el) el.textContent = total ? `${cur} / ${total}` : '–';
  }

  /* ── Scroll to pin ──────────────────────────────────────────────────────── */
  function scrollToPin(pinId) {
    const pin = state.pins.find(p => String(p.id) === String(pinId));
    if (!pin) return;
    const targetY = (pin.y_pct / 100) * docH() - window.innerHeight / 2;
    window.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' });

    const marker = document.querySelector(`.kgb-rv-pin[data-pin-id="${pinId}"]`);
    if (marker) {
      marker.classList.add('highlight');
      setTimeout(() => marker.classList.remove('highlight'), 2000);
    }
  }

  /* ── Nav confirm modal (más oldali pin) ────────────────────────────────── */
  function showNavConfirm(pin) {
    document.getElementById('kgb-rv-nav-confirm')?.remove();
    const modal = document.createElement('div');
    modal.id        = 'kgb-rv-nav-confirm';
    modal.className = 'kgb-rv-nav-confirm-backdrop';
    modal.innerHTML = `
      <div class="kgb-rv-nav-confirm-card">
        <div class="kgb-rv-nav-confirm-icon">📄</div>
        <div class="kgb-rv-nav-confirm-title">Másik oldalon található</div>
        <div class="kgb-rv-nav-confirm-page">${esc(pin.page_title || urlPathname(pin.page_url))}</div>
        <div class="kgb-rv-nav-confirm-btns">
          <button class="kgb-rv-nav-confirm-yes">Átnavigál</button>
          <button class="kgb-rv-nav-confirm-no">Mégsem</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('.kgb-rv-nav-confirm-yes').addEventListener('click', () => {
      location.href = navUrlForPin(pin);
    });
    modal.querySelector('.kgb-rv-nav-confirm-no').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  }

  // Sidebar-ból: scroll → vár a smooth scrollra → popup a pin marker helyén nyílik
  function scrollToPinAndOpen(pinId) {
    const pin = state.pins.find(p => String(p.id) === String(pinId));
    if (pin && cfg.displayMode === 'global' && !isCurrentPage(pin.page_url)) {
      showNavConfirm(pin);
      return;
    }
    closePopup();
    state.activePinId = pinId;
    renderMarkers();
    renderList();

    const pinAfterRender = state.pins.find(p => String(p.id) === String(pinId));
    const isFixed = pinAfterRender && parseInt(pinAfterRender.is_fixed);

    function openAtMarker() {
      const marker = document.querySelector(`.kgb-rv-pin[data-pin-id="${pinId}"]`);
      if (marker) {
        const rect = marker.getBoundingClientRect();
        // Hover szimulálás: visszaállítja a CSS/JS hover állapotot
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
      // Fixed elem: nem kell scrollolni, rögtön popup
      setTimeout(openAtMarker, 50);
    } else {
      scrollToPin(pinId);
      setTimeout(openAtMarker, 420);
    }
  }

  /* ── Panel toggle ───────────────────────────────────────────────────────── */
  function openPanel()  {
    state.panelOpen = true;
    document.getElementById('kgb-rv-panel')?.classList.add('open');
    document.getElementById('kgb-rv-panel-btn')?.classList.add('active');
    renderList();
    saveState();
  }
  function closePanel() {
    state.panelOpen = false;
    document.getElementById('kgb-rv-panel')?.classList.remove('open');
    document.getElementById('kgb-rv-panel-btn')?.classList.remove('active');
    saveState();
  }
  function togglePanel() { state.panelOpen ? closePanel() : openPanel(); }

  /* ── Add-mode toggle ────────────────────────────────────────────────────── */
  function canAddPin() {
    if (cfg.canManage) return true;
    if (!cfg.allowGuests) return false;
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
    if (e.target.closest('#kgb-rv-toolbar, #kgb-rv-panel, #kgb-rv-popup, #kgb-rv-nav-confirm')) return;
    e.preventDefault();
    e.stopPropagation();

    const fixed = isFixedAncestor(e.target);
    // Fixed/sticky elemeknél viewport %-ot tárolunk (scrolltól független)
    const x_pct = fixed
      ? (e.clientX / window.innerWidth  * 100).toFixed(4)
      : ((e.clientX + window.scrollX)   / docW() * 100).toFixed(4);
    const y_pct = fixed
      ? (e.clientY / window.innerHeight * 100).toFixed(4)
      : ((e.clientY + window.scrollY)   / docH() * 100).toFixed(4);

    state.pendingPin = { x_pct, y_pct, is_fixed: fixed ? 1 : 0 };
    toggleAddMode();
    showNewPinPopup(e.clientX, e.clientY);
  }

  function toggleAddMode() {
    if (!canAddPin()) {
      alert('Pin elhelyezése nem engedélyezett.');
      return;
    }
    state.addMode = !state.addMode;
    document.getElementById('kgb-rv-overlay').classList.toggle('active', state.addMode);
    document.getElementById('kgb-rv-fab')?.classList.toggle('add-active', state.addMode);
    document.body.classList.toggle('kgb-rv-add-mode', state.addMode);
    if (state.addMode) {
      state.pinsVisible = true;
      renderMarkers();
      document.addEventListener('click', onAddModeClick, true);
    } else {
      document.removeEventListener('click', onAddModeClick, true);
    }
  }

  /* ── Popup positioning ──────────────────────────────────────────────────── */
  // isFixed=true  → position:fixed  (navbar/fixed elemek, ill. panel-ből nyitva)
  // isFixed=false → position:absolute (normál oldalelem, görgéssel együtt mozog)
  function positionPopup(popup, cx, cy, isFixed) {
    if (cx !== null && cy !== null) {
      const pw = 320, ph = 240;
      let left = cx + 14;
      let top  = cy + 14;
      if (left + pw > window.innerWidth  - 12) left = cx - pw - 14;
      if (top  + ph > window.innerHeight - 12) top  = cy - ph - 14;
      left = Math.max(8, left);
      top  = Math.max(8, top);

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
      // Panel-ből nyitva: mindig fixed, jobbra igazítva
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

  /* ── Hover freeze: megtartja a nyitott navigációs menüt amíg popup nyitva ── */
  let _frozenNodes = [];

  function freezeHoverAt(cx, cy) {
    unfreezeHover();
    // elementsFromPoint: kihagyjuk a saját UI elemeinket
    const all = document.elementsFromPoint(cx, cy);
    const el  = all.find(e => !e.closest(
      '.kgb-rv-pin, #kgb-rv-toolbar, #kgb-rv-popup, #kgb-rv-panel, .kgb-rv-overlay'
    ));
    if (!el) return;

    // Végigjárjuk az ős-elemeket és megjelöljük őket
    let node = el;
    while (node && node !== document.body) {
      node.setAttribute('data-pp-frozen', '1');
      _frozenNodes.push(node);
      node = node.parentElement;
    }

    // CSS injektálás: a megjelölt elemek közvetlen gyerekeként lévő
    // dropdown/submenu elemeket force-show-ljuk
    let style = document.getElementById('kgb-rv-freeze-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'kgb-rv-freeze-style';
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
        transform: none !important;
        clip: auto !important;
        clip-path: none !important;
      }
    `;
  }

  function unfreezeHover() {
    _frozenNodes.forEach(n => n.removeAttribute('data-pp-frozen'));
    _frozenNodes = [];
    const style = document.getElementById('kgb-rv-freeze-style');
    if (style) style.textContent = '';
  }

  function closePopup() {
    unfreezeHover();
    document.getElementById('kgb-rv-popup')?.remove();
  }

  /* ── New pin popup ──────────────────────────────────────────────────────── */
  function showNewPinPopup(cx, cy) {
    closePopup();
    const a       = author();
    const needName = !a.name;

    const popup = document.createElement('div');
    popup.id        = 'kgb-rv-popup';
    popup.className = 'kgb-rv-popup kgb-rv-popup--new';
    popup.innerHTML = `
      <div class="kgb-rv-popup-head">
        <b>Új pin</b>
        <button class="kgb-rv-close" id="kgb-rv-popup-x">✕</button>
      </div>
      ${needName
        ? `<input type="text" id="kgb-rv-name-in" class="kgb-rv-input" placeholder="Neved…" value="${esc(state.guestName)}">`
        : `<div class="kgb-rv-popup-author">👤 ${esc(a.name)}</div>`
      }
      <textarea id="kgb-rv-desc-in" class="kgb-rv-input kgb-rv-textarea" placeholder="Leírás… mire kell figyelni?" rows="3"></textarea>
      <div class="kgb-rv-urgent-row">
        <button type="button" class="kgb-rv-urgent-btn" id="kgb-rv-urgent-btn" aria-pressed="false">
          🔴 Sürgős
        </button>
      </div>
      <div class="kgb-rv-popup-actions">
        <button class="kgb-rv-btn-cancel" id="kgb-rv-popup-cancel">Mégse</button>
        <button class="kgb-rv-btn-submit" id="kgb-rv-popup-submit">Pin elhelyezése</button>
      </div>`;

    positionPopup(popup, cx, cy, !!(state.pendingPin?.is_fixed));
    document.body.appendChild(popup);

    const focus = popup.querySelector('#kgb-rv-name-in') || popup.querySelector('#kgb-rv-comment-in');
    focus?.focus();

    const urgentBtn = popup.querySelector('#kgb-rv-urgent-btn');
    urgentBtn.addEventListener('click', () => {
      const on = urgentBtn.getAttribute('aria-pressed') === 'true';
      urgentBtn.setAttribute('aria-pressed', String(!on));
      urgentBtn.classList.toggle('active', !on);
    });

    popup.querySelector('#kgb-rv-popup-x').addEventListener('click', () => { state.pendingPin = null; closePopup(); });
    popup.querySelector('#kgb-rv-popup-cancel').addEventListener('click', () => { state.pendingPin = null; closePopup(); });
    popup.querySelector('#kgb-rv-popup-submit').addEventListener('click', submitNewPin);

    popup.querySelector('#kgb-rv-desc-in')?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitNewPin();
    });
  }

  async function submitNewPin() {
    const popup = document.getElementById('kgb-rv-popup');
    if (!popup || !state.pendingPin) return;

    const nameEl = popup.querySelector('#kgb-rv-name-in');
    let a = author();

    if (nameEl) {
      const n = nameEl.value.trim();
      if (!n) { nameEl.classList.add('error'); nameEl.focus(); return; }
      state.guestName = n;
      localStorage.setItem('purepin-rv-name', n);
      a = { name: n, wp_id: 0 };
    }

    const description = popup.querySelector('#kgb-rv-desc-in')?.value.trim() || '';
    const important   = popup.querySelector('#kgb-rv-urgent-btn')?.getAttribute('aria-pressed') === 'true' ? 1 : 0;
    const btn = popup.querySelector('#kgb-rv-popup-submit');
    btn.disabled    = true;
    btn.textContent = '…';

    try {
      const res = await api('POST', 'pins', {
        page_url:     cfg.pageUrl,
        page_title:   cfg.pageTitle,
        x_pct:        state.pendingPin.x_pct,
        y_pct:        state.pendingPin.y_pct,
        is_fixed:     state.pendingPin.is_fixed || 0,
        important,
        author_name:  a.name,
        author_wp_id: a.wp_id,
        description,
      });
      state.pendingPin  = null;
      state.activePinId = null;
      closePopup();
      await loadPins();

      if (!cfg.user && !cfg.canManage) {
        // Vendég: köszönőüzenet
        showGuestThankYou();
      } else {
        // Bejelentkezett: nyilvántartás + azonnal újra add-módba, hogy a következő pint le lehessen dobni
        trackMyPin(res.id);
        if (!state.addMode) toggleAddMode();
      }
    } catch (err) {
      btn.disabled    = false;
      btn.textContent = 'Pin elhelyezése';
      alert('Hiba: ' + err.message);
    }
  }

  /* ── Megosztási modal ───────────────────────────────────────────────────── */
  function genPin() {
    const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let r = '';
    for (let i = 0; i < 4; i++) r += c[Math.floor(Math.random() * c.length)];
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
    document.getElementById('kgb-rv-share-modal')?.remove();

    const reviewUrl = pin
      ? navUrlForPin(pin)
      : cfg.pageUrl.replace(/[?#].*$/, '') + '?review=1';

    const modalTitle = pin
      ? `🔗 Pin #${pin.id} megosztása`
      : '🔗 Megosztási link';

    const urlLabel = pin
      ? `Ez a link egyenesen a <strong>#${pin.id}</strong> pinre nyitja az oldalt`
      : 'Megosztható link';

    const modal = document.createElement('div');
    modal.id        = 'kgb-rv-share-modal';
    modal.className = 'kgb-rv-share-backdrop';
    modal.innerHTML = `
      <div class="kgb-rv-share-card">
        <div class="kgb-rv-share-head">
          <span class="kgb-rv-share-title">${esc(modalTitle)}</span>
          <button class="kgb-rv-close" id="kgb-rv-share-close">✕</button>
        </div>

        <div class="kgb-rv-share-section">
          <label class="kgb-rv-share-label">${urlLabel}</label>
          <div class="kgb-rv-share-url-row">
            <input type="text" class="kgb-rv-share-url-input" id="kgb-rv-share-url" readonly value="${esc(reviewUrl)}">
            <button class="kgb-rv-share-copy-btn" id="kgb-rv-share-copy-url" title="Link másolása">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              Másolás
            </button>
          </div>
          <p class="kgb-rv-share-hint">Ezt a linket kapja meg az ügyfél — a PIN-kódot külön kell elküldeni.</p>
        </div>

        <div class="kgb-rv-share-divider"></div>

        <div class="kgb-rv-share-section">
          <label class="kgb-rv-share-label">🔑 PIN-kód védelem</label>
          <label class="kgb-rv-share-toggle-row" id="kgb-rv-pin-toggle-row">
            <div class="kgb-rv-share-spinner" id="kgb-rv-pin-loading">⏳</div>
            <input type="checkbox" id="kgb-rv-pin-toggle" style="display:none">
            <span class="kgb-rv-share-toggle-label" id="kgb-rv-pin-toggle-label">Betöltés…</span>
          </label>
          <div class="kgb-rv-share-pin-area" id="kgb-rv-share-pin-area" style="display:none">
            <div class="kgb-rv-share-pin-row">
              <span class="kgb-rv-share-pin-display" id="kgb-rv-share-pin-val">----</span>
              <button class="kgb-rv-share-copy-btn kgb-rv-share-copy-btn--sm" id="kgb-rv-pin-regen">Új kód</button>
              <button class="kgb-rv-share-copy-btn kgb-rv-share-copy-btn--sm" id="kgb-rv-pin-copy">Másolás</button>
            </div>
          </div>
        </div>
      </div>`;

    document.body.appendChild(modal);

    const closeModal = () => modal.remove();
    document.getElementById('kgb-rv-share-close').addEventListener('click', closeModal);
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

    // URL copy
    document.getElementById('kgb-rv-share-copy-url').addEventListener('click', () => {
      copyText(reviewUrl).then(() => {
        const btn = document.getElementById('kgb-rv-share-copy-url');
        if (btn) { btn.textContent = '✓ Másolva'; setTimeout(() => { if (btn) btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Másolás`; }, 2000); }
      });
    });

    // Token állapot betöltése
    api('GET', 'token').then(data => {
      const loading  = document.getElementById('kgb-rv-pin-loading');
      const toggle   = document.getElementById('kgb-rv-pin-toggle');
      const label    = document.getElementById('kgb-rv-pin-toggle-label');
      const pinArea  = document.getElementById('kgb-rv-share-pin-area');
      const pinVal   = document.getElementById('kgb-rv-share-pin-val');
      if (!toggle) return;

      if (loading) loading.remove();
      toggle.style.display = '';
      toggle.checked = !!data.enabled;
      label.textContent = data.enabled ? 'Bekapcsolva — belépéshez kód szükséges' : 'Kikapcsolva — mindenki belép kód nélkül';

      if (data.enabled && data.value) {
        pinVal.textContent = data.value;
        pinArea.style.display = '';
      }

      toggle.addEventListener('change', async () => {
        const on = toggle.checked;
        label.textContent = '…';
        let newVal = pinVal.textContent !== '----' ? pinVal.textContent : '';
        if (on && !newVal) newVal = genPin();
        const res = await api('POST', 'token', { enabled: on, value: on ? newVal : undefined });
        label.textContent = res.enabled ? 'Bekapcsolva — belépéshez kód szükséges' : 'Kikapcsolva — mindenki belép kód nélkül';
        pinVal.textContent = res.value || '----';
        pinArea.style.display = res.enabled ? '' : 'none';
        if (res.enabled) {
          copyText(res.value);
          showShareToast(res.value + ' — kód a vágólapra másolva');
        }
      });

      document.getElementById('kgb-rv-pin-regen')?.addEventListener('click', async () => {
        const newPin = genPin();
        const res = await api('POST', 'token', { enabled: true, value: newPin });
        pinVal.textContent = res.value;
        copyText(res.value);
        const btn = document.getElementById('kgb-rv-pin-regen');
        if (btn) { btn.textContent = '✓ Másolva'; setTimeout(() => { if (btn) btn.textContent = 'Új kód'; }, 2000); }
      });

      document.getElementById('kgb-rv-pin-copy')?.addEventListener('click', () => {
        const val = document.getElementById('kgb-rv-share-pin-val')?.textContent;
        if (val && val !== '----') {
          copyText(val);
          const btn = document.getElementById('kgb-rv-pin-copy');
          if (btn) { btn.textContent = '✓'; setTimeout(() => { if (btn) btn.textContent = 'Másolás'; }, 2000); }
        }
      });
    }).catch(() => {
      const loading = document.getElementById('kgb-rv-pin-loading');
      if (loading) loading.textContent = '⚠ Nem sikerült betölteni';
    });
  }

  /* ── Megosztott link toast ──────────────────────────────────────────────── */
  function showShareToast(url) {
    const toast = document.createElement('div');
    toast.className = 'kgb-rv-toast' + (cfg.fabPosition === 'left' ? ' kgb-rv-toast--left' : '');
    toast.innerHTML = `
      <div class="kgb-rv-toast-icon" style="background:rgba(79,70,229,.15);color:#818cf8">🔗</div>
      <div class="kgb-rv-toast-body">
        <strong>Link másolva!</strong>
        <span>${url}</span>
      </div>
      <button class="kgb-rv-toast-close">✕</button>`;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('visible'));
    const remove = () => { toast.classList.remove('visible'); setTimeout(() => toast.remove(), 300); };
    toast.querySelector('.kgb-rv-toast-close').addEventListener('click', remove);
    setTimeout(remove, 4000);
  }

  /* ── Vendég köszönőüzenet ───────────────────────────────────────────────── */
  function showGuestThankYou() {
    const toast = document.createElement('div');
    toast.className = 'kgb-rv-toast' + (cfg.fabPosition === 'left' ? ' kgb-rv-toast--left' : '');
    toast.innerHTML = `
      <div class="kgb-rv-toast-icon">✓</div>
      <div class="kgb-rv-toast-body">
        <strong>Köszönjük!</strong>
        <span>A visszajelzésedet elküldtük a fejlesztőnek.</span>
      </div>
      <button class="kgb-rv-toast-close">✕</button>`;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('visible'));

    const remove = () => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    };
    toast.querySelector('.kgb-rv-toast-close').addEventListener('click', remove);
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

    // Hover freeze: a pin alatti navigációs elemet "nyitva tartjuk"
    const isFixedPin = parseInt(pin.is_fixed);
    const hvX = isFixedPin
      ? (pin.x_pct / 100) * window.innerWidth
      : (pin.x_pct / 100) * docW() - window.scrollX;
    const hvY = isFixedPin
      ? (pin.y_pct / 100) * window.innerHeight
      : (pin.y_pct / 100) * docH() - window.scrollY;
    freezeHoverAt(hvX, hvY);

    // Megnyitott pin jelölés + olvasottnak markolás
    markPinOpened(pinId);
    api('POST', `pins/${pinId}/read`).catch(() => {});
    pin.unread_count = 0;
    updateBadge();

    const comments = await api('GET', `pins/${pinId}/comments`);

    const a        = author();
    const needName = !a.name;
    const canDel   = !!cfg.canManage;

    // ── Státusz jogosultság ─────────────────────────────────────────────────
    const statusPerm      = cfg.statusPerm || 'submitter';
    const myPin           = isMyPin(pinId);
    const canChangeStatus = cfg.canManage || (statusPerm === 'submitter' && myPin);
    const allowedStatuses = cfg.canManage ? ['open', 'in_progress', 'done'] : ['open', 'done'];
    const statusLabels    = { open: 'Nyitott', in_progress: 'Folyamatban', done: 'Kész' };

    // Egyéni státusz pill (nem <select>, hanem dropdown)
    const statusMenuItems = allowedStatuses
      .filter(s => s !== pin.status)
      .map(s => `<button class="kgb-rv-status-opt" data-status="${s}">
        <span class="kgb-rv-sdot kgb-rv-sdot--${s}"></span>${statusLabels[s]}
      </button>`).join('');
    const statusPillHtml = canChangeStatus && statusMenuItems
      ? `<div class="kgb-rv-status-dd" id="kgb-rv-status-dd">
           <button class="kgb-rv-status-pill kgb-rv-status-pill--${pin.status}" id="kgb-rv-status-pill">
             <span class="kgb-rv-sdot kgb-rv-sdot--${pin.status}"></span>
             <span id="kgb-rv-status-label">${statusLabels[pin.status] ?? pin.status}</span>
             <span class="kgb-rv-status-arrow">▾</span>
           </button>
           <div class="kgb-rv-status-menu" id="kgb-rv-status-menu">${statusMenuItems}</div>
         </div>`
      : `<span class="kgb-rv-status-pill kgb-rv-status-pill--${pin.status} kgb-rv-status-pill--static">
           <span class="kgb-rv-sdot kgb-rv-sdot--${pin.status}"></span>
           ${statusLabels[pin.status] ?? pin.status}
         </span>`;

    const commentsHtml = buildCommentsHtml(comments);

    const popup = document.createElement('div');
    popup.id        = 'kgb-rv-popup';
    popup.className = 'kgb-rv-popup kgb-rv-popup--detail';
    popup.innerHTML = `
      <div class="kgb-rv-popup-head">
        <div class="kgb-rv-popup-nav">
          <button class="kgb-rv-popup-nav-btn" id="kgb-rv-popup-prev" title="Előző pin">‹</button>
          <span class="kgb-rv-popup-nav-info" id="kgb-rv-popup-nav-info">–</span>
          <button class="kgb-rv-popup-nav-btn" id="kgb-rv-popup-next" title="Következő pin">›</button>
        </div>
        <div class="kgb-rv-popup-head-right">
          ${statusPillHtml}
          ${canDel ? `<div class="kgb-rv-kebab-wrap" id="kgb-rv-kebab-wrap">
            <button class="kgb-rv-kebab-btn" id="kgb-rv-kebab-btn" title="Műveletek">⋮</button>
            <div class="kgb-rv-kebab-menu" id="kgb-rv-kebab-menu">
              <button class="kgb-rv-kebab-item" id="kgb-rv-share-pin-trigger">🔗 Pin megosztása</button>
              <button class="kgb-rv-kebab-item kgb-rv-kebab-item--danger" id="kgb-rv-del-trigger">🗑 Pin törlése</button>
            </div>
          </div>` : ''}
          <button class="kgb-rv-close" id="kgb-rv-popup-x">✕</button>
        </div>
      </div>
      <div class="kgb-rv-confirm-bar" id="kgb-rv-confirm-bar" style="display:none">
        <span>Biztosan törlöd ezt a pint?</span>
        <div class="kgb-rv-confirm-btns">
          <button class="kgb-rv-confirm-yes" id="kgb-rv-confirm-yes">Igen</button>
          <button class="kgb-rv-confirm-no"  id="kgb-rv-confirm-no">Mégsem</button>
        </div>
      </div>
      <div class="kgb-rv-pin-desc-block">
        <div class="kgb-rv-pin-desc-text">${linkify(pin.description || '')}</div>
        <div class="kgb-rv-pin-desc-meta">
          <span>👤 ${esc(pin.author_name)}</span>
          <span class="kgb-rv-pin-desc-sep">·</span>
          <span>📄 ${esc(pin.page_title || urlPathname(pin.page_url))}</span>
          <span class="kgb-rv-pin-desc-sep">·</span>
          <span>${fmt(pin.created_at)}</span>
        </div>
      </div>
      <div class="kgb-rv-comments-list" id="kgb-rv-clist">${commentsHtml}</div>
      ${(cfg.canManage || cfg.allowGuestComment) ? `<div class="kgb-rv-reply">
        ${needName ? `<input type="text" id="kgb-rv-reply-name" class="kgb-rv-input" placeholder="Neved…" value="${esc(state.guestName)}">` : ''}
        <textarea id="kgb-rv-reply-txt" class="kgb-rv-input kgb-rv-textarea" placeholder="Válasz… (Ctrl+Enter)" rows="2"></textarea>
        <div class="kgb-rv-popup-actions" style="padding:0">
          <button class="kgb-rv-btn-submit kgb-rv-btn-reply" id="kgb-rv-reply-btn">Küldés</button>
        </div>
      </div>` : ''}`;

    positionPopup(popup, cx, cy, !!isFixedPin);
    document.body.appendChild(popup);

    // Expand gombok kezelése delegálással (clist innerHTML-je újraíródhat)
    popup.addEventListener('click', e => {
      const btn = e.target.closest('.kgb-rv-expand-btn');
      if (!btn) return;
      const bubble = btn.previousElementSibling;
      if (bubble) {
        bubble.classList.toggle('kgb-rv-expanded');
        btn.textContent = bubble.classList.contains('kgb-rv-expanded') ? 'Kevesebb ▴' : 'Tovább ▾';
      }
    });

    // Legújabb felül → nem kell scrollolni
    const clist = popup.querySelector('#kgb-rv-clist');
    clist.scrollTop = 0;

    popup.querySelector('#kgb-rv-popup-x').addEventListener('click', closePopup);

    // Popup navigáció
    const pins = filteredPins();
    const idx  = pins.findIndex(p => String(p.id) === String(pinId));
    const navInfo = popup.querySelector('#kgb-rv-popup-nav-info');
    if (navInfo) navInfo.textContent = pins.length ? `${idx + 1} / ${pins.length}` : '–';
    // Gombok letiltása ha nincs hova navigálni
    if (pins.length <= 1) {
      popup.querySelector('#kgb-rv-popup-prev')?.setAttribute('disabled', '');
      popup.querySelector('#kgb-rv-popup-next')?.setAttribute('disabled', '');
    }
    popup.querySelector('#kgb-rv-popup-prev')?.addEventListener('click', e => { e.stopPropagation(); navigatePin(-1); });
    popup.querySelector('#kgb-rv-popup-next')?.addEventListener('click', e => { e.stopPropagation(); navigatePin(1); });

    // ── Státusz dropdown ────────────────────────────────────────────────────
    const statusMenu = popup.querySelector('#kgb-rv-status-menu');
    const statusPill = popup.querySelector('#kgb-rv-status-pill');
    if (statusPill && statusMenu) {
      statusPill.addEventListener('click', e => {
        e.stopPropagation();
        statusMenu.classList.toggle('open');
      });
      statusMenu.addEventListener('click', async e => {
        const btn = e.target.closest('.kgb-rv-status-opt');
        if (!btn) return;
        {
          const s  = btn.dataset.status;
          const ra = author();
          statusMenu.classList.remove('open');
          statusPill.disabled = true;
          await api('PATCH', `pins/${pinId}`, { status: s, author_name: ra.name, author_wp_id: ra.wp_id });
          pin.status = s;
          const updated = await api('GET', `pins/${pinId}/comments`);
          clist.innerHTML = buildCommentsHtml(updated);
          clist.scrollTop = 0;
          renderMarkers();
          renderList();
          // Pill frissítése: szín + szöveg + megmaradt opciók
          statusPill.className = `kgb-rv-status-pill kgb-rv-status-pill--${s}`;
          statusPill.querySelector('.kgb-rv-sdot').className = `kgb-rv-sdot kgb-rv-sdot--${s}`;
          popup.querySelector('#kgb-rv-status-label').textContent = statusLabels[s] ?? s;
          statusMenu.innerHTML = allowedStatuses.filter(x => x !== s)
            .map(x => `<button class="kgb-rv-status-opt" data-status="${x}">
              <span class="kgb-rv-sdot kgb-rv-sdot--${x}"></span>${statusLabels[x]}
            </button>`).join('');
          statusPill.disabled = false;
        }
      });
      document.addEventListener('click', function closeStatusMenu(ev) {
        if (!popup.contains(ev.target)) return;
        if (!ev.target.closest('#kgb-rv-status-dd')) {
          statusMenu.classList.remove('open');
          document.removeEventListener('click', closeStatusMenu);
        }
      });
    }

    // ── Kebab (⋮) menü ─────────────────────────────────────────────────────
    const kebabBtn  = popup.querySelector('#kgb-rv-kebab-btn');
    const kebabMenu = popup.querySelector('#kgb-rv-kebab-menu');
    if (kebabBtn && kebabMenu) {
      kebabBtn.addEventListener('click', e => {
        e.stopPropagation();
        kebabMenu.classList.toggle('open');
        statusMenu?.classList.remove('open');
      });
      document.addEventListener('click', function closeKebab(ev) {
        if (!ev.target.closest('#kgb-rv-kebab-wrap')) {
          kebabMenu.classList.remove('open');
          document.removeEventListener('click', closeKebab);
        }
      });
    }

    // ── Pin törlés: Igen / Mégsem megerősítő sáv ───────────────────────────
    const confirmBar = popup.querySelector('#kgb-rv-confirm-bar');
    if (canDel && confirmBar) {
      popup.querySelector('#kgb-rv-share-pin-trigger').addEventListener('click', () => {
        kebabMenu.classList.remove('open');
        showShareModal(pin);
      });

      popup.querySelector('#kgb-rv-del-trigger').addEventListener('click', () => {
        kebabMenu.classList.remove('open');
        confirmBar.style.display = 'flex';
      });
      popup.querySelector('#kgb-rv-confirm-no').addEventListener('click', () => {
        confirmBar.style.display = 'none';
      });
      popup.querySelector('#kgb-rv-confirm-yes').addEventListener('click', async () => {
        await api('DELETE', `pins/${pinId}`);
        closePopup();
        state.activePinId = null;
        await loadPins();
      });
    }

    popup.querySelector('#kgb-rv-reply-txt')?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendReply();
    });

    popup.querySelector('#kgb-rv-reply-btn')?.addEventListener('click', sendReply);

    async function sendReply() {
      const nameEl = popup.querySelector('#kgb-rv-reply-name');
      let ra = author();

      if (nameEl) {
        const n = nameEl.value.trim();
        if (!n) { nameEl.classList.add('error'); nameEl.focus(); return; }
        state.guestName = n;
        localStorage.setItem('purepin-rv-name', n);
        ra = { name: n, wp_id: 0 };
      }

      const txtEl  = popup.querySelector('#kgb-rv-reply-txt');
      const content = txtEl.value.trim();
      if (!content) { txtEl.focus(); return; }

      const btn = popup.querySelector('#kgb-rv-reply-btn');
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
        clist.scrollTop  = 0;
        pin.comment_count = updated.length;
        renderList();
      } catch (err) {
        alert('Hiba: ' + err.message);
      }

      btn.disabled    = false;
      btn.textContent = 'Küldés';
    }
  }

  function avatarInitial(name) {
    return esc(String(name || '?')[0].toUpperCase());
  }

  function buildCommentsHtml(comments) {
    if (!comments.length) return '<div class="kgb-rv-empty">Még nincs üzenet</div>';

    let lastAuthor = null;
    return comments.map(c => {
      if (c.type === 'event') {
        lastAuthor = null;
        return `<div class="kgb-rv-event">
          <span class="kgb-rv-event-content">⚙ ${esc(c.content)}</span>
          <span class="kgb-rv-event-meta">${esc(c.author_name)} · ${fmt(c.created_at)}</span>
        </div>`;
      }

      // Bejelentkezett user: wp_id alapján; vendég: névegyezés alapján
      const isMine   = cfg.user
        ? String(c.author_wp_id) === String(cfg.user.id)
        : !!state.guestName && c.author_name === state.guestName;
      const isNew    = lastAuthor !== c.author_name;
      lastAuthor     = c.author_name;
      const body     = linkify(c.content);
      const isLong   = c.content.length > 180;
      const expandBtn = isLong
        ? `<button class="kgb-rv-expand-btn">Tovább ▾</button>`
        : '';

      return `<div class="kgb-rv-msg${isMine ? ' kgb-rv-msg--mine' : ''}">
        ${isNew && !isMine ? `<div class="kgb-rv-msg-author">
          <span class="kgb-rv-avatar">${avatarInitial(c.author_name)}</span>
          <span>${esc(c.author_name)}</span>
          <span class="kgb-rv-msg-time">${fmt(c.created_at)}</span>
        </div>` : ''}
        ${isNew && isMine ? `<div class="kgb-rv-msg-author kgb-rv-msg-author--mine">
          <span class="kgb-rv-msg-time">${fmt(c.created_at)}</span>
          <span>${esc(c.author_name)}</span>
          <span class="kgb-rv-avatar kgb-rv-avatar--mine">${avatarInitial(c.author_name)}</span>
        </div>` : ''}
        <div class="kgb-rv-bubble${isMine ? ' kgb-rv-bubble--mine' : ''}${isLong ? ' kgb-rv-collapsible' : ''}">${body}</div>
        ${expandBtn}
        ${!isNew ? `<div class="kgb-rv-msg-time-inline${isMine ? ' right' : ''}">${fmt(c.created_at)}</div>` : ''}
      </div>`;
    }).join('');
  }

  /* ── Navigate prev / next ───────────────────────────────────────────────── */
  function navigatePin(dir) {
    const pins = filteredPins();
    if (!pins.length) return;

    const idx  = pins.findIndex(p => String(p.id) === String(state.activePinId));
    let next   = idx + dir;
    if (next < 0) next = pins.length - 1;
    if (next >= pins.length) next = 0;

    const pin = pins[next];
    scrollToPinAndOpen(pin.id);
  }

  /* ── Dropdown helpers (panel-on kívülről is hívható) ───────────────────── */
  function updateDdBtn(btn, label, selected) {
    if (!btn) return;
    btn.innerHTML = selected.length
      ? `${label} <span class="kgb-rv-dd-badge">${selected.length}</span>`
      : `${label} <span class="kgb-rv-dd-arrow">▾</span>`;
    btn.classList.toggle('kgb-rv-dd-trigger--active', selected.length > 0);
  }

  function renderActiveFilters() {
    const bar = document.getElementById('kgb-rv-active-filters');
    if (!bar) return;
    const chips = [
      ...state.filterPages.map(v => ({ label: '📄 ' + v, key: 'filterPages', val: v })),
    ];
    bar.innerHTML = chips.map(c =>
      `<span class="kgb-rv-chip" data-key="${esc(c.key)}" data-val="${esc(c.val)}">${esc(c.label)} <span class="kgb-rv-chip-x">✕</span></span>`
    ).join('');
    bar.style.display = chips.length ? 'flex' : 'none';
    bar.querySelectorAll('.kgb-rv-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const k = chip.dataset.key, v = chip.dataset.val;
        state[k] = state[k].filter(x => x !== v);
        const cb = document.querySelector(`#kgb-rv-dd-page-menu input[value="${CSS.escape(v)}"]`);
        if (cb) cb.checked = false;
        updateDdBtn(document.getElementById('kgb-rv-dd-page-btn'), 'Oldal', state.filterPages);
        renderActiveFilters();
        renderList();
      });
    });
  }

  /* ── Build DOM ──────────────────────────────────────────────────────────── */
  function buildUI() {
    // Overlay
    const overlay = document.createElement('div');
    overlay.id        = 'kgb-rv-overlay';
    overlay.className = 'kgb-rv-overlay';
    document.body.appendChild(overlay);

    // Cursor-preview pin (add-mode-ban követi az egeret)
    const cursorPin = document.createElement('div');
    cursorPin.className = 'kgb-rv-cursor-pin';
    cursorPin.id = 'kgb-rv-cursor-pin';
    document.body.appendChild(cursorPin);
    document.addEventListener('mousemove', e => {
      if (!state.addMode) return;
      cursorPin.style.left = e.clientX + 'px';
      cursorPin.style.top  = e.clientY + 'px';
    });

    // Toolbar – 1 FAB + speed-dial
    const toolbar = document.createElement('div');
    toolbar.id        = 'kgb-rv-toolbar';
    toolbar.className = 'kgb-rv-toolbar' + (cfg.fabPosition === 'left' ? ' kgb-rv-toolbar--left' : '');
    toolbar.innerHTML = `
      <div class="kgb-rv-speed-dial" id="kgb-rv-speed-dial">
        <div class="kgb-rv-sd-item" id="kgb-rv-sd-add">
          <span class="kgb-rv-sd-label">Pin elhelyezése</span>
          <button class="kgb-rv-sd-btn" title="Új pin">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <line x1="12" y1="4" x2="12" y2="20"/><line x1="4" y1="12" x2="20" y2="12"/>
            </svg>
          </button>
        </div>
        ${cfg.user || cfg.canManage ? `
        <div class="kgb-rv-sd-item" id="kgb-rv-sd-panel">
          <span class="kgb-rv-sd-label">Pinek listája</span>
          <button class="kgb-rv-sd-btn" id="kgb-rv-sd-panel-btn" title="Lista" style="position:relative">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <span class="kgb-rv-badge" id="kgb-rv-badge" style="display:none">0</span>
          </button>
        </div>
        <div class="kgb-rv-sd-item" id="kgb-rv-sd-share">
          <span class="kgb-rv-sd-label">Megosztott link</span>
          <button class="kgb-rv-sd-btn" title="Link másolása">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
          </button>
        </div>` : ''}
      </div>
      <button class="kgb-rv-fab" id="kgb-rv-fab" title="PurePin Review">
        <svg class="kgb-rv-fab-icon-pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
          <circle cx="12" cy="10" r="3"/>
        </svg>
        <svg class="kgb-rv-fab-icon-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>`;
    document.body.appendChild(toolbar);

    // FAB toggle speed-dial
    const fab      = document.getElementById('kgb-rv-fab');
    const speedDial = document.getElementById('kgb-rv-speed-dial');
    function toggleSpeedDial(forceClose) {
      if (state.addMode) { toggleAddMode(); return; }
      const isOpen = speedDial.classList.contains('open');
      if (forceClose || isOpen) {
        speedDial.classList.remove('open');
        fab.classList.remove('open');
        state.pinsVisible = false;
        closePopup();
        closePanel();
      } else {
        speedDial.classList.add('open');
        fab.classList.add('open');
        state.pinsVisible = true;
      }
      renderMarkers();
    }
    fab.addEventListener('click', e => { e.stopPropagation(); toggleSpeedDial(); });

    // Popup bezárása kívülre kattintáskor — de a speed-dial nyitva marad
    document.addEventListener('click', e => {
      const popup = document.getElementById('kgb-rv-popup');
      if ( popup &&
           !popup.contains(e.target) &&
           !e.target.closest('.kgb-rv-pin') &&
           !e.target.closest('#kgb-rv-toolbar') &&
           !e.target.closest('#kgb-rv-panel') ) {
        closePopup();
      }
    });

    document.getElementById('kgb-rv-sd-add').addEventListener('click', () => {
      toggleSpeedDial(true);
      toggleAddMode();
    });
    document.getElementById('kgb-rv-sd-panel')?.addEventListener('click', () => {
      toggleSpeedDial(true);
      togglePanel();
    });

    document.getElementById('kgb-rv-sd-share')?.addEventListener('click', () => {
      toggleSpeedDial(true);
      showShareModal();
    });

    // Panel
    const panel = document.createElement('div');
    panel.id        = 'kgb-rv-panel';
    panel.className = 'kgb-rv-panel' + (cfg.fabPosition === 'left' ? ' kgb-rv-panel--left' : '');
    panel.innerHTML = `
      <div class="kgb-rv-panel-header">
        <span class="kgb-rv-panel-title">📌 PurePin Review</span>
        <button class="kgb-rv-close" id="kgb-rv-panel-close">✕</button>
      </div>
      <div class="kgb-rv-panel-filters">
        <div class="kgb-rv-search-row">
          <div class="kgb-rv-search-wrap">
            <input type="text" id="kgb-rv-search" placeholder="Keresés neve vagy oldal alapján…" autocomplete="off">
          </div>
          <button class="kgb-rv-important-filter${state.filterImportant ? ' active' : ''}" id="kgb-rv-important-filter" title="Csak fontos pinek">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
          </button>
          <div class="kgb-rv-sort-wrap" id="kgb-rv-sort-wrap">
            <button class="kgb-rv-sort-btn" id="kgb-rv-sort-btn" title="Sorrend">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="3" y1="6"  x2="21" y2="6"/>
                <line x1="3" y1="12" x2="14" y2="12"/>
                <line x1="3" y1="18" x2="8"  y2="18"/>
                <polyline points="17 15 20 18 23 15"/>
                <line x1="20" y1="18" x2="20" y2="9"/>
              </svg>
            </button>
            <div class="kgb-rv-sort-menu" id="kgb-rv-dd-sort-menu">
              <div class="kgb-rv-sort-menu-title">Sorrend</div>
              <label class="kgb-rv-dd-opt"><input type="radio" name="kgb-sort" value="created_desc" checked>Legújabb pin előre</label>
              <label class="kgb-rv-dd-opt"><input type="radio" name="kgb-sort" value="created_asc">Legrégebbi pin előre</label>
              <label class="kgb-rv-dd-opt"><input type="radio" name="kgb-sort" value="comment_desc">Legújabb komment előre</label>
              <label class="kgb-rv-dd-opt"><input type="radio" name="kgb-sort" value="comment_asc">Legrégebbi komment előre</label>
              <label class="kgb-rv-dd-opt"><input type="radio" name="kgb-sort" value="important">🚩 Fontos előre</label>
            </div>
          </div>
        </div>
        <div class="kgb-rv-dd" id="kgb-rv-dd-page" style="display:none">
          <button class="kgb-rv-dd-trigger" id="kgb-rv-dd-page-btn">Oldal <span class="kgb-rv-dd-arrow">▾</span></button>
          <div class="kgb-rv-dd-menu" id="kgb-rv-dd-page-menu"></div>
        </div>
        <div id="kgb-rv-active-filters" class="kgb-rv-active-filters"></div>
      </div>
      <div class="kgb-rv-tabs" id="kgb-rv-tabs">
        <button class="kgb-rv-tab${state.activeTab === 'open'        ? ' active' : ''}" data-tab="open">Nyitott <span class="kgb-rv-tab-count" id="kgb-rv-tab-count-open"></span></button>
        <button class="kgb-rv-tab${state.activeTab === 'in_progress' ? ' active' : ''}" data-tab="in_progress">Folyamatban <span class="kgb-rv-tab-count" id="kgb-rv-tab-count-in_progress"></span></button>
        <button class="kgb-rv-tab${state.activeTab === 'done'        ? ' active' : ''}" data-tab="done">Kész <span class="kgb-rv-tab-count" id="kgb-rv-tab-count-done"></span></button>
      </div>
      <div class="kgb-rv-pin-list" id="kgb-rv-pin-list"></div>
      `;
    document.body.appendChild(panel);

    document.getElementById('kgb-rv-panel-close').addEventListener('click', closePanel);

    document.getElementById('kgb-rv-search').addEventListener('input', e => {
      state.search = e.target.value;
      renderList();
    });

    // ── Dropdown logika ──────────────────────────────────────────────────────
    function initDropdown(ddId, menuId, btnId, stateKey, labelDefault) {
      const dd   = document.getElementById(ddId);
      const menu = document.getElementById(menuId);
      const btn  = document.getElementById(btnId);

      btn.addEventListener('click', e => {
        e.stopPropagation();
        // Zárja a többi dropdown-t
        document.querySelectorAll('.kgb-rv-dd-menu.open').forEach(m => {
          if (m !== menu) m.classList.remove('open');
        });
        menu.classList.toggle('open');
      });

      menu.addEventListener('change', () => {
        const checked = [...menu.querySelectorAll('input:checked')].map(i => i.value);
        state[stateKey] = checked;
        updateDdBtn(btn, labelDefault, checked);
        renderActiveFilters();
        renderList();
      });
    }

    // Tabs
    document.getElementById('kgb-rv-tabs').addEventListener('click', e => {
      const btn = e.target.closest('.kgb-rv-tab');
      if (!btn) return;
      state.activeTab = btn.dataset.tab;
      renderList();
      saveState();
    });

    if (cfg.displayMode === 'global') {
      const pageDd = document.getElementById('kgb-rv-dd-page');
      if (pageDd) pageDd.style.display = '';
      initDropdown('kgb-rv-dd-page', 'kgb-rv-dd-page-menu', 'kgb-rv-dd-page-btn', 'filterPages', 'Oldal');
    }

    // Sorrend dropdown (radio) – ikon gombbal
    const sortBtn  = document.getElementById('kgb-rv-sort-btn');
    const sortMenu = document.getElementById('kgb-rv-dd-sort-menu');
    const sortWrap = document.getElementById('kgb-rv-sort-wrap');
    sortBtn.addEventListener('click', e => {
      e.stopPropagation();
      sortMenu.classList.toggle('open');
      sortBtn.classList.toggle('active', sortMenu.classList.contains('open'));
    });
    sortMenu.addEventListener('click', e => e.stopPropagation());
    sortMenu.querySelectorAll('input[type=radio]').forEach(radio => {
      radio.addEventListener('change', () => {
        state.sortBy = radio.value;
        const isDefault = radio.value === 'created_desc';
        sortBtn.classList.toggle('has-value', !isDefault);
        sortMenu.classList.remove('open');
        sortBtn.classList.remove('active');
        renderList();
      });
    });

    // Fontos szűrő gomb
    document.getElementById('kgb-rv-important-filter').addEventListener('click', () => {
      state.filterImportant = !state.filterImportant;
      document.getElementById('kgb-rv-important-filter').classList.toggle('active', state.filterImportant);
      renderList();
    });

    // ── Vizuális állapot visszaállítása mentett state alapján ────────────────
    // Sorrend radio visszaállítás
    const savedRadio = document.querySelector(`#kgb-rv-dd-sort-menu input[value="${CSS.escape(state.sortBy)}"]`);
    if (savedRadio) {
      savedRadio.checked = true;
      document.getElementById('kgb-rv-sort-btn')?.classList.toggle('has-value', state.sortBy !== 'created_desc');
    }

    // Kívülre kattintva zárja a dropdown-t
    document.addEventListener('click', () => {
      document.querySelectorAll('.kgb-rv-dd-menu.open').forEach(m => m.classList.remove('open'));
    });

    // Prev/next a popupban van, panel-ból eltávolítva

    // Escape closes add-mode or popup
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (state.addMode) { toggleAddMode(); return; }
        if (document.getElementById('kgb-rv-popup')) { closePopup(); return; }
      }
    });
  }

  /* ── Admin bar magasság figyelembevétele ────────────────────────────────── */
  function applyAdminBarOffset() {
    const bar = document.getElementById('wpadminbar');
    const h   = bar ? bar.offsetHeight : 0;
    const panel   = document.getElementById('kgb-rv-panel');
    const toolbar = document.getElementById('kgb-rv-toolbar');
    if (panel) {
      panel.style.top    = h + 'px';
      panel.style.height = 'calc(100vh - ' + h + 'px)';
    }
    if (toolbar) {
      toolbar.style.bottom = '24px';
    }
  }

  /* ── Token gate ─────────────────────────────────────────────────────────── */
  function showTokenGate() {
    const gate = document.createElement('div');
    gate.id        = 'kgb-rv-gate';
    gate.className = 'kgb-rv-gate';
    gate.innerHTML = `
      <div class="kgb-rv-gate-card">
        <div class="kgb-rv-gate-icon">📌</div>
        <h2 class="kgb-rv-gate-title">PurePin Review</h2>
        <p class="kgb-rv-gate-desc">Add meg a hozzáférési kódot a folytatáshoz.</p>
        <input type="text" id="kgb-rv-gate-input" class="kgb-rv-gate-input"
               placeholder="Kód…" autocomplete="off" maxlength="20">
        <p class="kgb-rv-gate-error" id="kgb-rv-gate-error"></p>
        <button class="kgb-rv-gate-btn" id="kgb-rv-gate-submit">Belépés</button>
      </div>`;
    document.body.appendChild(gate);

    const input  = gate.querySelector('#kgb-rv-gate-input');
    const errEl  = gate.querySelector('#kgb-rv-gate-error');
    const btn    = gate.querySelector('#kgb-rv-gate-submit');

    input.focus();

    async function tryToken() {
      const token = input.value.trim();
      if (!token) return;
      btn.disabled    = true;
      btn.textContent = '…';
      errEl.textContent = '';
      try {
        await api('POST', 'verify-token', { token });
        // Sikeres: újratölt, most már van cookie
        location.reload();
      } catch {
        errEl.textContent = 'Helytelen kód. Próbáld újra.';
        input.value = '';
        input.classList.add('shake');
        setTimeout(() => input.classList.remove('shake'), 500);
        btn.disabled    = false;
        btn.textContent = 'Belépés';
        input.focus();
      }
    }

    btn.addEventListener('click', tryToken);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') tryToken(); });
  }

  /* ── Init ───────────────────────────────────────────────────────────────── */
  function init() {
    if (cfg.tokenRequired) {
      showTokenGate();
      return;
    }
    buildUI();
    applyAdminBarOffset();
    if (state.panelOpen) {
      // Ha a panel nyitva volt, a FAB is nyitva volt — állítsuk vissza
      state.pinsVisible = true;
      const fab2 = document.getElementById('kgb-rv-fab');
      const sd2  = document.getElementById('kgb-rv-speed-dial');
      fab2?.classList.add('open');
      sd2?.classList.add('open');
      openPanel();
    }
    loadPins().then(() => {
      const openPinId = new URLSearchParams(location.search).get('open_pin');
      if (openPinId) {
        openPanel();
        setTimeout(() => scrollToPinAndOpen(parseInt(openPinId)), 300);
      }
    });

    // Ablak átméretezéskor újrarajzol (px-es pozíciók frissülnek)
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
