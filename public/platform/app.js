(function () {
  const SESSION_KEY = 'platform_session_id';
  const API = '/api/platform';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  let storesCache = [];
  let storeQrcodeObjectUrl = '';
  let avatarCropper = null;
  let avatarCropObjectUrl = '';
  let storeBgCropper = null;
  let storeBgCropObjectUrl = '';

  const STORE_BG_ASPECT_RATIO = 9 / 19.5;
  const STORE_BG_EXPORT_WIDTH = 750;
  const STORE_BG_EXPORT_HEIGHT = 1624;
  const STYLIST_DEFAULT_AVATAR = '/platform/images/default-stylist.png';

  const STORE_SELECT_IDS = [
    'filterStore', 'blStore', 'stylistFilterStore', 'stylistStore',
    'reportStore', 'auditStore', 'blSuggestStore'
  ];

  const AUDIT_ACTION_LABELS = {
    'auth.login': '平台登录',
    'store.create': '新建门店',
    'store.update': '更新门店',
    'store.status': '门店启停',
    'store.duplicate': '复制门店',
    'stylist.create': '新建发型师',
    'stylist.update': '更新发型师',
    'appointment.cancel': '代取消预约',
    'appointment.complete': '标记完成',
    'blacklist.add': '添加黑名单',
    'blacklist.remove': '移除黑名单',
    'cloud.sync_stores': '同步云开发'
  };

  function sessionId() {
    return localStorage.getItem(SESSION_KEY) || '';
  }

  function setSession(id) {
    if (id) localStorage.setItem(SESSION_KEY, id);
    else localStorage.removeItem(SESSION_KEY);
  }

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.json) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.json);
      delete options.json;
    }
    const sid = sessionId();
    if (sid) headers['x-session-id'] = sid;
    const res = await fetch(`${API}${path}`, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      // 仅当仍是同一 session 时才登出，避免 boot 校验与登录并发时误踢回登录页
      if (sessionId() === sid) {
        setSession('');
        showLogin();
      }
      throw new Error(data.message || '请重新登录');
    }
    return data;
  }

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  function showLogin() {
    const login = $('#view-login');
    const main = $('#view-main');
    if (login) login.classList.add('is-active');
    if (main) main.classList.remove('is-active');
  }

  function showMain() {
    const login = $('#view-login');
    const main = $('#view-main');
    if (login) login.classList.remove('is-active');
    if (main) main.classList.add('is-active');
  }

  function syncModalBodyLock() {
    const storeOpen = $('#storeEditModal') && !$('#storeEditModal').hidden;
    const stylistOpen = $('#stylistEditModal') && !$('#stylistEditModal').hidden;
    document.body.classList.toggle('modal-open', !!(storeOpen || stylistOpen));
  }

  function resetCustomSelectMenuStyle(menu) {
    if (!menu) return;
    menu.style.position = '';
    menu.style.top = '';
    menu.style.left = '';
    menu.style.width = '';
    menu.style.maxHeight = '';
    menu.style.zIndex = '';
  }

  function closeCustomSelectMenu(wrap) {
    if (!wrap) return;
    const menu = wrap._customMenu;
    wrap.classList.remove('is-open');
    if (!menu) return;
    menu.hidden = true;
    menu.classList.remove('is-portaled');
    resetCustomSelectMenuStyle(menu);
    if (menu.parentNode === document.body && wrap._customMenuHost) {
      wrap._customMenuHost.appendChild(menu);
    }
  }

  function closeAllCustomSelects() {
    $$('.custom-select.is-open').forEach((wrap) => closeCustomSelectMenu(wrap));
  }

  function positionCustomSelectMenu(trigger, menu) {
    const rect = trigger.getBoundingClientRect();
    const gap = 6;
    const spaceBelow = window.innerHeight - rect.bottom - gap - 8;
    const spaceAbove = rect.top - gap - 8;
    const preferBelow = spaceBelow >= 100 || spaceBelow >= spaceAbove;
    const maxHeight = Math.min(240, preferBelow ? spaceBelow : spaceAbove);
    const height = Math.max(80, maxHeight);
    const top = preferBelow
      ? rect.bottom + gap
      : Math.max(8, rect.top - gap - height);

    menu.style.position = 'fixed';
    menu.style.top = `${top}px`;
    menu.style.left = `${rect.left}px`;
    menu.style.width = `${Math.max(rect.width, 120)}px`;
    menu.style.maxHeight = `${height}px`;
    menu.style.zIndex = '4000';
  }

  function refreshCustomSelect(nativeSelect) {
    if (!nativeSelect) return;
    if (nativeSelect._rebuildCustomSelect) {
      nativeSelect._rebuildCustomSelect();
      return;
    }
    enhanceSelect(nativeSelect);
  }

  function enhanceSelect(nativeSelect) {
    if (!nativeSelect || nativeSelect.tagName !== 'SELECT') return;
    if (nativeSelect.closest('.custom-select')) {
      refreshCustomSelect(nativeSelect);
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'custom-select';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    const menu = document.createElement('div');
    menu.className = 'custom-select-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'listbox');

    nativeSelect.classList.add('native-select-hidden');
    const parent = nativeSelect.parentNode;
    parent.insertBefore(wrap, nativeSelect);
    wrap.appendChild(nativeSelect);
    wrap.appendChild(trigger);
    wrap.appendChild(menu);
    wrap._customMenu = menu;
    wrap._customMenuHost = wrap;

    function syncDisabled() {
      const disabled = nativeSelect.disabled;
      wrap.classList.toggle('is-disabled', disabled);
      trigger.disabled = disabled;
    }

    function syncUI() {
      const selected = nativeSelect.selectedOptions[0];
      trigger.textContent = selected ? selected.textContent : '请选择';
      menu.querySelectorAll('.custom-select-option').forEach((el) => {
        el.classList.toggle('is-selected', el.dataset.value === nativeSelect.value);
      });
      syncDisabled();
    }

    function closeMenu() {
      closeCustomSelectMenu(wrap);
    }

    function openMenu() {
      closeAllCustomSelects();
      document.body.appendChild(menu);
      menu.classList.add('is-portaled');
      wrap.classList.add('is-open');
      menu.hidden = false;
      requestAnimationFrame(() => positionCustomSelectMenu(trigger, menu));
    }

    function rebuildOptions() {
      menu.innerHTML = '';
      Array.from(nativeSelect.options).forEach((opt) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'custom-select-option';
        item.dataset.value = opt.value;
        item.textContent = opt.textContent;
        item.setAttribute('role', 'option');
        if (opt.value === nativeSelect.value) item.classList.add('is-selected');
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          nativeSelect.value = opt.value;
          nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
          syncUI();
          closeMenu();
        });
        menu.appendChild(item);
      });
      syncUI();
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (nativeSelect.disabled) return;
      if (wrap.classList.contains('is-open')) closeMenu();
      else openMenu();
    });

    menu.addEventListener('mousedown', (e) => e.stopPropagation());

    nativeSelect.addEventListener('change', syncUI);
    nativeSelect._rebuildCustomSelect = rebuildOptions;
    nativeSelect._syncCustomSelect = syncUI;
    rebuildOptions();
  }

  function initCustomSelects(root = document) {
    Array.from(root.querySelectorAll('select')).forEach((el) => enhanceSelect(el));
  }

  function enhanceDateInput(input) {
    if (!input || input.type !== 'date' || input.dataset.customized) return;
    if (input.closest('.custom-date')) return;

    input.dataset.customized = '1';
    const placeholder = input.getAttribute('data-placeholder') || '选择日期';

    const wrap = document.createElement('div');
    wrap.className = 'custom-date';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-date-trigger';

    input.classList.add('native-date-hidden');
    const parent = input.parentNode;
    parent.insertBefore(wrap, input);
    wrap.appendChild(input);
    wrap.appendChild(trigger);

    function sync() {
      const hasValue = !!input.value;
      trigger.textContent = hasValue ? input.value : placeholder;
      trigger.classList.toggle('is-placeholder', !hasValue);
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof input.showPicker === 'function') {
        try {
          input.showPicker();
          return;
        } catch (_) { /* fallback below */ }
      }
      input.click();
    });

    input.addEventListener('change', sync);
    input._syncCustomDate = sync;
    sync();
  }

  function refreshCustomDate(input) {
    if (!input) return;
    if (input._syncCustomDate) input._syncCustomDate();
    else enhanceDateInput(input);
  }

  function initCustomDateInputs(root = document) {
    Array.from(root.querySelectorAll('input[type="date"]')).forEach((el) => enhanceDateInput(el));
  }

  function refreshStoreSelects() {
    STORE_SELECT_IDS.forEach((id) => refreshCustomSelect($('#' + id)));
  }

  function setRoute(route) {
    $$('.nav-item').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.route === route);
    });
    const titles = {
      dashboard: '概览',
      stores: '门店管理',
      stylists: '发型师管理',
      reports: '跨店报表',
      appointments: '预约总览',
      blacklist: '用户黑名单',
      audit: '操作审计'
    };
    $('#pageTitle').textContent = titles[route] || '平台管理';

    $('#panel-dashboard').hidden = route !== 'dashboard';
    $('#panel-stores').hidden = route !== 'stores';
    $('#panel-stylists').hidden = route !== 'stylists';
    $('#panel-reports').hidden = route !== 'reports';
    $('#panel-appointments').hidden = route !== 'appointments';
    $('#panel-blacklist').hidden = route !== 'blacklist';
    $('#panel-audit').hidden = route !== 'audit';

    if (route === 'dashboard') loadDashboard();
    if (route === 'stores') loadStores();
    if (route === 'stylists') loadStylists();
    if (route === 'reports') loadReports();
    if (route === 'appointments') loadAppointments();
    if (route === 'blacklist') loadBlacklist();
    if (route === 'audit') loadAuditLogs();
  }

  function todayStr() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  async function loadSmsStatus() {
    const box = $('#smsStatusBody');
    if (!box) return;
    const data = await api('/sms/status');
    if (!data.success) {
      box.innerHTML = '<div class="empty-hint">短信状态加载失败</div>';
      return;
    }
    if (!data.enabled) {
      box.innerHTML = '<div class="empty-hint">短信未启用（请配置亿美 EMAY_APPID / EMAY_SECRETKEY）</div>';
      return;
    }
    const labels = {
      booking: '预约成功',
      cancel: '取消预约',
      reminder: '预约提醒',
      stylistCancel: '门店取消'
    };
    const ready = data.ready || {};
    const ids = data.activeTemplateIds || {};
    const rows = Object.keys(labels).map((key) => {
      const ok = ready[key];
      const id = ids[key] || '—';
      return `<div class="sms-status-row"><span>${labels[key]}</span><span class="sms-status-meta">${ok ? '可用' : '未就绪'} · ${escapeHtml(id)}</span></div>`;
    }).join('');
    box.innerHTML = rows || '<div class="empty-hint">暂无模板信息</div>';
  }

  async function loadDashboard() {
    const data = await api('/dashboard/summary');
    if (!data.success) return;
    loadSmsStatus();
    $('#statGrid').innerHTML = `
      <div class="stat-card glass"><div class="label">门店数</div><div class="value">${data.storeCount}</div></div>
      <div class="stat-card glass"><div class="label">今日预约</div><div class="value">${data.todayAppointments}</div></div>
      <div class="stat-card glass"><div class="label">待服务</div><div class="value">${data.pendingAppointments}</div></div>
      <div class="stat-card glass"><div class="label">黑名单</div><div class="value">${data.blacklistCount}</div></div>
    `;
    const list = (data.stores || []).map((s) => `
      <div class="store-today-row">
        <span>${escapeHtml(s.name)}</span>
        <strong>${s.todayCount} 单</strong>
      </div>
    `).join('') || '<div class="empty-hint">暂无门店</div>';
    $('#storeTodayList').innerHTML = list;
  }

  function openStoreModal(title, subtitle) {
    const modal = $('#storeEditModal');
    if (!modal) return;
    $('#storeEditTitle').textContent = title || '编辑门店';
    const subEl = $('#storeEditSubtitle');
    if (subEl) {
      if (subtitle) {
        subEl.textContent = subtitle;
        subEl.hidden = false;
      } else {
        subEl.textContent = '';
        subEl.hidden = true;
      }
    }
    modal.hidden = false;
    syncModalBodyLock();
  }

  function closeStoreModal() {
    const modal = $('#storeEditModal');
    if (modal) modal.hidden = true;
    syncModalBodyLock();
  }

  function openStylistModal(title, subtitle) {
    const modal = $('#stylistEditModal');
    if (!modal) return;
    $('#stylistEditTitle').textContent = title || '编辑发型师';
    const subEl = $('#stylistEditSubtitle');
    if (subEl) {
      if (subtitle) {
        subEl.textContent = subtitle;
        subEl.hidden = false;
      } else {
        subEl.textContent = '';
        subEl.hidden = true;
      }
    }
    modal.hidden = false;
    syncModalBodyLock();
  }

  function closeStylistModal() {
    const modal = $('#stylistEditModal');
    if (modal) modal.hidden = true;
    syncModalBodyLock();
  }

  async function loadStores() {
    const data = await api('/stores');
    if (!data.success) return;
    storesCache = data.stores || [];
    fillStoreSelects(storesCache);
    $('#storeList').innerHTML = storesCache.map((s) => `
      <div class="store-card glass" data-id="${s.id}">
        <div class="store-card-main">
          <div class="store-card-info">
            <h4>${escapeHtml(s.name)}</h4>
            <div class="store-card-meta">
              <span>${escapeHtml(s.workStart || '—')}–${escapeHtml(s.workEnd || '—')}</span>
              <span>${s.latitude != null && s.longitude != null ? '已配置坐标' : '未配置坐标'}</span>
            </div>
          </div>
        </div>
        <div class="store-card-actions">
          <span class="badge ${s.status === 'active' ? 'badge-active' : 'badge-disabled'}">${s.status === 'active' ? '营业中' : '已停用'}</span>
          <button type="button" class="btn btn-ghost btn-sm" data-dup-store="${s.id}">复制</button>
        </div>
      </div>
    `).join('') || '<div class="empty-hint glass card">暂无门店，点击「新建门店」</div>';

    $$('.store-card').forEach((card) => {
      card.addEventListener('click', () => openStoreEdit(card.dataset.id));
    });
    $$('[data-dup-store]').forEach((btn) => {
      btn.addEventListener('click', (e) => duplicateStore(btn.dataset.dupStore, e));
    });
  }

  function fillStoreSelects(list) {
    const opts = list.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
    $('#filterStore').innerHTML = `<option value="">全部门店</option>${opts}`;
    $('#blStore').innerHTML = `<option value="global">全平台</option>${opts}`;
    $('#stylistFilterStore').innerHTML = `<option value="">全部门店</option>${opts}`;
    $('#stylistStore').innerHTML = opts;
    $('#reportStore').innerHTML = `<option value="">全部门店</option>${opts}`;
    $('#auditStore').innerHTML = `<option value="">全部门店</option>${opts}`;
    $('#blSuggestStore').innerHTML = `<option value="">全部门店</option>${opts}`;
    refreshStoreSelects();
  }

  function formatAuditDetail(detail) {
    if (!detail || typeof detail !== 'object') return '—';
    const parts = [];
    if (detail.name) parts.push(detail.name);
    if (detail.phone) parts.push(detail.phone);
    if (detail.status) parts.push(`状态:${detail.status}`);
    if (detail.reason) parts.push(detail.reason);
    if (detail.date) parts.push(detail.date);
    if (detail.fields && detail.fields.length) parts.push(`字段:${detail.fields.join(',')}`);
    return parts.length ? parts.join(' · ') : JSON.stringify(detail);
  }

  async function loadAuditLogs() {
    if (!storesCache.length) {
      const data = await api('/stores');
      if (data.success) {
        storesCache = data.stores || [];
        fillStoreSelects(storesCache);
      }
    }
    refreshCustomSelect($('#auditAction'));
    refreshCustomSelect($('#auditStore'));
    const fromEl = $('#auditFrom');
    const toEl = $('#auditTo');
    if (fromEl && !fromEl.value) {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      const p = (n) => String(n).padStart(2, '0');
      fromEl.value = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }
    if (toEl && !toEl.value) toEl.value = todayStr();
    refreshCustomDate(fromEl);
    refreshCustomDate(toEl);
    await fetchAuditLogs();
  }

  async function fetchAuditLogs() {
    const params = new URLSearchParams();
    if ($('#auditAction').value) params.set('action', $('#auditAction').value);
    if ($('#auditStore').value) params.set('storeId', $('#auditStore').value);
    if ($('#auditFrom').value) params.set('from', $('#auditFrom').value);
    if ($('#auditTo').value) params.set('to', $('#auditTo').value);
    params.set('limit', '200');
    const data = await api(`/audit-logs?${params}`);
    if (!data.success) return toast('审计日志加载失败');
    const rows = data.logs || [];
    $('#auditTableBody').innerHTML = rows.length ? rows.map((r) => `
      <tr>
        <td>${formatDate(r.createdAt)}</td>
        <td>${escapeHtml(r.actor)}</td>
        <td>${escapeHtml(AUDIT_ACTION_LABELS[r.action] || r.action)}</td>
        <td>${escapeHtml(r.storeName || '—')}</td>
        <td>${escapeHtml(r.targetType)}${r.targetId ? ` #${escapeHtml(r.targetId)}` : ''}</td>
        <td class="audit-detail">${escapeHtml(formatAuditDetail(r.detail))}</td>
      </tr>
    `).join('') : '<tr><td colspan="6" class="empty-hint">该条件下暂无记录</td></tr>';
  }

  async function loadBlacklistSuggestions() {
    const params = new URLSearchParams();
    if ($('#blSuggestStore').value) params.set('storeId', $('#blSuggestStore').value);
    const data = await api(`/blacklist/suggestions?${params}`);
    if (!data.success) return;
    const rows = data.suggestions || [];
    $('#blSuggestBody').innerHTML = rows.length ? rows.map((r) => `
      <tr>
        <td>${escapeHtml(r.phone)}</td>
        <td>${escapeHtml(r.storeName)}</td>
        <td>${r.cancelled}</td>
        <td>${r.noShow}</td>
        <td>${escapeHtml(r.reason)}</td>
        <td><button type="button" class="btn btn-ghost btn-sm" data-bl-suggest="${r.phone}" data-bl-store="${r.storeId}" data-bl-reason="${escapeHtml(r.reason)}">确认拉黑</button></td>
      </tr>
    `).join('') : '<tr><td colspan="6" class="empty-hint">暂无建议（或均已拉黑）</td></tr>';

    $$('[data-bl-suggest]').forEach((btn) => {
      btn.addEventListener('click', () => {
        $('#blPhone').value = btn.dataset.blSuggest;
        $('#blStore').value = btn.dataset.blStore || 'global';
        $('#blReason').value = btn.dataset.blReason || '系统建议拉黑';
        $('#blPhone').focus();
        toast('已填入表单，请确认后添加');
      });
    });
  }

  async function loadReports() {
    if (!storesCache.length) {
      const data = await api('/stores');
      if (data.success) storesCache = data.stores || [];
      fillStoreSelects(storesCache);
    }
    const fromEl = $('#reportFrom');
    const toEl = $('#reportTo');
    if (fromEl && !fromEl.value) {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      const p = (n) => String(n).padStart(2, '0');
      fromEl.value = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }
    if (toEl && !toEl.value) toEl.value = todayStr();
    await fetchReport();
  }

  async function fetchReport() {
    const params = new URLSearchParams();
    if ($('#reportStore').value) params.set('storeId', $('#reportStore').value);
    if ($('#reportFrom').value) params.set('from', $('#reportFrom').value);
    if ($('#reportTo').value) params.set('to', $('#reportTo').value);
    const data = await api(`/reports/overview?${params}`);
    if (!data.success) return toast('报表加载失败');
    $('#reportStatGrid').innerHTML = `
      <div class="stat-card glass"><div class="label">预约单</div><div class="value">${data.total}</div></div>
      <div class="stat-card glass"><div class="label">取消率</div><div class="value">${data.cancelRate}%</div></div>
      <div class="stat-card glass"><div class="label">烫染占比</div><div class="value">${data.dyeRate}%</div></div>
      <div class="stat-card glass"><div class="label">待服务</div><div class="value">${data.booked}</div></div>
    `;
    const storeRows = (data.byStore || []).map((s) => `
      <tr>
        <td>${escapeHtml(s.name)}</td>
        <td>${s.total}</td>
        <td>${s.booked}</td>
        <td>${s.completed}</td>
        <td>${s.cancelled}</td>
        <td>${s.cancelRate}%</td>
        <td>${s.cut}</td>
        <td>${s.dye}</td>
      </tr>
    `).join('') || '<tr><td colspan="8" class="empty-hint">该区间暂无数据</td></tr>';
    $('#reportStoreBody').innerHTML = storeRows;
    const peaks = (data.peakHours || []).map((p) => `
      <div class="peak-row"><span>${String(p.hour).padStart(2, '0')}:00 – ${String(p.hour).padStart(2, '0')}:59</span><strong>${p.count} 条</strong></div>
    `).join('') || '<div class="empty-hint">暂无高峰数据</div>';
    $('#reportPeakList').innerHTML = peaks;
  }

  async function exportAppointments() {
    const params = new URLSearchParams();
    if ($('#filterStore').value) params.set('storeId', $('#filterStore').value);
    if ($('#filterDate').value) params.set('date', $('#filterDate').value);
    if ($('#filterPhone').value.trim()) params.set('phone', $('#filterPhone').value.trim());
    if ($('#filterStatus').value) params.set('status', $('#filterStatus').value);
    const sid = sessionId();
    const res = await fetch(`${API}/appointments/export?${params}`, {
      headers: sid ? { 'x-session-id': sid } : {}
    });
    if (!res.ok) return toast('导出失败');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `appointments-${todayStr()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('已导出');
  }

  async function duplicateStore(id, e) {
    if (e) e.stopPropagation();
    if (!confirm('复制该门店配置为新店（默认停用）？')) return;
    const data = await api(`/stores/${id}/duplicate`, { method: 'POST' });
    if (data.success) {
      toast('已复制门店');
      setRoute('stores');
    } else {
      toast(data.message || '复制失败');
    }
  }

  async function loadStylists() {
    if (!storesCache.length) {
      const storeData = await api('/stores');
      if (storeData.success) {
        storesCache = storeData.stores || [];
        fillStoreSelects(storesCache);
      }
    }
    const params = new URLSearchParams();
    if ($('#stylistFilterStore').value) params.set('storeId', $('#stylistFilterStore').value);
    const data = await api(`/stylists?${params}`);
    if (!data.success) return;
    const rows = data.stylists || [];
    $('#stylistList').innerHTML = rows.length ? rows.map((s) => {
      const avatarSrc = resolveStylistListAvatar(s);
      return `
      <div class="store-card glass stylist-list-card" data-stylist-id="${s.id}">
        <div class="store-card-main">
          <img
            class="stylist-card-avatar"
            src="${escapeHtml(avatarSrc)}"
            alt="${escapeHtml(s.name || '发型师')}"
            loading="lazy"
            data-fallback="${STYLIST_DEFAULT_AVATAR}"
          >
          <div class="store-card-info">
            <h4>${escapeHtml(s.name)}</h4>
            <div class="store-card-meta">
              <span>${escapeHtml(s.storeName || '—')}</span>
              <span>${escapeHtml(s.phone || '未填手机号')}</span>
            </div>
          </div>
        </div>
        <div class="store-card-actions">
          <span class="badge ${s.enabled ? 'badge-active' : 'badge-disabled'}">${s.enabled ? '启用' : '停用'}</span>
          <span class="badge ${s.workStatus === 'resting' ? 'badge-disabled' : 'badge-active'}">${s.workStatus === 'resting' ? '休息' : '工作'}</span>
        </div>
      </div>`;
    }).join('') : '<div class="empty-hint glass card">暂无发型师，点击「新建发型师」</div>';

    $$('.stylist-card-avatar').forEach((img) => {
      img.addEventListener('error', () => {
        const fallback = img.dataset.fallback || STYLIST_DEFAULT_AVATAR;
        if (!img.src.includes(fallback)) img.src = fallback;
      });
    });

    $$('[data-stylist-id]').forEach((card) => {
      card.addEventListener('click', () => openStylistEdit(card.dataset.stylistId));
    });
  }

  function resetStylistAvatarPreview() {
    setStylistAvatarPreview('');
  }

  function resolveStylistListAvatar(stylist) {
    const raw = stylist.photoPreviewUrl || stylist.photo || '';
    if (isBrowserDisplayablePhoto(raw)) return appendCacheBust(raw);
    return STYLIST_DEFAULT_AVATAR;
  }

  function isBrowserDisplayablePhoto(url) {
    const value = String(url || '').trim();
    if (!value) return false;
    if (value.startsWith('cloud://')) return false;
    return (
      value.startsWith('data:')
      || value.startsWith('blob:')
      || value.startsWith('/')
      || /^https?:\/\//i.test(value)
    );
  }

  function appendCacheBust(url) {
    const value = String(url || '').trim();
    if (!value || value.startsWith('data:') || value.startsWith('blob:')) return value;
    const sep = value.includes('?') ? '&' : '?';
    return `${value}${sep}_t=${Date.now()}`;
  }

  function setStylistAvatarPreview(url) {
    const preview = $('#stylistAvatarPreview');
    const placeholder = $('#stylistAvatarPlaceholder');
    const value = String(url || '').trim();
    if (!preview) return;
    const src = isBrowserDisplayablePhoto(value) ? value : STYLIST_DEFAULT_AVATAR;
    preview.hidden = false;
    if (placeholder) placeholder.hidden = true;
    preview.src = src === STYLIST_DEFAULT_AVATAR ? src : appendCacheBust(src);
  }

  function resetStoreBgPreview() {
    const preview = $('#storeBgPreview');
    const placeholder = $('#storeBgPlaceholder');
    if (preview) {
      preview.removeAttribute('src');
      preview.hidden = true;
    }
    if (placeholder) placeholder.hidden = false;
  }

  function setStoreBgPreview(url) {
    const preview = $('#storeBgPreview');
    const placeholder = $('#storeBgPlaceholder');
    const value = String(url || '').trim();
    if (!preview || !placeholder) return;
    if (!isBrowserDisplayablePhoto(value)) {
      if (!value) resetStoreBgPreview();
      return;
    }
    preview.hidden = false;
    placeholder.hidden = true;
    preview.src = appendCacheBust(value);
  }

  function updateStoreBgControls() {
    const id = $('#storeId').value;
    const hasId = !!id;
    const pickBtn = $('#btnPickStoreBg');
    const hint = $('#storeBgHint');
    if (pickBtn) pickBtn.disabled = !hasId;
    if (hint) hint.hidden = hasId;
  }

  async function refreshStoreBgPreview(storeId, fallbackUrl) {
    if (!storeId) return;
    try {
      const data = await api(`/stores/${storeId}`);
      if (!data.success || !data.store) return;
      const remote = data.store.backgroundImagePreviewUrl || data.store.backgroundImage || '';
      if (isBrowserDisplayablePhoto(remote)) {
        setStoreBgPreview(remote);
        return;
      }
    } catch (_) { /* ignore */ }
    if (isBrowserDisplayablePhoto(fallbackUrl)) {
      setStoreBgPreview(fallbackUrl);
    }
  }

  async function uploadStoreBackgroundImage(storeId, imageBase64) {
    return api(`/stores/${storeId}/background`, { method: 'POST', json: { imageBase64 } });
  }

  function destroyStoreBgCropper() {
    if (storeBgCropper) {
      storeBgCropper.destroy();
      storeBgCropper = null;
    }
    if (storeBgCropObjectUrl) {
      URL.revokeObjectURL(storeBgCropObjectUrl);
      storeBgCropObjectUrl = '';
    }
  }

  function closeStoreBgCropModal() {
    destroyStoreBgCropper();
    const modal = $('#storeBgCropModal');
    const image = $('#storeBgCropImage');
    if (image) {
      image.onload = null;
      image.onerror = null;
      image.removeAttribute('src');
    }
    if (modal) modal.hidden = true;
  }

  function initStoreBgCropper(image) {
    if (!image || !window.Cropper) return;
    if (storeBgCropper) {
      storeBgCropper.destroy();
      storeBgCropper = null;
    }
    storeBgCropper = new window.Cropper(image, {
      aspectRatio: STORE_BG_ASPECT_RATIO,
      viewMode: 1,
      dragMode: 'move',
      autoCropArea: 1,
      background: false,
      responsive: true,
      restore: false,
      guides: true,
      center: true,
      highlight: true,
      cropBoxMovable: false,
      cropBoxResizable: false,
      toggleDragModeOnDblclick: false,
      zoomable: true,
      zoomOnWheel: true,
      wheelZoomRatio: 0.08,
      scalable: false,
      ready() {
        this.cropper.crop();
      }
    });
  }

  function openStoreBgCropModal(file) {
    if (!file) return;
    if (!window.Cropper) return toast('裁剪组件未加载，请刷新页面重试');
    destroyStoreBgCropper();
    const modal = $('#storeBgCropModal');
    const image = $('#storeBgCropImage');
    if (!modal || !image) return;

    modal.hidden = false;
    image.onload = () => {
      window.requestAnimationFrame(() => initStoreBgCropper(image));
    };
    image.onerror = () => toast('图片加载失败，请换一张重试');
    image.removeAttribute('src');
    storeBgCropObjectUrl = URL.createObjectURL(file);
    image.src = storeBgCropObjectUrl;
  }

  function getStoreBgCroppedBase64(cropper) {
    if (!cropper) throw new Error('裁剪器未就绪');
    const canvas = cropper.getCroppedCanvas({
      width: STORE_BG_EXPORT_WIDTH,
      height: STORE_BG_EXPORT_HEIGHT,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high'
    });
    if (!canvas || !canvas.width) throw new Error('裁剪失败，请重试');
    return canvas.toDataURL('image/jpeg', 0.9);
  }

  async function refreshStylistAvatarPreview(stylistId, fallbackUrl) {
    if (!stylistId) return;
    try {
      const data = await api(`/stylists/${stylistId}`);
      if (!data.success || !data.stylist) return;
      const remote = data.stylist.photoPreviewUrl || data.stylist.photo || '';
      if (isBrowserDisplayablePhoto(remote)) {
        setStylistAvatarPreview(remote);
        return;
      }
      setStylistAvatarPreview('');
    } catch (_) { /* ignore */ }
    if (isBrowserDisplayablePhoto(fallbackUrl)) {
      setStylistAvatarPreview(fallbackUrl);
    } else {
      setStylistAvatarPreview('');
    }
  }

  async function restoreStylistAvatarDefault() {
    const stylistId = $('#stylistId').value;
    if (!stylistId) return toast('请先保存发型师后再操作');
    if (!confirm('确定恢复为默认头像？')) return;
    const data = await api(`/stylists/${stylistId}`, { method: 'PUT', json: { photo: '' } });
    if (!data.success) return toast(data.message || '恢复失败');
    setStylistAvatarPreview('');
    toast('已恢复默认头像');
    if ($('#panel-stylists').hidden === false) loadStylists();
  }

  function updateStylistAvatarControls() {
    const id = $('#stylistId').value;
    const hasId = !!id;
    const pickBtn = $('#btnPickStylistAvatar');
    const resetBtn = $('#btnResetStylistAvatar');
    const hint = $('#stylistAvatarHint');
    if (pickBtn) pickBtn.disabled = !hasId;
    if (resetBtn) resetBtn.disabled = !hasId;
    if (hint) hint.hidden = hasId;
  }

  function destroyAvatarCropper() {
    if (avatarCropper) {
      avatarCropper.destroy();
      avatarCropper = null;
    }
    if (avatarCropObjectUrl) {
      URL.revokeObjectURL(avatarCropObjectUrl);
      avatarCropObjectUrl = '';
    }
  }

  function closeAvatarCropModal() {
    destroyAvatarCropper();
    const modal = $('#avatarCropModal');
    const image = $('#avatarCropImage');
    if (image) {
      image.onload = null;
      image.onerror = null;
      image.removeAttribute('src');
    }
    if (modal) modal.hidden = true;
  }

  function initAvatarCropper(image) {
    if (!image || !window.Cropper) return;
    if (avatarCropper) {
      avatarCropper.destroy();
      avatarCropper = null;
    }
    avatarCropper = new window.Cropper(image, {
      aspectRatio: 1,
      viewMode: 1,
      dragMode: 'move',
      autoCropArea: 0.92,
      background: false,
      responsive: true,
      restore: false,
      guides: true,
      center: true,
      highlight: true,
      cropBoxMovable: false,
      cropBoxResizable: false,
      toggleDragModeOnDblclick: false,
      zoomable: true,
      zoomOnWheel: true,
      wheelZoomRatio: 0.08,
      scalable: false,
      minContainerWidth: 280,
      minContainerHeight: 280,
      ready() {
        this.cropper.crop();
      }
    });
  }

  function openAvatarCropModal(file) {
    if (!file) return;
    if (!window.Cropper) return toast('裁剪组件未加载，请刷新页面重试');
    destroyAvatarCropper();
    const modal = $('#avatarCropModal');
    const image = $('#avatarCropImage');
    if (!modal || !image) return;

    modal.hidden = false;
    image.onload = () => {
      window.requestAnimationFrame(() => initAvatarCropper(image));
    };
    image.onerror = () => toast('图片加载失败，请换一张重试');
    image.removeAttribute('src');
    avatarCropObjectUrl = URL.createObjectURL(file);
    image.src = avatarCropObjectUrl;
  }

  function getCircularCroppedBase64(cropper) {
    if (!cropper) throw new Error('裁剪器未就绪');
    const source = cropper.getCroppedCanvas({
      width: 320,
      height: 320,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high'
    });
    if (!source || !source.width) throw new Error('裁剪失败，请重试');
    const size = 320;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(source, 0, 0, size, size);
    return canvas.toDataURL('image/jpeg', 0.9);
  }

  async function uploadStylistAvatarImage(stylistId, imageBase64) {
    return api(`/stylists/${stylistId}/avatar`, { method: 'POST', json: { imageBase64 } });
  }

  async function openStylistEdit(id) {
    const data = await api(`/stylists/${id}`);
    if (!data.success) return toast(data.message || '加载失败');
    const s = data.stylist;
    $('#stylistId').value = s.id;
    $('#stylistStore').value = s.storeId;
    $('#stylistName').value = s.name || '';
    $('#stylistPhone').value = s.phone || '';
    $('#stylistUsername').value = s.username || '';
    $('#stylistPassword').value = s.password || '';
    $('#stylistRank').value = s.rank || '';
    $('#stylistWorkStatus').value = s.workStatus || 'working';
    $('#stylistEnabled').value = s.enabled ? '1' : '0';
    $('#stylistPassword').required = false;
    setStylistAvatarPreview(s.photoPreviewUrl || s.photo || '');
    updateStylistAvatarControls();
    refreshCustomSelect($('#stylistStore'));
    refreshCustomSelect($('#stylistWorkStatus'));
    refreshCustomSelect($('#stylistEnabled'));
    openStylistModal(`编辑 · ${s.name}`, '基本信息、账号与工作状态');
  }

  async function newStylist() {
    if (!storesCache.length) {
      const data = await api('/stores');
      if (data.success) {
        storesCache = data.stores || [];
        fillStoreSelects(storesCache);
      }
    }
    $('#stylistId').value = '';
    $('#stylistForm').reset();
    $('#stylistWorkStatus').value = 'working';
    $('#stylistEnabled').value = '1';
    $('#stylistPassword').required = true;
    if (storesCache[0]) $('#stylistStore').value = storesCache[0].id;
    resetStylistAvatarPreview();
    updateStylistAvatarControls();
    refreshCustomSelect($('#stylistStore'));
    refreshCustomSelect($('#stylistWorkStatus'));
    refreshCustomSelect($('#stylistEnabled'));
    openStylistModal('新建发型师', '保存后可上传头像');
  }

  async function saveStylist() {
    const id = $('#stylistId').value;
    const payload = {
      storeId: Number($('#stylistStore').value),
      name: $('#stylistName').value.trim(),
      phone: $('#stylistPhone').value.trim(),
      username: $('#stylistUsername').value.trim(),
      password: $('#stylistPassword').value,
      rank: $('#stylistRank').value.trim(),
      workStatus: $('#stylistWorkStatus').value,
      enabled: $('#stylistEnabled').value === '1'
    };
    if (!payload.name || !payload.username) return toast('请填写姓名和登录名');
    if (!/^1[3-9]\d{9}$/.test(payload.phone.replace(/\D/g, ''))) {
      return toast('请填写正确的11位手机号');
    }
    payload.phone = payload.phone.replace(/\D/g, '');
    if (!id && !payload.password) return toast('请填写密码');
    if (id && !payload.password) delete payload.password;
    const data = id
      ? await api(`/stylists/${id}`, { method: 'PUT', json: payload })
      : await api('/stylists', { method: 'POST', json: payload });
    if (data.success) {
      toast('已保存');
      closeStylistModal();
      if ($('#panel-stylists').hidden === false) loadStylists();
    } else {
      toast(data.message || '保存失败');
    }
  }

  async function loadAppointmentHistory() {
    const phone = $('#filterPhone').value.trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) return toast('请输入正确手机号再查历史');
    const params = new URLSearchParams({ phone });
    if ($('#filterStore').value) params.set('storeId', $('#filterStore').value);
    const data = await api(`/appointments/history?${params}`);
    if (!data.success) return toast(data.message || '查询失败');
    const rows = data.appointments || [];
    const box = $('#apptHistoryBox');
    box.hidden = false;
    $('#apptHistoryBody').innerHTML = rows.length ? rows.map((a) => `
      <tr>
        <td>${escapeHtml(a.appId)}</td>
        <td>${escapeHtml(a.storeName)}</td>
        <td>${escapeHtml(a.date)}</td>
        <td>${escapeHtml(String(a.time).split(',')[0])}</td>
        <td>${escapeHtml(a.serviceLabel)}</td>
        <td><span class="status-tag status-${a.status}">${escapeHtml(a.statusLabel)}</span></td>
      </tr>
    `).join('') : '<tr><td colspan="6" class="empty-hint">暂无历史记录</td></tr>';
  }

  function clearStoreQrcode() {
    if (storeQrcodeObjectUrl) {
      URL.revokeObjectURL(storeQrcodeObjectUrl);
      storeQrcodeObjectUrl = '';
    }
    const img = $('#storeQrcodeImg');
    if (img) img.removeAttribute('src');
    const section = $('#storeQrcodeSection');
    if (section) section.hidden = true;
  }

  async function refreshStoreQrcode(id) {
    const section = $('#storeQrcodeSection');
    const img = $('#storeQrcodeImg');
    const download = $('#storeQrcodeDownload');
    if (!id || !section || !img) {
      clearStoreQrcode();
      return;
    }
    section.hidden = false;
    img.alt = '加载中…';
    const sid = sessionId();
    try {
      const res = await fetch(`${API}/stores/${id}/qrcode`, {
        headers: sid ? { 'x-session-id': sid } : {}
      });
      if (!res.ok) {
        let msg = '生成失败';
        try {
          const err = await res.json();
          msg = err.message || msg;
        } catch (_) { /* ignore */ }
        img.alt = msg;
        toast(msg);
        return;
      }
      const blob = await res.blob();
      if (storeQrcodeObjectUrl) URL.revokeObjectURL(storeQrcodeObjectUrl);
      storeQrcodeObjectUrl = URL.createObjectURL(blob);
      img.src = storeQrcodeObjectUrl;
      img.alt = `门店 ${id} 小程序码`;
      if (download) {
        download.href = storeQrcodeObjectUrl;
        download.download = `store-${id}-qrcode.png`;
      }
    } catch (e) {
      img.alt = '生成失败';
      toast('小程序码加载失败');
    }
  }

  async function openStoreEdit(id) {
    const data = await api(`/stores/${id}`);
    if (!data.success) return toast(data.message || '加载失败');
    const s = data.store;
    $('#storeId').value = s.id;
    $('#storeName').value = s.name || '';
    $('#storeCode').value = s.code || '';
    $('#storeStatus').value = s.status || 'active';
    $('#storeAddress').value = s.address || '';
    $('#storePhone').value = s.phone || '';
    $('#storeLatitude').value = s.latitude != null ? s.latitude : '';
    $('#storeLongitude').value = s.longitude != null ? s.longitude : '';
    $('#storeWorkStart').value = (s.workStart || '11:00').slice(0, 5);
    $('#storeWorkEnd').value = (s.workEnd || '22:30').slice(0, 5);
    $('#storeInterval').value = s.slotIntervalMinutes || 30;
    $('#storeBookDays').value = s.bookAheadDays || 3;
    $('#storeDyeSlots').value = s.dyeSlotCount || 4;
    $('#storeBlocked').value = (s.defaultBlockedSlots || []).join('\n');
    $('#storeAnnouncement').value = s.announcementText || '';
    $('#storeMiniUrl').value = s.miniProgramUrl || '';
    if (s.backgroundImage || s.backgroundImagePreviewUrl) {
      setStoreBgPreview(s.backgroundImagePreviewUrl || s.backgroundImage || '');
    } else {
      resetStoreBgPreview();
    }
    updateStoreBgControls();
    refreshCustomSelect($('#storeStatus'));
    openStoreModal(`编辑 · ${s.name}`, '基本信息、预约规则与展示设置');
    refreshStoreQrcode(s.id);
  }

  function newStore() {
    clearStoreQrcode();
    $('#storeId').value = '';
    $('#storeForm').reset();
    resetStoreBgPreview();
    updateStoreBgControls();
    $('#storeWorkStart').value = '11:00';
    $('#storeWorkEnd').value = '22:30';
    $('#storeInterval').value = 30;
    $('#storeBookDays').value = 3;
    $('#storeDyeSlots').value = 4;
    $('#storeBlocked').value = '12:00-12:30\n18:00-18:30';
    $('#storeLatitude').value = '23.185396';
    $('#storeLongitude').value = '113.323372';
    refreshCustomSelect($('#storeStatus'));
    openStoreModal('新建门店', '保存后可上传背景图与生成小程序码');
  }

  async function saveStore() {
    const id = $('#storeId').value;
    const payload = {
      name: $('#storeName').value.trim(),
      code: $('#storeCode').value.trim(),
      status: $('#storeStatus').value,
      address: $('#storeAddress').value.trim(),
      phone: $('#storePhone').value.trim(),
      latitude: $('#storeLatitude').value === '' ? null : Number($('#storeLatitude').value),
      longitude: $('#storeLongitude').value === '' ? null : Number($('#storeLongitude').value),
      workStart: $('#storeWorkStart').value,
      workEnd: $('#storeWorkEnd').value,
      slotIntervalMinutes: Number($('#storeInterval').value),
      bookAheadDays: Math.min(3, Math.max(1, Number($('#storeBookDays').value) || 3)),
      dyeSlotCount: Number($('#storeDyeSlots').value),
      defaultBlockedSlots: $('#storeBlocked').value.split(/\n/).map((s) => s.trim()).filter(Boolean),
      announcementText: $('#storeAnnouncement').value.trim(),
      miniProgramUrl: $('#storeMiniUrl').value.trim()
    };
    if (!payload.name) return toast('请填写门店名称');
    if (payload.name.length > 6) return toast('门店名称最多6个字');
    if (payload.latitude == null || Number.isNaN(payload.latitude) || payload.longitude == null || Number.isNaN(payload.longitude)) {
      return toast('请填写门店经纬度（用于小程序导航）');
    }
    const data = id
      ? await api(`/stores/${id}`, { method: 'PUT', json: payload })
      : await api('/stores', { method: 'POST', json: payload });
    if (data.success) {
      toast('已保存');
      closeStoreModal();
      if ($('#panel-stores').hidden === false) loadStores();
    } else {
      toast(data.message || '保存失败');
    }
  }

  async function loadAppointments() {
    const params = new URLSearchParams();
    if ($('#filterStore').value) params.set('storeId', $('#filterStore').value);
    if ($('#filterDate').value) params.set('date', $('#filterDate').value);
    if ($('#filterPhone').value.trim()) params.set('phone', $('#filterPhone').value.trim());
    const statusFilter = $('#filterStatus').value;
    if (statusFilter === 'no_show') {
      params.set('risk', 'no_show');
    } else if (statusFilter) {
      params.set('status', statusFilter);
    }
    const data = await api(`/appointments?${params}`);
    if (!data.success) return;
    const rows = data.appointments || [];
    $('#apptTableBody').innerHTML = rows.length ? rows.map((a) => `
      <tr>
        <td>${escapeHtml(a.appId)}</td>
        <td>${escapeHtml(a.storeName)}</td>
        <td>${escapeHtml(a.stylistName)}</td>
        <td>${escapeHtml(a.date)}</td>
        <td>${escapeHtml(String(a.time).split(',')[0])}</td>
        <td>${escapeHtml(a.serviceLabel)}</td>
        <td>${escapeHtml(a.phone)}</td>
        <td><span class="status-tag status-${a.status}">${escapeHtml(a.statusLabel)}</span></td>
        <td class="action-cell">${a.status === 'booked'
    ? `<button class="btn btn-secondary btn-sm" data-complete="${a.id}">完成</button> <button class="btn btn-danger btn-sm" data-cancel="${a.id}">取消</button>`
    : ''}</td>
      </tr>
    `).join('') : '<tr><td colspan="9" class="empty-hint">暂无数据</td></tr>';

    $$('[data-cancel]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('确定取消该预约？')) return;
        const res = await api(`/appointments/${btn.dataset.cancel}/cancel`, { method: 'POST' });
        toast(res.success ? '已取消' : (res.message || '失败'));
        if (res.success) loadAppointments();
      });
    });
    $$('[data-complete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('确定标记为已完成？')) return;
        const res = await api(`/appointments/${btn.dataset.complete}/complete`, { method: 'POST' });
        toast(res.success ? '已完成' : (res.message || '失败'));
        if (res.success) loadAppointments();
      });
    });
  }

  async function loadBlacklist() {
    if (!storesCache.length) {
      const storeData = await api('/stores');
      if (storeData.success) {
        storesCache = storeData.stores || [];
        fillStoreSelects(storesCache);
      }
    }
    await loadBlacklistSuggestions();
    const data = await api('/blacklist');
    if (!data.success) return;
    const rows = data.blacklist || [];
    $('#blTableBody').innerHTML = rows.length ? rows.map((r) => `
      <tr>
        <td>${escapeHtml(r.phone)}</td>
        <td>${escapeHtml(r.scopeLabel)}</td>
        <td>${escapeHtml(r.reason || '—')}</td>
        <td>${formatDate(r.createdAt)}</td>
        <td><button class="btn btn-ghost btn-sm" data-remove-bl="${r.id}">移除</button></td>
      </tr>
    `).join('') : '<tr><td colspan="5" class="empty-hint">暂无黑名单</td></tr>';

    $$('[data-remove-bl]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('确定移除？')) return;
        const res = await api(`/blacklist/${btn.dataset.removeBl}`, { method: 'DELETE' });
        toast(res.success ? '已移除' : (res.message || '失败'));
        if (res.success) loadBlacklist();
      });
    });
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function formatDate(v) {
    if (!v) return '—';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('zh-CN', { hour12: false });
  }

  async function handleLogin(e) {
    if (e) e.preventDefault();
    const err = $('#loginError');
    const btn = $('#loginBtn');
    if (!err || !btn) return;
    err.hidden = true;
    btn.disabled = true;
    const prevText = btn.textContent;
    btn.textContent = '登录中…';
    try {
      const data = await api('/auth/login', {
        method: 'POST',
        json: {
          username: $('#loginUser').value.trim(),
          password: $('#loginPass').value
        }
      });
      if (data.success) {
        setSession(data.sessionId);
        showMain();
        setRoute('dashboard');
        toast('登录成功');
      } else {
        err.textContent = data.message || '登录失败';
        err.hidden = false;
      }
    } catch (ex) {
      err.textContent = ex.message || '网络错误';
      err.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = prevText;
    }
  }

  function bindEvents() {
    const loginForm = $('#loginForm');
    if (loginForm) loginForm.addEventListener('submit', handleLogin);

    const logoutBtn = $('#logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        setSession('');
        showLogin();
      });
    }

    $$('.nav-item').forEach((btn) => {
      btn.addEventListener('click', () => setRoute(btn.dataset.route));
    });

    const btnNewStore = $('#btnNewStore');
    if (btnNewStore) btnNewStore.addEventListener('click', newStore);
    const btnSaveStore = $('#btnSaveStore');
    if (btnSaveStore) btnSaveStore.addEventListener('click', saveStore);
    const storeEditClose = $('#storeEditClose');
    if (storeEditClose) storeEditClose.addEventListener('click', closeStoreModal);
    const storeEditBackdrop = $('#storeEditBackdrop');
    if (storeEditBackdrop) storeEditBackdrop.addEventListener('click', closeStoreModal);
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if ($('#storeEditModal') && !$('#storeEditModal').hidden) closeStoreModal();
      else if ($('#stylistEditModal') && !$('#stylistEditModal').hidden) closeStylistModal();
    });
    document.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('.custom-select')) return;
      closeAllCustomSelects();
    });
    window.addEventListener('resize', closeAllCustomSelects);
    window.addEventListener('scroll', (e) => {
      if (e.target && e.target.closest && e.target.closest('.custom-select-menu')) return;
      $$('.custom-select.is-open').forEach((wrap) => {
        const trigger = wrap.querySelector('.custom-select-trigger');
        const menu = wrap._customMenu;
        if (trigger && menu && !menu.hidden) positionCustomSelectMenu(trigger, menu);
      });
    }, true);
    const btnRefreshQrcode = $('#btnRefreshQrcode');
    if (btnRefreshQrcode) {
      btnRefreshQrcode.addEventListener('click', () => {
        const id = $('#storeId').value;
        if (id) refreshStoreQrcode(id);
      });
    }
    const btnSearchAppt = $('#btnSearchAppt');
    if (btnSearchAppt) btnSearchAppt.addEventListener('click', () => {
      $('#apptHistoryBox').hidden = true;
      loadAppointments();
    });
    const btnHistoryAppt = $('#btnHistoryAppt');
    if (btnHistoryAppt) btnHistoryAppt.addEventListener('click', loadAppointmentHistory);
    const btnExportAppt = $('#btnExportAppt');
    if (btnExportAppt) btnExportAppt.addEventListener('click', exportAppointments);
    const btnLoadReport = $('#btnLoadReport');
    if (btnLoadReport) btnLoadReport.addEventListener('click', fetchReport);
    const btnLoadAudit = $('#btnLoadAudit');
    if (btnLoadAudit) btnLoadAudit.addEventListener('click', fetchAuditLogs);
    const btnRefreshBlSuggest = $('#btnRefreshBlSuggest');
    if (btnRefreshBlSuggest) btnRefreshBlSuggest.addEventListener('click', loadBlacklistSuggestions);
    const btnRefreshSms = $('#btnRefreshSms');
    if (btnRefreshSms) btnRefreshSms.addEventListener('click', loadSmsStatus);
    const blSuggestStore = $('#blSuggestStore');
    if (blSuggestStore) blSuggestStore.addEventListener('change', loadBlacklistSuggestions);
    const stylistFilterStore = $('#stylistFilterStore');
    if (stylistFilterStore) stylistFilterStore.addEventListener('change', loadStylists);
    const btnNewStylist = $('#btnNewStylist');
    if (btnNewStylist) btnNewStylist.addEventListener('click', newStylist);
    const btnSaveStylist = $('#btnSaveStylist');
    if (btnSaveStylist) btnSaveStylist.addEventListener('click', saveStylist);
    const stylistEditClose = $('#stylistEditClose');
    if (stylistEditClose) stylistEditClose.addEventListener('click', closeStylistModal);
    const stylistEditBackdrop = $('#stylistEditBackdrop');
    if (stylistEditBackdrop) stylistEditBackdrop.addEventListener('click', closeStylistModal);

    const btnPickStylistAvatar = $('#btnPickStylistAvatar');
    const btnResetStylistAvatar = $('#btnResetStylistAvatar');
    const stylistAvatarInput = $('#stylistAvatarInput');
    if (btnPickStylistAvatar && stylistAvatarInput) {
      btnPickStylistAvatar.addEventListener('click', () => {
        if (!$('#stylistId').value) return toast('请先保存发型师后再上传头像');
        stylistAvatarInput.click();
      });
      stylistAvatarInput.addEventListener('change', () => {
        const file = stylistAvatarInput.files && stylistAvatarInput.files[0];
        stylistAvatarInput.value = '';
        if (!file) return;
        if (!/^image\/(jpeg|jpg|png|webp)$/i.test(file.type)) {
          return toast('请选择 JPG、PNG 或 WebP 图片');
        }
        if (file.size > 5 * 1024 * 1024) return toast('图片不能超过 5MB');
        openAvatarCropModal(file);
      });
    }
    if (btnResetStylistAvatar) {
      btnResetStylistAvatar.addEventListener('click', restoreStylistAvatarDefault);
    }
    const avatarCropClose = $('#avatarCropClose');
    const avatarCropBackdrop = $('#avatarCropBackdrop');
    const avatarCropConfirm = $('#avatarCropConfirm');
    [avatarCropClose, avatarCropBackdrop].forEach((el) => {
      if (el) el.addEventListener('click', closeAvatarCropModal);
    });
    if (avatarCropConfirm) {
      avatarCropConfirm.addEventListener('click', async () => {
        const stylistId = $('#stylistId').value;
        if (!stylistId) return toast('请先保存发型师');
        if (!avatarCropper) return toast('请先选择图片');
        let imageBase64 = '';
        try {
          imageBase64 = getCircularCroppedBase64(avatarCropper);
        } catch (err) {
          return toast((err && err.message) || '裁剪失败，请重试');
        }
        avatarCropConfirm.disabled = true;
        try {
          const data = await uploadStylistAvatarImage(stylistId, imageBase64);
          if (!data.success) return toast(data.message || '上传失败');
          closeAvatarCropModal();
          setStylistAvatarPreview(imageBase64);
          toast('头像已上传');
          refreshStylistAvatarPreview(stylistId, imageBase64);
          if ($('#panel-stylists').hidden === false) loadStylists();
        } catch (_) {
          toast('上传失败');
        } finally {
          avatarCropConfirm.disabled = false;
        }
      });
    }

    const btnPickStoreBg = $('#btnPickStoreBg');
    const storeBgInput = $('#storeBgInput');
    if (btnPickStoreBg && storeBgInput) {
      btnPickStoreBg.addEventListener('click', () => {
        if (!$('#storeId').value) return toast('请先保存门店后再上传背景图');
        storeBgInput.click();
      });
      storeBgInput.addEventListener('change', () => {
        const file = storeBgInput.files && storeBgInput.files[0];
        storeBgInput.value = '';
        if (!file) return;
        if (!$('#storeId').value) return toast('请先保存门店后再上传背景图');
        if (!/^image\/(jpeg|jpg|png|webp)$/i.test(file.type)) {
          return toast('请选择 JPG、PNG 或 WebP 图片');
        }
        if (file.size > 5 * 1024 * 1024) return toast('图片不能超过 5MB');
        openStoreBgCropModal(file);
      });
    }
    const storeBgCropClose = $('#storeBgCropClose');
    const storeBgCropBackdrop = $('#storeBgCropBackdrop');
    const storeBgCropConfirm = $('#storeBgCropConfirm');
    [storeBgCropClose, storeBgCropBackdrop].forEach((el) => {
      if (el) el.addEventListener('click', closeStoreBgCropModal);
    });
    if (storeBgCropConfirm) {
      storeBgCropConfirm.addEventListener('click', async () => {
        const storeId = $('#storeId').value;
        if (!storeId) return toast('请先保存门店后再上传背景图');
        if (!storeBgCropper) return toast('请先选择图片');
        let imageBase64 = '';
        try {
          imageBase64 = getStoreBgCroppedBase64(storeBgCropper);
        } catch (err) {
          return toast((err && err.message) || '裁剪失败，请重试');
        }
        storeBgCropConfirm.disabled = true;
        try {
          const data = await uploadStoreBackgroundImage(storeId, imageBase64);
          if (!data.success) return toast(data.message || '上传失败');
          closeStoreBgCropModal();
          setStoreBgPreview(imageBase64);
          toast('背景图已上传');
          refreshStoreBgPreview(storeId, imageBase64);
        } catch (_) {
          toast('上传失败');
        } finally {
          storeBgCropConfirm.disabled = false;
        }
      });
    }

    const todayPill = $('#todayPill');
    if (todayPill) todayPill.textContent = todayStr();
    const filterDate = $('#filterDate');
    if (filterDate) filterDate.value = todayStr();

    const blacklistForm = $('#blacklistForm');
    if (blacklistForm) {
      blacklistForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = await api('/blacklist', {
          method: 'POST',
          json: {
            phone: $('#blPhone').value.trim(),
            storeId: $('#blStore').value,
            reason: $('#blReason').value.trim()
          }
        });
        if (data.success) {
          toast('已添加');
          $('#blPhone').value = '';
          $('#blReason').value = '';
          loadBlacklist();
        } else {
          toast(data.message || '添加失败');
        }
      });
    }
  }

  async function boot() {
    const initialSid = sessionId();
    if (!initialSid) {
      showLogin();
      return;
    }
    try {
      const v = await api('/auth/verify');
      if (sessionId() !== initialSid) return;
      if (v.valid) {
        showMain();
        setRoute('dashboard');
      } else {
        setSession('');
        showLogin();
      }
    } catch (_) {
      if (sessionId() === initialSid) {
        setSession('');
        showLogin();
      }
    }
  }

  try {
    bindEvents();
    initCustomSelects();
    initCustomDateInputs();
    boot();
  } catch (ex) {
    console.error('[platform] init failed', ex);
    toast('页面初始化失败，请刷新重试');
  }
})();
