const { callApi } = require('../../utils/api');

function pad2(n) {
  return String(n).padStart(2, '0');
}

function ymd(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function dateText(ymdStr) {
  const parts = String(ymdStr || '').split('-');
  return parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : ymdStr;
}

function formatTimeDisplay(timeStr) {
  if (!timeStr) return '';
  return String(timeStr).split(',')[0].trim().split('-')[0] || timeStr;
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
      { key: 'today', label: '今天' },
      { key: 'tomorrow', label: '明天' },
      { key: 'dayAfterTomorrow', label: '后天' },
      { key: 'completed', label: '已完成' }
    ],
    currentFilter: 'today',
    stats: { pending: 0, completed: 0, all: 0 },
    lastUpdateTime: '',
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

  onLoad() {
    const session = wx.getStorageSync('admin_session');
    if (!session || !session.sessionId || session.role !== 'stylist') {
      wx.redirectTo({ url: '/pages/admin-login/admin-login' });
      return;
    }
    this.setData({ session });
    this.verifyAndLoad();
  },

  onShow() {
    if (this.data.session) this.loadAll();
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
      wx.redirectTo({ url: '/pages/admin-login/admin-login' });
      return;
    }
    this.loadAll();
  },

  loadAll() {
    this.loadAppointments();
    this.loadTimeSlots();
  },

  async loadAppointments() {
    wx.showLoading({ title: '加载中' });
    try {
      const rows = await this.callApi('getAdminAppointments');
      const appointments = (Array.isArray(rows) ? rows : []).map(app => {
        return {
          ...app,
          dateText: dateText(app.date),
          timeDisplay: formatTimeDisplay(app.time),
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
        lastUpdateTime: this.currentHm(),
        stats: {
          pending: appointments.filter(a => a.status !== 'cancelled' && a.status !== 'completed').length,
          completed: appointments.filter(a => a.status === 'completed').length,
          all: appointments.length
        }
      });
      this.applyFilter();
    } finally {
      wx.hideLoading();
    }
  },

  currentHm() {
    const d = new Date();
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
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
      filtered = this.data.appointments.filter(a => a.status === 'completed');
    } else {
      const targetDate = targetMap[this.data.currentFilter];
      filtered = this.data.appointments.filter(a => a.date === targetDate && a.status !== 'cancelled' && a.status !== 'completed');
    }
    filtered.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return formatTimeDisplay(a.time).localeCompare(formatTimeDisplay(b.time));
    });
    this.setData({ filteredAppointments: filtered });
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
          this.loadTimeSlots();
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

  async loadTimeSlots() {
    const session = this.data.session;
    if (!session) return;
    const option = this.data.slotDateOptions[this.data.slotDateIndex];
    const date = option.date;
    const slots = await this.callApi('getSlots', { stylistId: session.stylistId, date });
    const blocked = await this.callApi('getAdminBlockedSlots', { stylistId: session.stylistId, date });
    const blockedList = Array.isArray(blocked) ? blocked : [];
    const slotItems = (Array.isArray(slots) ? slots : []).map(slot => {
      const isDefaultMeal = slot.time === '12:00-12:30' || slot.time === '18:00-18:30';
      const isUnlocked = blockedList.some(b => b.time === `${slot.time}_UNLOCKED`);
      const isExplicitBlocked = blockedList.some(b => b.time === slot.time);
      const blockedNow = isExplicitBlocked || (isDefaultMeal && !isUnlocked);
      const adminClass = slot.status === 'booked' ? 'booked' : slot.status === 'past' ? 'past' : blockedNow ? 'blocked' : 'available';
      const adminText = slot.status === 'booked' ? '已约' : slot.status === 'past' ? '过期' : blockedNow ? '锁定' : '可约';
      return {
        ...slot,
        displayTime: formatTimeDisplay(slot.time),
        adminClass,
        adminText,
        canToggle: slot.status !== 'booked' && slot.status !== 'past'
      };
    });
    this.setData({ slotItems });
  },

  async toggleSlot(e) {
    const canToggle = e.currentTarget.dataset.canToggle === true || e.currentTarget.dataset.canToggle === 'true';
    if (!canToggle) return;
    const time = e.currentTarget.dataset.time;
    const option = this.data.slotDateOptions[this.data.slotDateIndex];
    const item = this.data.slotItems.find(s => s.time === time);
    const action = item && item.adminClass === 'blocked' ? 'adminUnblockSlot' : 'adminBlockSlot';
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
    this.setData({
      modalMask: true,
      vacationVisible: true,
      vacationRanges: Array.isArray(info.vacationRanges) ? info.vacationRanges : [],
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
      this.setData({ vacationRanges: data.vacationRanges || next, vacationError: '' });
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
      this.setData({ vacationRanges: data.vacationRanges || next });
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
