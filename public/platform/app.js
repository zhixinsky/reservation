(function () {
  const SESSION_KEY = 'platform_session_id';
  const API = '/api/platform';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  let storesCache = [];
  let storeQrcodeObjectUrl = '';

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

  function setRoute(route) {
    $$('.nav-item').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.route === route);
    });
    const titles = {
      dashboard: '概览',
      stores: '门店管理',
      'store-edit': '编辑门店',
      stylists: '发型师管理',
      'stylist-edit': '编辑发型师',
      reports: '跨店报表',
      appointments: '预约总览',
      blacklist: '用户黑名单',
      audit: '操作审计'
    };
    $('#pageTitle').textContent = titles[route] || '平台管理';

    $('#panel-dashboard').hidden = route !== 'dashboard';
    $('#panel-stores').hidden = route !== 'stores';
    $('#panel-store-edit').hidden = route !== 'store-edit';
    $('#panel-stylists').hidden = route !== 'stylists';
    $('#panel-stylist-edit').hidden = route !== 'stylist-edit';
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

  async function syncStoresToCloud() {
    if (!confirm('将当前全部门店与黑名单同步到云开发数据库？')) return;
    const data = await api('/cloud/sync-stores', { method: 'POST' });
    if (data.success) {
      toast(data.message || '同步成功');
    } else {
      toast(data.message || '同步失败');
    }
  }

  async function loadStores() {
    const data = await api('/stores');
    if (!data.success) return;
    storesCache = data.stores || [];
    fillStoreSelects(storesCache);
    $('#storeList').innerHTML = storesCache.map((s) => `
      <div class="store-card glass" data-id="${s.id}">
        <div>
          <h4>${escapeHtml(s.name)}</h4>
          <p>${s.latitude != null && s.longitude != null ? `${s.latitude}, ${s.longitude}` : '未配置坐标'} · ${s.workStart}–${s.workEnd}</p>
        </div>
        <div class="store-card-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-dup-store="${s.id}">复制</button>
          <span class="badge ${s.status === 'active' ? 'badge-active' : 'badge-disabled'}">${s.status === 'active' ? '营业中' : '已停用'}</span>
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
    const fromEl = $('#auditFrom');
    const toEl = $('#auditTo');
    if (fromEl && !fromEl.value) {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      const p = (n) => String(n).padStart(2, '0');
      fromEl.value = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }
    if (toEl && !toEl.value) toEl.value = todayStr();
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
    const params = new URLSearchParams();
    if ($('#stylistFilterStore').value) params.set('storeId', $('#stylistFilterStore').value);
    const data = await api(`/stylists?${params}`);
    if (!data.success) return;
    const rows = data.stylists || [];
    $('#stylistList').innerHTML = rows.length ? rows.map((s) => `
      <div class="store-card glass" data-stylist-id="${s.id}">
        <div>
          <h4>${escapeHtml(s.name)} <span class="badge ${s.enabled ? 'badge-active' : 'badge-disabled'}">${s.enabled ? '启用' : '停用'}</span></h4>
          <p>${escapeHtml(s.storeName)} · ${escapeHtml(s.phone || '未填手机号')} · 登录名 ${escapeHtml(s.username)}</p>
        </div>
        <span class="badge badge-active">${s.workStatus === 'resting' ? '休息' : '工作'}</span>
      </div>
    `).join('') : '<div class="empty-hint glass card">暂无发型师，点击「新建发型师」</div>';

    $$('[data-stylist-id]').forEach((card) => {
      card.addEventListener('click', () => openStylistEdit(card.dataset.stylistId));
    });
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
    setRoute('stylist-edit');
    $('#panel-stylist-edit').hidden = false;
    $('#pageTitle').textContent = `编辑 · ${s.name}`;
  }

  function newStylist() {
    $('#stylistId').value = '';
    $('#stylistForm').reset();
    $('#stylistWorkStatus').value = 'working';
    $('#stylistEnabled').value = '1';
    $('#stylistPassword').required = true;
    if (storesCache[0]) $('#stylistStore').value = storesCache[0].id;
    setRoute('stylist-edit');
    $('#panel-stylist-edit').hidden = false;
    $('#pageTitle').textContent = '新建发型师';
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
      setRoute('stylists');
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
    setRoute('store-edit');
    $('#panel-store-edit').hidden = false;
    $('#pageTitle').textContent = `编辑 · ${s.name}`;
    refreshStoreQrcode(s.id);
  }

  function newStore() {
    clearStoreQrcode();
    $('#storeId').value = '';
    $('#storeForm').reset();
    $('#storeWorkStart').value = '11:00';
    $('#storeWorkEnd').value = '22:30';
    $('#storeInterval').value = 30;
    $('#storeBookDays').value = 3;
    $('#storeDyeSlots').value = 4;
    $('#storeBlocked').value = '12:00-12:30\n18:00-18:30';
    $('#storeLatitude').value = '23.185396';
    $('#storeLongitude').value = '113.323372';
    setRoute('store-edit');
    $('#panel-store-edit').hidden = false;
    $('#pageTitle').textContent = '新建门店';
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
      setRoute('stores');
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
    const btnSyncCloud = $('#btnSyncCloud');
    if (btnSyncCloud) btnSyncCloud.addEventListener('click', syncStoresToCloud);
    const btnBackStores = $('#btnBackStores');
    if (btnBackStores) btnBackStores.addEventListener('click', () => setRoute('stores'));
    const btnSaveStore = $('#btnSaveStore');
    if (btnSaveStore) btnSaveStore.addEventListener('click', saveStore);
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
    const btnBackStylists = $('#btnBackStylists');
    if (btnBackStylists) btnBackStylists.addEventListener('click', () => setRoute('stylists'));
    const btnSaveStylist = $('#btnSaveStylist');
    if (btnSaveStylist) btnSaveStylist.addEventListener('click', saveStylist);

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
    boot();
  } catch (ex) {
    console.error('[platform] init failed', ex);
    toast('页面初始化失败，请刷新重试');
  }
})();
