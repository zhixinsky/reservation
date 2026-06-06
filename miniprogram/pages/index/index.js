const { callApi } = require('../../utils/api');
const { getVerifiedPhone, setVerifiedPhone } = require('../../utils/phone-auth');
const { syncIndexTabBar } = require('../../utils/tab-bar');

const DEFAULT_ANNOUNCEMENT_TEXT = '欢迎光临欧诺造型，本店营业时间 11:00-22:00，请提前预约到店！';
const EMPTY_ANNOUNCEMENT_TEXT = '暂无公告';

function pad2(n) {
  return String(n).padStart(2, '0');
}

function ymdFromDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatDateText(ymd) {
  const parts = String(ymd || '').split('-');
  if (parts.length < 3) return ymd || '';
  return `${parts[1]}/${parts[2]}`;
}

function formatTimeDisplay(timeStr) {
  if (!timeStr) return '';
  const firstTime = String(timeStr).split(',')[0].trim();
  return firstTime.split('-')[0] || firstTime;
}

function getVacationRanges(stylist) {
  if (!stylist) return [];
  if (Array.isArray(stylist.vacationRanges)) return stylist.vacationRanges;
  if (stylist.vacationStartDate && stylist.vacationEndDate) {
    return [{ vacationStartDate: stylist.vacationStartDate, vacationEndDate: stylist.vacationEndDate }];
  }
  return [];
}

function isYmdInVacation(stylist, ymd) {
  return getVacationRanges(stylist).some(r => r.vacationStartDate && r.vacationEndDate && ymd >= r.vacationStartDate && ymd <= r.vacationEndDate);
}

function hasBookableDayInThreeDayWindow(stylist) {
  const now = new Date();
  for (let i = 0; i < 3; i += 1) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    if (!isYmdInVacation(stylist, ymdFromDate(d))) return true;
  }
  return false;
}

function formatWaitTime(totalMinutes) {
  if (totalMinutes <= 0) return { line2: '到店后预计准时' };
  if (totalMinutes < 60) return { line2: '按您预约时间到店需等待 ', numberPart: `${totalMinutes} 分钟` };
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (m === 0) return { line2: '按您预约时间到店需等待 ', numberPart: `${h} 小时` };
  return { line2: '按您预约时间到店需等待 ', numberPart: `${h} 小时 ${m} 分钟` };
}

function serviceTypeText(serviceType) {
  return serviceType === 'dye' ? '烫染' : '剪发';
}

Page({
  data: {
    announcementText: DEFAULT_ANNOUNCEMENT_TEXT,
    announcementScrollable: false,
    bookingDisabled: false,
    stylistId: null,
    currentId: null,
    drawerVisible: false,
    maskVisible: false,
    useWorkletDrawer: false,
    selectedServiceType: 'cut',
    selectedDate: '',
    dateTabs: [],
    allSlots: [],
    slotItems: [],
    slotsLoading: false,
    slotsUpdating: false,
    selectedTimeSlot: [],
    refreshTimer: null,
    phoneModalVisible: false,
    phoneError: '',
    successVisible: false,
    displayId: '',
    cancelModalVisible: false,
    cancelStep: 1,
    cancelPhone: '',
    cancelError: '',
    cancelError2: '',
    selectedAppointments: [],
    cancellableAppointments: [],
    nonCancellableAppointments: [],
    progressModalVisible: false,
    progressStep: 1,
    progressPhone: '',
    progressError: '',
    progressRows: []
  },

  onLoad() {
    this.init();
    this.loadAnnouncement();
  },

  onShow() {
    this.init();
    wx.nextTick(() => {
      if (!this.data.drawerVisible) {
        this.resetDrawerAnimationState();
      }
      syncIndexTabBar(this);
      this.scheduleAnnouncementMeasure();
    });
  },

  onReady() {
    wx.nextTick(() => {
      this.scheduleAnnouncementMeasure();
      this.initDrawerAnimation();
    });
  },

  onHide() {
    this.stopRefresh();
    this.resetDrawerAnimationState();
    if (this.data.drawerVisible || this.data.maskVisible) {
      this.setData({
        drawerVisible: false,
        maskVisible: false,
        phoneModalVisible: false,
        successVisible: false,
        cancelModalVisible: false,
        progressModalVisible: false,
        selectedTimeSlot: []
      }, () => syncIndexTabBar(this));
    }
  },

  onUnload() {
    this.stopRefresh();
    this.resetDrawerAnimationState();
  },

  callApi(action, payload = {}) {
    return callApi(action, payload);
  },

  initDrawerAnimation() {
    const sys = wx.getSystemInfoSync();
    this._drawerClosedY = Math.round(sys.windowHeight * 0.8);

    if (!wx.worklet || typeof this.applyAnimatedStyle !== 'function') {
      this.setData({ useWorkletDrawer: false });
      return;
    }

    const { shared } = wx.worklet;
    const drawerY = shared(this._drawerClosedY);
    const overlayOpacity = shared(0);
    this._drawerY = drawerY;
    this._overlayOpacity = overlayOpacity;

    this.applyAnimatedStyle('.booking-drawer', () => {
      'worklet';
      return {
        transform: `translateY(${drawerY.value}px)`
      };
    });

    this.applyAnimatedStyle('.booking-overlay', () => {
      'worklet';
      return {
        opacity: overlayOpacity.value,
        pointerEvents: overlayOpacity.value > 0.05 ? 'auto' : 'none'
      };
    });

    this.setData({ useWorkletDrawer: true });
  },

  openDrawerAnimation() {
    if (!this._drawerY || !this._overlayOpacity) return;
    const { timing, Easing } = wx.worklet;
    this._drawerY.value = timing(0, {
      duration: 320,
      easing: Easing.out(Easing.cubic)
    });
    this._overlayOpacity.value = timing(1, {
      duration: 280,
      easing: Easing.out(Easing.quad)
    });
  },

  resetDrawerAnimationState() {
    if (this._drawerHideFallbackTimer) {
      clearTimeout(this._drawerHideFallbackTimer);
      this._drawerHideFallbackTimer = null;
    }
    this._drawerHideCallback = null;
    this._drawerHideDoneCalled = true;
    if (!this._drawerY || !this._overlayOpacity) return;
    if (!this._drawerClosedY) {
      const sys = wx.getSystemInfoSync();
      this._drawerClosedY = Math.round(sys.windowHeight * 0.8);
    }
    this._drawerY.value = this._drawerClosedY;
    this._overlayOpacity.value = 0;
  },

  hideDrawerAnimation(done) {
    this._drawerHideCallback = typeof done === 'function' ? done : null;
    this._drawerHideDoneCalled = false;
    if (this._drawerHideFallbackTimer) {
      clearTimeout(this._drawerHideFallbackTimer);
      this._drawerHideFallbackTimer = null;
    }
    if (!this._drawerY || !this._overlayOpacity) {
      this._invokeDrawerHideCallback();
      return;
    }
    const { timing, Easing, runOnJS } = wx.worklet;
    const onComplete = runOnJS(this._invokeDrawerHideCallback.bind(this));
    this._drawerHideFallbackTimer = setTimeout(() => {
      this._invokeDrawerHideCallback();
    }, 380);
    this._overlayOpacity.value = timing(0, {
      duration: 240,
      easing: Easing.in(Easing.quad)
    });
    this._drawerY.value = timing(this._drawerClosedY, {
      duration: 300,
      easing: Easing.in(Easing.cubic)
    }, () => {
      'worklet';
      onComplete();
    });
  },

  _invokeDrawerHideCallback() {
    if (this._drawerHideDoneCalled) return;
    this._drawerHideDoneCalled = true;
    if (this._drawerHideFallbackTimer) {
      clearTimeout(this._drawerHideFallbackTimer);
      this._drawerHideFallbackTimer = null;
    }
    const done = this._drawerHideCallback;
    this._drawerHideCallback = null;
    if (done) done();
  },

  presentDrawer(onPresented) {
    this.setData({
      drawerVisible: true,
      maskVisible: true
    }, () => {
      syncIndexTabBar(this);
      wx.nextTick(() => {
        syncIndexTabBar(this);
        if (this.data.useWorkletDrawer) {
          this.openDrawerAnimation();
        }
        if (onPresented) onPresented();
      });
    });
  },

  dismissDrawer(options = {}) {
    const { keepMask = false, resetServiceType = true, onDone } = options;
    this.stopRefresh();

    const finish = () => {
      const next = {
        drawerVisible: false,
        maskVisible: keepMask,
        selectedTimeSlot: []
      };
      if (resetServiceType) {
        next.selectedServiceType = 'cut';
      }
      this.setData(next, () => {
        if (onDone) onDone();
        syncIndexTabBar(this);
      });
    };

    if (this.data.useWorkletDrawer && this.data.drawerVisible) {
      this.hideDrawerAnimation(finish);
      return;
    }
    if (this.data.drawerVisible) {
      setTimeout(finish, 320);
      return;
    }
    finish();
  },

  async getAuthorizedPhone(e, errorKey) {
    if (!e.detail || !e.detail.code) {
      this.setData({ [errorKey]: '需要手机号快速登录后继续操作' });
      return '';
    }
    wx.showLoading({ title: '验证中' });
    try {
      const data = await this.callApi('getPhoneNumber', { code: e.detail.code });
      wx.hideLoading();
      if (!data || !data.success || !data.phone) {
        this.setData({ [errorKey]: (data && data.message) || '手机号验证失败' });
        return '';
      }
      setVerifiedPhone(data.phone);
      return data.phone;
    } catch (err) {
      wx.hideLoading();
      this.setData({ [errorKey]: '手机号验证失败，请稍后重试' });
      return '';
    }
  },

  updateAnnouncementScrollable() {
    const content = String(this.data.announcementText || '');
    const heuristicScrollable = content.length > 18;

    const applyScrollable = scrollable => {
      if (scrollable !== this.data.announcementScrollable) {
        this.setData({ announcementScrollable: scrollable });
      }
    };

    const query = this.createSelectorQuery();
    query.select('#announcementWrap').boundingClientRect();
    query.select('#announcementText').boundingClientRect();
    query.exec(res => {
      const wrap = res && res[0];
      const text = res && res[1];
      if (!wrap || !text || !wrap.width) {
        applyScrollable(heuristicScrollable);
        return;
      }
      applyScrollable(text.width > wrap.width + 2 || heuristicScrollable);
    });
  },

  scheduleAnnouncementMeasure() {
    wx.nextTick(() => this.updateAnnouncementScrollable());
    setTimeout(() => this.updateAnnouncementScrollable(), 80);
    setTimeout(() => this.updateAnnouncementScrollable(), 240);
  },

  async loadAnnouncement() {
    try {
      const data = await this.callApi('getAnnouncement');
      const text = data && data.text && data.text.trim() ? data.text.trim() : EMPTY_ANNOUNCEMENT_TEXT;
      this.setData({
        announcementText: text,
        announcementScrollable: false
      }, () => this.scheduleAnnouncementMeasure());
    } catch (e) {
      this.setData({
        announcementText: DEFAULT_ANNOUNCEMENT_TEXT,
        announcementScrollable: false
      }, () => this.scheduleAnnouncementMeasure());
    }
  },

  async init() {
    try {
      const stylists = await this.callApi('getStylists');
      if (!Array.isArray(stylists) || stylists.length === 0) return;
      const stylist = stylists[0];
      this.setData({
        stylistId: stylist.id,
        currentId: stylist.id,
        bookingDisabled: !hasBookableDayInThreeDayWindow(stylist)
      });
    } catch (e) {
      console.error('加载发型师信息失败:', e);
    }
  },

  buildDateTabs() {
    const now = new Date();
    const days = ['今天', '明天', '后天'];
    return days.map((day, index) => {
      const d = new Date(now);
      d.setDate(now.getDate() + index);
      return {
        day,
        date: ymdFromDate(d),
        label: `${d.getMonth() + 1}/${d.getDate()}`
      };
    });
  },

  async openBook(e) {
    if (this.data.bookingDisabled) return;

    await this.init();
    if (!this.data.stylistId) {
      wx.showToast({ title: '无法获取发型师信息', icon: 'none' });
      return;
    }

    const selectedServiceType = e.currentTarget.dataset.type || 'cut';
    const dateTabs = this.buildDateTabs();
    const selectedDate = dateTabs[0].date;
    this.setData({
      currentId: this.data.stylistId,
      selectedServiceType,
      dateTabs,
      selectedDate,
      selectedTimeSlot: []
    });
    this.presentDrawer(async () => {
      await this.loadSlots(selectedDate);
      this.startRefresh();
    });
  },

  async switchDate(e) {
    const date = e.currentTarget.dataset.date;
    this.setData({ selectedDate: date, selectedTimeSlot: [], slotsUpdating: true });
    setTimeout(() => this.loadSlots(date, true), 150);
  },

  async loadSlots(date, silent = false) {
    if (!silent) this.setData({ slotsLoading: true, slotItems: [] });
    if (silent) this.setData({ slotsUpdating: true });
    try {
      const slots = await this.callApi('getSlots', {
        stylistId: this.data.currentId,
        date
      });
      const allSlots = Array.isArray(slots) ? slots : [];
      this.setData({
        allSlots,
        slotItems: this.buildSlotItems(allSlots),
        slotsLoading: false,
        slotsUpdating: false
      });
    } catch (e) {
      wx.showToast({ title: '时段加载失败', icon: 'none' });
      this.setData({ slotsLoading: false, slotsUpdating: false });
    }
  },

  buildSlotItems(slots) {
    const selectedServiceType = this.data.selectedServiceType;
    const clickableSlots = new Set();
    const unavailableSlots = new Set();

    if (selectedServiceType === 'dye') {
      for (let startIdx = 0; startIdx < slots.length; startIdx += 1) {
        const startSlot = slots[startIdx];
        if (!this.isSlotAvailable(startSlot)) continue;

        const validSlots = [];
        let skippedCount = 0;
        let currentIdx = startIdx;
        while (validSlots.length < 4 && currentIdx < slots.length) {
          const slot = slots[currentIdx];
          if (this.isSlotAvailable(slot)) {
            validSlots.push(currentIdx);
          } else if (skippedCount < 1) {
            skippedCount += 1;
          } else {
            break;
          }
          currentIdx += 1;
        }

        if (validSlots.length === 4) {
          clickableSlots.add(startSlot.time);
        } else if (validSlots.length > 0) {
          validSlots.forEach(idx => unavailableSlots.add(slots[idx].time));
        }
      }
    }

    return slots.map(t => {
      let statusClass = 'unavailable';
      let clickable = false;
      if (selectedServiceType === 'dye') {
        if (clickableSlots.has(t.time)) {
          statusClass = 'available';
          clickable = true;
        } else if (unavailableSlots.has(t.time) || !this.isSlotAvailable(t)) {
          statusClass = 'unavailable';
        }
      } else {
        const isDefaultMealTime = t.time === '12:00-12:30' || t.time === '18:00-18:30';
        if (t.status !== 'booked' && t.status !== 'blocked' && t.status !== 'past' && !isDefaultMealTime && t.available) {
          statusClass = 'available';
          clickable = true;
        }
      }
      return {
        ...t,
        displayTime: formatTimeDisplay(t.time),
        statusClass,
        clickable
      };
    });
  },

  isSlotAvailable(slot) {
    return slot && slot.status !== 'booked' && slot.status !== 'blocked' && slot.status !== 'past' && slot.available;
  },

  selectTimeSlot(e) {
    const clickable = e.currentTarget.dataset.clickable === true || e.currentTarget.dataset.clickable === 'true';
    if (!clickable) return;
    const time = e.currentTarget.dataset.time;

    if (this.data.selectedServiceType === 'dye') {
      const startIndex = this.data.allSlots.findIndex(s => s.time === time);
      if (startIndex === -1) {
        wx.showToast({ title: '无法找到该时间段', icon: 'none' });
        return;
      }
      const selectedSlots = [];
      let skippedCount = 0;
      let currentIndex = startIndex;
      while (selectedSlots.length < 4 && currentIndex < this.data.allSlots.length) {
        const slot = this.data.allSlots[currentIndex];
        if (this.isSlotAvailable(slot)) {
          selectedSlots.push(slot.time);
        } else if (skippedCount < 1) {
          skippedCount += 1;
        } else {
          break;
        }
        currentIndex += 1;
      }
      if (selectedSlots.length !== 4) {
        wx.showToast({ title: '该时间段无法预约', icon: 'none' });
        return;
      }
      this.setData({ selectedTimeSlot: selectedSlots });
      setTimeout(() => this.openPhoneModal(), 100);
      return;
    }

    this.setData({ selectedTimeSlot: [time] });
    this.openPhoneModal();
  },

  async openPhoneModal() {
    const verifiedPhone = getVerifiedPhone();
    if (verifiedPhone) {
      const blocked = await this.checkExistingAppointmentForDate(verifiedPhone, this.data.selectedDate);
      if (blocked) {
        wx.showModal({
          title: '无法预约',
          content: blocked,
          showCancel: false
        });
        this.setData({ selectedTimeSlot: [] });
        if (this.data.selectedDate) this.loadSlots(this.data.selectedDate, true);
        return;
      }
      this.confirmBooking(verifiedPhone);
      return;
    }
    this.setData({
      phoneModalVisible: true,
      maskVisible: true,
      phoneError: ''
    }, () => syncIndexTabBar(this));
  },

  async checkExistingAppointmentForDate(phone, date) {
    if (!phone || !date) return '';
    try {
      const data = await this.callApi('queryAppointments', { phone });
      if (!data || !data.success) return '';
      const appointments = Array.isArray(data.appointments) ? data.appointments : [];
      const existing = appointments.find(app => app.date === date);
      if (!existing) return '';
      return `您在该日期已有预约（预约号：${existing.appId}），一个手机号一天内只能预约一次`;
    } catch (e) {
      return '';
    }
  },

  showBookingError(message) {
    const text = message || '预约失败，请刷新重试';
    if (this.data.phoneModalVisible) {
      this.setData({ phoneError: text });
      return;
    }
    wx.showModal({
      title: '预约失败',
      content: text,
      showCancel: false
    });
    this.setData({ selectedTimeSlot: [] });
    if (this.data.selectedDate) this.loadSlots(this.data.selectedDate, true);
  },

  closePhoneModal() {
    this.setData({
      phoneModalVisible: false,
      maskVisible: this.data.drawerVisible,
      selectedTimeSlot: []
    }, () => syncIndexTabBar(this));
    if (this.data.selectedDate) this.loadSlots(this.data.selectedDate, true);
  },

  async onBookingPhoneNumber(e) {
    const phone = await this.getAuthorizedPhone(e, 'phoneError');
    if (!phone) return;
    this.confirmBooking(phone);
  },

  async confirmBooking(phone) {
    if (this.data.selectedServiceType === 'dye' && this.data.selectedTimeSlot.length !== 4) {
      this.showBookingError('预约失败，请重新选择时间段');
      return;
    }
    if (this.data.selectedServiceType !== 'dye' && this.data.selectedTimeSlot.length !== 1) {
      this.showBookingError('请选择一个时间段');
      return;
    }

    wx.showLoading({ title: '预约中' });
    try {
      const time = this.data.selectedServiceType === 'dye'
        ? this.data.selectedTimeSlot.join(',')
        : this.data.selectedTimeSlot[0];
      const data = await this.callApi('bookAppointment', {
        stylistId: this.data.currentId,
        time,
        date: this.data.selectedDate,
        userName: '',
        phone,
        serviceType: this.data.selectedServiceType || 'cut'
      });
      wx.hideLoading();
      if (data && data.success) {
        wx.setStorageSync('my_appointment', {
          appId: data.appId,
          date: this.data.selectedDate,
          time,
          phone
        });
        this.dismissDrawer({
          keepMask: true,
          resetServiceType: false,
          onDone: () => {
            this.setData({
              phoneModalVisible: false,
              maskVisible: true,
              successVisible: true,
              displayId: data.appId,
              phoneError: ''
            }, () => syncIndexTabBar(this));
          }
        });
      } else {
        this.showBookingError((data && data.message) || '预约失败，请刷新重试');
      }
    } catch (e) {
      wx.hideLoading();
      this.showBookingError('网络错误，请稍后重试');
    }
  },

  openCancelModal() {
    const verifiedPhone = getVerifiedPhone();
    this.setData({
      cancelModalVisible: true,
      maskVisible: true,
      cancelStep: verifiedPhone ? 2 : 1,
      cancelPhone: verifiedPhone || '',
      cancelError: '',
      cancelError2: '',
      selectedAppointments: [],
      cancellableAppointments: [],
      nonCancellableAppointments: []
    }, () => syncIndexTabBar(this));
    if (verifiedPhone) {
      this.queryAppointments(verifiedPhone);
    }
  },

  closeCancelModal() {
    this.setData({
      cancelModalVisible: false,
      maskVisible: false,
      cancelPhone: '',
      cancelError: '',
      cancelError2: '',
      selectedAppointments: [],
      cancellableAppointments: [],
      nonCancellableAppointments: []
    }, () => syncIndexTabBar(this));
  },

  backToCancelStep1() {
    this.setData({ cancelStep: 1, selectedAppointments: [], cancelError2: '' });
  },

  async onCancelPhoneNumber(e) {
    const phone = await this.getAuthorizedPhone(e, 'cancelError');
    if (!phone) return;
    this.setData({ cancelPhone: phone });
    this.queryAppointments(phone);
  },

  async queryAppointments(phoneArg) {
    const phone = String(phoneArg || this.data.cancelPhone || '').trim();
    wx.showLoading({ title: '查询中' });
    try {
      const data = await this.callApi('queryAppointments', { phone });
      wx.hideLoading();
      if (!data || !data.success) {
        this.setData({ cancelError: (data && data.message) || '查询失败，请检查手机号' });
        return;
      }
      const appointments = Array.isArray(data.appointments) ? data.appointments.map(this.decorateAppointment) : [];
      if (appointments.length === 0) {
        this.setData({ cancelError: '未找到该手机号的预约记录' });
        return;
      }
      this.setData({
        cancelStep: 2,
        selectedAppointments: [],
        cancellableAppointments: appointments.filter(a => a.canCancel),
        nonCancellableAppointments: appointments.filter(a => !a.canCancel),
        cancelError: '',
        cancelError2: ''
      });
    } catch (e) {
      wx.hideLoading();
      this.setData({ cancelError: '网络错误，请稍后重试' });
    }
  },

  decorateAppointment(app) {
    return {
      ...app,
      checked: false,
      dateText: formatDateText(app.date),
      timeDisplay: app.serviceType === 'dye' ? app.time : String(app.time || '').split('-')[0],
      serviceTypeText: serviceTypeText(app.serviceType)
    };
  },

  toggleAppointment(e) {
    const id = e.currentTarget.dataset.id;
    const selected = this.data.selectedAppointments.includes(id)
      ? this.data.selectedAppointments.filter(item => item !== id)
      : [...this.data.selectedAppointments, id];
    const selectedSet = new Set(selected);
    this.setData({
      selectedAppointments: selected,
      cancellableAppointments: this.data.cancellableAppointments.map(app => ({
        ...app,
        checked: selectedSet.has(app.id)
      })),
      cancelError2: ''
    });
  },

  async confirmCancel() {
    if (this.data.selectedAppointments.length === 0) {
      this.setData({ cancelError2: '请至少选择一个要取消的预约' });
      return;
    }
    wx.showLoading({ title: '取消中' });
    try {
      const data = await this.callApi('cancelAppointments', {
        appointmentIds: this.data.selectedAppointments
      });
      wx.hideLoading();
      if (data && data.success) {
        wx.removeStorageSync('my_appointment');
        wx.showModal({
          title: '取消成功',
          content: data.message || (data.cancelledCount > 1 ? `已成功取消 ${data.cancelledCount} 个预约` : '预约已成功取消'),
          showCancel: false
        });
        this.closeCancelModal();
      } else {
        this.setData({ cancelError2: (data && data.message) || '取消失败' });
      }
    } catch (e) {
      wx.hideLoading();
      this.setData({ cancelError2: '网络错误，请稍后重试' });
    }
  },

  openProgressModal() {
    const verifiedPhone = getVerifiedPhone();
    this.setData({
      progressModalVisible: true,
      maskVisible: true,
      progressStep: verifiedPhone ? 2 : 1,
      progressPhone: verifiedPhone || '',
      progressError: '',
      progressRows: []
    }, () => syncIndexTabBar(this));
    if (verifiedPhone) {
      this.queryProgress(verifiedPhone);
    }
  },

  closeProgressModal() {
    this.setData({
      progressModalVisible: false,
      maskVisible: false,
      progressPhone: '',
      progressError: '',
      progressRows: []
    }, () => syncIndexTabBar(this));
  },

  async onProgressPhoneNumber(e) {
    const phone = await this.getAuthorizedPhone(e, 'progressError');
    if (!phone) return;
    this.setData({ progressPhone: phone });
    this.queryProgress(phone);
  },

  async queryProgress(phoneArg) {
    const phone = String(phoneArg || this.data.progressPhone || '').trim();
    wx.showLoading({ title: '查询中' });
    try {
      const data = await this.callApi('queryAppointments', { phone });
      if (!data || !data.success) {
        wx.hideLoading();
        this.setData({ progressError: (data && data.message) || '查询失败，请检查手机号' });
        return;
      }
      const appointments = Array.isArray(data.appointments) ? data.appointments : [];
      if (appointments.length === 0) {
        wx.hideLoading();
        this.setData({ progressError: '未找到该手机号的预约记录' });
        return;
      }
      const rows = [];
      for (const app of appointments) {
        rows.push(await this.buildProgressRow(app));
      }
      wx.hideLoading();
      this.setData({
        progressStep: 2,
        progressRows: rows,
        progressError: ''
      });
    } catch (e) {
      wx.hideLoading();
      this.setData({ progressError: '网络错误，请稍后重试' });
    }
  },

  async buildProgressRow(app) {
    const todayStr = ymdFromDate(new Date());
    const now = new Date();
    const currentTotalMinutes = now.getHours() * 60 + now.getMinutes();
    let delayLine1 = '';
    let delayLine2 = '';
    let numberPart = '';
    let aheadCount = null;

    if (app.date > todayStr) {
      delayLine1 = '未到预约日';
    } else if (app.date < todayStr) {
      delayLine1 = '已过期';
    } else if (app.stylistId == null) {
      delayLine1 = '暂无排队信息';
    } else {
      try {
        const queue = await this.callApi('getDayQueue', {
          date: app.date,
          stylistId: app.stylistId
        });
        if (Array.isArray(queue) && queue.length > 0) {
          const myIndex = queue.findIndex(q => q.time === app.time && q.serviceType === app.serviceType);
          aheadCount = myIndex >= 0 ? myIndex : 0;
          const first = queue[0];
          const endPart = first.time.split('-')[1];
          const delayMinutes = endPart ? currentTotalMinutes - this.timeToMinutes(endPart.trim()) : 0;
          if (aheadCount === 0) {
            delayLine1 = '您当前是队列第一位';
            delayLine2 = '预计准时';
            aheadCount = null;
          } else {
            delayLine1 = '您前面还有X位已预约未完成的客户';
            const wait = formatWaitTime(delayMinutes);
            delayLine2 = wait.line2;
            numberPart = wait.numberPart || '';
          }
        } else {
          delayLine1 = '预计准时';
        }
      } catch (e) {
        delayLine1 = '暂无排队信息';
      }
    }

    return {
      key: `${app.id || app.appId}-${app.date}-${app.time}`,
      dateStr: formatDateText(app.date),
      timeDisplay: app.serviceType === 'dye' ? app.time : String(app.time || '').split('-')[0],
      serviceTypeText: serviceTypeText(app.serviceType),
      appId: app.appId,
      delayLine1,
      delayLine2,
      numberPart,
      aheadCount,
      hasAheadCount: aheadCount !== null
    };
  },

  timeToMinutes(time) {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
  },

  startRefresh() {
    this.stopRefresh();
    this.refreshTimer = setInterval(() => {
      if (this.data.drawerVisible && this.data.selectedDate) {
        this.loadSlots(this.data.selectedDate, true);
      } else {
        this.stopRefresh();
      }
    }, 10000);
  },

  stopRefresh() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  },

  closeDrawer() {
    this.dismissDrawer();
  },

  closeAll() {
    this.stopRefresh();
    const finalize = () => {
      this.setData({
        drawerVisible: false,
        maskVisible: false,
        phoneModalVisible: false,
        successVisible: false,
        cancelModalVisible: false,
        progressModalVisible: false,
        selectedTimeSlot: [],
        selectedServiceType: 'cut'
      }, () => syncIndexTabBar(this));
    };

    if (this.data.drawerVisible && this.data.useWorkletDrawer) {
      this.hideDrawerAnimation(finalize);
      return;
    }
    if (this.data.drawerVisible) {
      setTimeout(finalize, 320);
      return;
    }
    finalize();
  }
});
