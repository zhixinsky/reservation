const { callApi } = require('../../utils/api');

function pad2(n) {
  return String(n).padStart(2, '0');
}

function ymd(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 截止日当天仍有效，次日 0 点起视为过期不再展示 */
function filterActiveVacationRanges(ranges) {
  const today = ymd(0);
  return (Array.isArray(ranges) ? ranges : []).filter(
    r => r && r.vacationStartDate && r.vacationEndDate && r.vacationEndDate >= today
  );
}

function dateText(ymdStr) {
  const parts = String(ymdStr || '').split('-');
  return parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : ymdStr;
}

function formatTimeDisplay(timeStr) {
  if (!timeStr) return '';
  return String(timeStr).split(',')[0].trim().split('-')[0] || timeStr;
}

function parseTimeParts(timeStr) {
  const display = formatTimeDisplay(timeStr);
  const parts = display.split(':');
  return {
    timeDisplay: display,
    timeHour: parts[0] || display,
    timeMinute: parts[1] != null ? parts[1] : ''
  };
}

function timeToMinutes(time) {
  const [h, m] = String(time || '').split(':').map(Number);
  return h * 60 + m;
}

function findSlotAppointment(appointments, selectedDate, slotTime) {
  const list = Array.isArray(appointments) ? appointments : [];
  return list.find(app => {
    if (app.date !== selectedDate || app.status === 'cancelled') return false;
    if (app.time === slotTime) return true;
    if (Array.isArray(app.originalTimeSlots) && app.originalTimeSlots.includes(slotTime)) return true;
    if (Array.isArray(app.originalTimeSlots)) return false;
    try {
      const [appStart, appEnd] = String(app.time || '').split('-');
      const [slotStart, slotEnd] = String(slotTime || '').split('-');
      if (!appStart || !appEnd || !slotStart || !slotEnd) return false;
      const appStartMin = timeToMinutes(appStart);
      const appEndMin = timeToMinutes(appEnd);
      const slotStartMin = timeToMinutes(slotStart);
      const slotEndMin = timeToMinutes(slotEnd);
      return slotStartMin >= appStartMin && slotEndMin <= appEndMin;
    } catch (e) {
      return false;
    }
  });
}

function buildAdminSlotItem(slot, selectedDate, blockedList, appointments) {
  if (!slot || !slot.time) return null;

  const [startTime, endTime] = slot.time.split('-');
  const startTotalMinutes = timeToMinutes(startTime);
  const endTotalMinutes = timeToMinutes(endTime);
  const todayStr = ymd(0);
  const isToday = selectedDate === todayStr;
  const now = new Date();
  const currentTotalMinutes = now.getHours() * 60 + now.getMinutes();
  const blocked = Array.isArray(blockedList) ? blockedList : [];
  const appointment = findSlotAppointment(appointments, selectedDate, slot.time);
  const isBlocked = blocked.some(item => item.time === slot.time);
  const isDefaultMealTime = slot.time === '12:00-12:30' || slot.time === '18:00-18:30';
  const isUnlocked = blocked.some(item => item.time === `${slot.time}_UNLOCKED`);
  const isDefaultBlocked = isDefaultMealTime && !appointment && !isBlocked && !isUnlocked;

  let adminText = '';
  let adminClass = 'default';
  let canToggle = false;

  if (appointment && appointment.status === 'completed') {
    adminText = '已完成';
    adminClass = 'completed';
  } else if (appointment && appointment.status === 'booked') {
    adminText = '已预约';
    adminClass = 'booked';
  } else if (isBlocked || isDefaultBlocked) {
    adminText = '已锁定';
    adminClass = 'blocked';
    canToggle = true;
  } else if (isToday) {
    const isCurrentTimeInSlot = currentTotalMinutes >= startTotalMinutes && currentTotalMinutes <= endTotalMinutes;
    if (isCurrentTimeInSlot) {
      if (currentTotalMinutes - startTotalMinutes <= 10) {
        adminText = '可预约';
        adminClass = 'available';
        canToggle = true;
      } else {
        adminText = 'Expired';
        adminClass = 'expired';
      }
    } else if (currentTotalMinutes > endTotalMinutes) {
      adminText = 'Expired';
      adminClass = 'expired';
    } else {
      adminText = '可预约';
      adminClass = 'available';
      canToggle = true;
    }
  } else {
    adminText = '可预约';
    adminClass = 'available';
    canToggle = true;
  }

  return {
    ...slot,
    displayTime: formatTimeDisplay(slot.time),
    adminText,
    adminClass,
    canToggle
  };
}

function canCompleteAppointment(app) {
  if (!app || app.status === 'cancelled' || app.status === 'completed') return false;
  if (app.date !== ymd(0)) return false;
  const [startTime] = String(app.time || '').split('-');
  if (!startTime) return false;
  const [startHour, startMin] = startTime.split(':').map(Number);
  const now = new Date();
  const currentTotalMinutes = now.getHours() * 60 + now.getMinutes();
  return currentTotalMinutes > startHour * 60 + startMin;
}

function statusText(status) {
  if (status === 'completed') return '已完成';
  if (status === 'cancelled') return '已取消';
  return '待履约';
}

Page({
  data: {
    session: null,
    appointments: [],
    filteredAppointments: [],
    filters: [
      { key: 'today', label: '今天', count: 0 },
      { key: 'tomorrow', label: '明天', count: 0 },
      { key: 'dayAfterTomorrow', label: '后天', count: 0 },
      { key: 'completed', label: '已完成', count: 0 }
    ],
    currentFilter: 'today',
    stats: { pending: 0, completed: 0, all: 0 },
    slotDateOptions: [
      { key: 'today', label: '今天', date: ymd(0) },
      { key: 'tomorrow', label: '明天', date: ymd(1) },
      { key: 'dayAfterTomorrow', label: '后天', date: ymd(2) }
    ],
    slotDateIndex: 0,
    selectedSlotDateLabel: '今天',
    slotDateMenuVisible: false,
    slotItems: [],
    modalMask: false,
    vacationVisible: false,
    announcementVisible: false,
    today: ymd(0),
    vacationStartDate: ymd(0),
    vacationEndDate: ymd(1),
    vacationRanges: [],
    vacationError: '',
    announcementText: '',
    announcementError: ''
  },

  redirectToMyForAdmin() {
    wx.showToast({ title: '请在我的页使用管理员手机号登录', icon: 'none' });
    wx.switchTab({ url: '/pages/my/my' });
  },

  onLoad() {
    const session = wx.getStorageSync('admin_session');
    if (!session || !session.sessionId || session.role !== 'stylist') {
      this.redirectToMyForAdmin();
      return;
    }
    this.setData({ session });
    this.verifyAndLoad();
  },

  onShow() {
    if (this.data.session) {
      this.loadAll({ showLoading: false });
      this.startAutoRefresh();
    }
  },

  onHide() {
    this.stopAutoRefresh();
  },

  onUnload() {
    this.stopAutoRefresh();
  },

  callApi(action, payload = {}) {
    return callApi(action, {
      ...payload,
      sessionId: this.data.session && this.data.session.sessionId
    });
  },

  async verifyAndLoad() {
    const data = await this.callApi('verifySession').catch(() => ({ valid: false }));
    if (!data || !data.valid) {
      wx.removeStorageSync('admin_session');
      this.redirectToMyForAdmin();
      return;
    }
    this.loadAll();
    this.startAutoRefresh();
  },

  loadAll(options = {}) {
    return this.loadAppointments({ showLoading: options.showLoading !== false, refreshSlots: true });
  },

  async loadAppointments(options = {}) {
    const { showLoading = true, refreshSlots = true } = options;
    if (showLoading) wx.showLoading({ title: '加载中' });
    try {
      const rows = await this.callApi('getAdminAppointments');
      const appointments = (Array.isArray(rows) ? rows : []).map(app => {
        const timeParts = parseTimeParts(app.time);
        return {
          ...app,
          dateText: dateText(app.date),
          timeDisplay: timeParts.timeDisplay,
          timeHour: timeParts.timeHour,
          timeMinute: timeParts.timeMinute,
          serviceTypeText: app.serviceType === 'dye' ? '烫染' : '剪发',
          phoneLast4: app.phone ? String(app.phone).slice(-4) : '',
          statusText: statusText(app.status),
          canOperate: app.status !== 'cancelled' && app.status !== 'completed',
          canComplete: canCompleteAppointment(app),
          hasNewUserTag: app.isNewUser !== undefined && app.isNewUser !== null
        };
      });
      this.setData({
        appointments,
        filters: this.buildFilterCounts(appointments),
        stats: {
          pending: appointments.filter(a => a.status !== 'cancelled' && a.status !== 'completed').length,
          completed: appointments.filter(a => a.status === 'completed').length,
          all: appointments.filter(a => a.status !== 'cancelled').length
        }
      });
      this.applyFilter();
      if (refreshSlots) {
        await this.loadTimeSlots(appointments);
      }
    } finally {
      if (showLoading) wx.hideLoading();
    }
  },

  buildFilterCounts(appointments) {
    const list = Array.isArray(appointments) ? appointments : [];
    const todayStr = ymd(0);
    const tomorrowStr = ymd(1);
    const dayAfterTomorrowStr = ymd(2);
    const activeOnDate = date => list.filter(a => a.date === date && a.status !== 'cancelled' && a.status !== 'completed').length;
    return [
      { key: 'today', label: '今天', count: activeOnDate(todayStr) },
      { key: 'tomorrow', label: '明天', count: activeOnDate(tomorrowStr) },
      { key: 'dayAfterTomorrow', label: '后天', count: activeOnDate(dayAfterTomorrowStr) },
      { key: 'completed', label: '已完成', count: list.filter(a => a.date === todayStr && a.status === 'completed').length }
    ];
  },

  startAutoRefresh() {
    this.stopAutoRefresh();
    this._autoRefreshTimer = setInterval(() => {
      this.autoRefresh();
    }, 15000);
  },

  stopAutoRefresh() {
    if (this._autoRefreshTimer) {
      clearInterval(this._autoRefreshTimer);
      this._autoRefreshTimer = null;
    }
  },

  async autoRefresh() {
    if (!this.data.session || this._autoRefreshing || this.data.modalMask) return;
    this._autoRefreshing = true;
    try {
      await this.loadAll({ showLoading: false });
    } catch (e) {
      console.warn('后台自动刷新失败:', e && e.message);
    } finally {
      this._autoRefreshing = false;
    }
  },

  setFilter(e) {
    this.setData({ currentFilter: e.currentTarget.dataset.key });
    this.applyFilter();
  },

  applyFilter() {
    const targetMap = {
      today: ymd(0),
      tomorrow: ymd(1),
      dayAfterTomorrow: ymd(2)
    };
    let filtered = [];
    if (this.data.currentFilter === 'completed') {
      filtered = this.data.appointments.filter(a => a.date === ymd(0) && a.status === 'completed');
    } else {
      const targetDate = targetMap[this.data.currentFilter];
      filtered = this.data.appointments.filter(a => a.date === targetDate && a.status !== 'cancelled' && a.status !== 'completed');
    }
    if (this.data.currentFilter === 'completed') {
      filtered.sort((a, b) => formatTimeDisplay(b.time).localeCompare(formatTimeDisplay(a.time)));
    } else {
      filtered.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return formatTimeDisplay(a.time).localeCompare(formatTimeDisplay(b.time));
      });
    }
    this.setData({ filteredAppointments: filtered }, () => {
      this.updateTimelineSegments();
    });
  },

  updateTimelineSegments() {
    const list = this.data.filteredAppointments || [];
    if (!list.length) return;

    wx.nextTick(() => {
      const query = this.createSelectorQuery();
      query.selectAll('.timeline-item').boundingClientRect();
      query.selectAll('.timeline-dot').boundingClientRect();
      query.exec(res => {
        const items = (res && res[0]) || [];
        const dots = (res && res[1]) || [];
        if (!items.length) return;

        const { windowWidth } = wx.getSystemInfoSync();
        const lineWidthPx = Math.max(1, Math.round((2 / 750) * windowWidth));
        const gapBelowDotPx = Math.round((4 / 750) * windowWidth);
        const updates = {};

        items.forEach((itemRect, index) => {
          if (index >= list.length) return;
          const dotRect = dots[index];
          if (!dotRect) return;

          const segmentTop = Math.round(dotRect.top + dotRect.height - itemRect.top + gapBelowDotPx);
          const segmentLeft = Math.round(dotRect.left + dotRect.width / 2 - itemRect.left - lineWidthPx / 2);
          const segmentHeight = Math.round(itemRect.height - segmentTop);

          if (segmentHeight <= 0) return;

          const current = list[index] || {};
          if (current.segmentHeight !== segmentHeight) {
            updates[`filteredAppointments[${index}].segmentHeight`] = segmentHeight;
          }
          if (current.segmentTop !== segmentTop) {
            updates[`filteredAppointments[${index}].segmentTop`] = segmentTop;
          }
          if (current.segmentLeft !== segmentLeft) {
            updates[`filteredAppointments[${index}].segmentLeft`] = segmentLeft;
          }
        });

        if (Object.keys(updates).length) {
          this.setData(updates);
        }
      });
    });
  },

  contactCustomer(e) {
    const phone = e.currentTarget.dataset.phone;
    if (!phone) return;
    wx.makePhoneCall({
      phoneNumber: String(phone),
      fail: () => {
        wx.setClipboardData({
          data: String(phone),
          success: () => wx.showToast({ title: '电话已复制', icon: 'none' })
        });
      }
    });
  },

  async completeAppointment(e) {
    const enabled = e.currentTarget.dataset.enabled === true || e.currentTarget.dataset.enabled === 'true';
    if (!enabled) return;
    const appointmentId = e.currentTarget.dataset.id;
    wx.showModal({
      title: '确认完成',
      content: '确认已完成该预约服务？',
      success: async res => {
        if (!res.confirm) return;
        const data = await this.callApi('completeAppointment', { appointmentId });
        wx.showToast({ title: data && data.success ? '已完成' : ((data && data.message) || '操作失败'), icon: data && data.success ? 'success' : 'none' });
        if (data && data.success) this.loadAppointments();
      }
    });
  },

  adminCancel(e) {
    const appointmentId = e.currentTarget.dataset.id;
    wx.showModal({
      title: '确认取消',
      content: '确定取消该预约吗？',
      success: async res => {
        if (!res.confirm) return;
        const data = await this.callApi('adminCancelAppointment', { appointmentId });
        wx.showToast({ title: data && data.success ? '已取消' : ((data && data.message) || '操作失败'), icon: data && data.success ? 'success' : 'none' });
        if (data && data.success) {
          this.loadAppointments();
        }
      }
    });
  },

  toggleSlotDateMenu() {
    this.setData({ slotDateMenuVisible: !this.data.slotDateMenuVisible });
  },

  closeSlotDateMenu() {
    if (this.data.slotDateMenuVisible) {
      this.setData({ slotDateMenuVisible: false });
    }
  },

  selectSlotDate(e) {
    const slotDateIndex = Number(e.currentTarget.dataset.index);
    const option = this.data.slotDateOptions[slotDateIndex];
    if (!option) return;
    this.setData({
      slotDateIndex,
      selectedSlotDateLabel: option.label,
      slotDateMenuVisible: false
    });
    this.loadTimeSlots();
  },

  async loadTimeSlots(appointmentsOverride) {
    const session = this.data.session;
    if (!session) return;
    const option = this.data.slotDateOptions[this.data.slotDateIndex];
    if (!option) return;
    const date = option.date;
    const appointments = Array.isArray(appointmentsOverride) ? appointmentsOverride : this.data.appointments;
    const slots = await this.callApi('getSlots', { stylistId: session.stylistId, date });
    const blocked = await this.callApi('getAdminBlockedSlots', { stylistId: session.stylistId, date });
    const blockedList = Array.isArray(blocked) ? blocked : [];
    const slotItems = (Array.isArray(slots) ? slots : [])
      .map(slot => buildAdminSlotItem(slot, date, blockedList, appointments))
      .filter(Boolean);
    this.setData({ slotItems });
  },

  async toggleSlot(e) {
    const canToggle = e.currentTarget.dataset.canToggle === true || e.currentTarget.dataset.canToggle === 'true';
    if (!canToggle) return;
    const time = e.currentTarget.dataset.time;
    const option = this.data.slotDateOptions[this.data.slotDateIndex];
    const item = this.data.slotItems.find(s => s.time === time);
    if (!item || !item.canToggle) return;
    const action = item.adminClass === 'blocked' ? 'adminUnblockSlot' : 'adminBlockSlot';
    const data = await this.callApi(action, {
      stylistId: this.data.session.stylistId,
      date: option.date,
      time
    });
    wx.showToast({ title: data && data.success ? '已更新' : '操作失败', icon: data && data.success ? 'success' : 'none' });
    this.loadTimeSlots();
  },

  async openVacationModal() {
    const info = await this.callApi('getStylistInfo');
    const raw = Array.isArray(info.vacationRanges) ? info.vacationRanges : [];
    let active = filterActiveVacationRanges(raw);
    if (active.length !== raw.length) {
      const data = await this.callApi('saveStylistVacation', { vacationRanges: active });
      if (data && data.success) {
        active = filterActiveVacationRanges(data.vacationRanges || active);
        this.loadTimeSlots();
      }
    }
    this.setData({
      modalMask: true,
      vacationVisible: true,
      vacationRanges: active,
      vacationStartDate: ymd(0),
      vacationEndDate: ymd(1),
      vacationError: ''
    });
  },

  onVacationStartChange(e) {
    this.setData({ vacationStartDate: e.detail.value, vacationError: '' });
  },

  onVacationEndChange(e) {
    this.setData({ vacationEndDate: e.detail.value, vacationError: '' });
  },

  async saveVacation() {
    const start = this.data.vacationStartDate;
    const end = this.data.vacationEndDate;
    if (!start || !end || start > end) {
      this.setData({ vacationError: '请选择正确的休假日期' });
      return;
    }
    const exists = this.data.vacationRanges.some(r => r.vacationStartDate === start && r.vacationEndDate === end);
    const next = exists ? this.data.vacationRanges : [...this.data.vacationRanges, { vacationStartDate: start, vacationEndDate: end }];
    const data = await this.callApi('saveStylistVacation', { vacationRanges: next });
    if (data && data.success) {
      wx.showToast({ title: '已保存' });
      this.setData({ vacationRanges: filterActiveVacationRanges(data.vacationRanges || next), vacationError: '' });
      this.loadTimeSlots();
    } else {
      this.setData({ vacationError: (data && data.message) || '保存失败' });
    }
  },

  async removeVacationRange(e) {
    const index = Number(e.currentTarget.dataset.index);
    const next = this.data.vacationRanges.filter((_, i) => i !== index);
    const data = await this.callApi('saveStylistVacation', { vacationRanges: next });
    if (data && data.success) {
      this.setData({ vacationRanges: filterActiveVacationRanges(data.vacationRanges || next) });
      this.loadTimeSlots();
    }
  },

  async clearVacation() {
    const data = await this.callApi('saveStylistVacation', { vacationRanges: [] });
    if (data && data.success) {
      this.setData({ vacationRanges: [] });
      wx.showToast({ title: '已清空' });
      this.loadTimeSlots();
    }
  },

  async openAnnouncementModal() {
    const data = await this.callApi('getAdminAnnouncement');
    this.setData({
      modalMask: true,
      announcementVisible: true,
      announcementText: data && data.text ? data.text : '',
      announcementError: ''
    });
  },

  onAnnouncementInput(e) {
    this.setData({ announcementText: e.detail.value, announcementError: '' });
  },

  async saveAnnouncement() {
    const data = await this.callApi('saveAnnouncement', { text: this.data.announcementText || '' });
    if (data && data.success) {
      wx.showToast({ title: '已保存' });
      this.closeModals();
    } else {
      this.setData({ announcementError: (data && data.message) || '保存失败' });
    }
  },

  closeModals() {
    this.setData({
      modalMask: false,
      vacationVisible: false,
      announcementVisible: false,
      vacationError: '',
      announcementError: ''
    });
  },

  goHome() {
    wx.navigateBack({ delta: 99 });
  }
});
