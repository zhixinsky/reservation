const { callApi } = require('../../utils/api');
const { getVerifiedPhone, setVerifiedPhone } = require('../../utils/phone-auth');
const { syncIndexTabBar } = require('../../utils/tab-bar');
const { buildProgressRow: createProgressRow } = require('../../utils/queue-progress');
const {
  resolveStoreContext,
  saveStoreSelection,
  parseLaunchStoreId,
  formatStoreName
} = require('../../utils/store-context');
const { DEFAULT_PAGE_BG, resolveStorePageBg } = require('../../utils/store-background');

const DEFAULT_ANNOUNCEMENT_TEXT = '欢迎光临欧诺造型，本店营业时间 11:00-22:00，请提前预约到店！';
const EMPTY_ANNOUNCEMENT_TEXT = '暂无公告';
const { resolveStylistAvatar } = require('../../utils/stylist-avatar');
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

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

function weekdayText(ymd) {
  const parts = String(ymd || '').split('-').map(Number);
  if (parts.length < 3) return '';
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  return WEEKDAYS[date.getDay()] || '';
}

function buildSuccessTimeLabel(serviceType, timeStr, slots) {
  if (serviceType === 'dye' && Array.isArray(slots) && slots.length > 1) {
    return `${formatTimeDisplay(slots[0])} - ${formatTimeDisplay(slots[slots.length - 1])}`;
  }
  return formatTimeDisplay(timeStr);
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

function clampBookAheadDays(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 3;
  return Math.min(3, Math.max(1, Math.round(n)));
}

/** 按门店名估算胶囊宽度（rpx），最多 6 字完整展示 */
function estimateStoreCapsuleWidthRpx(name) {
  const text = String(name || '门店');
  let textRpx = 0;
  for (const ch of text) {
    textRpx += /[\u4e00-\u9fff]/.test(ch) ? 30 : 16;
  }
  const arrowRpx = 24;
  const paddingRpx = 44;
  const gapRpx = 8;
  return Math.min(440, Math.max(156, textRpx + arrowRpx + paddingRpx + gapRpx));
}

function dayLabelForOffset(index) {
  if (index === 0) return '今天';
  if (index === 1) return '明天';
  if (index === 2) return '后天';
  return `第${index + 1}天`;
}

function hasBookableDayInWindow(stylist, bookAheadDays) {
  const days = clampBookAheadDays(bookAheadDays);
  const now = new Date();
  for (let i = 0; i < days; i += 1) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    if (!isYmdInVacation(stylist, ymdFromDate(d))) return true;
  }
  return false;
}

function serviceTypeText(serviceType) {
  return serviceType === 'dye' ? '烫染' : '剪发';
}

Page({
  data: {
    pageBgUrl: DEFAULT_PAGE_BG,
    announcementText: DEFAULT_ANNOUNCEMENT_TEXT,
    announcementScrollable: false,
    announcementTrackStyle: '',
    bookingDisabled: false,
    stylistId: null,
    currentId: null,
    currentStylistName: '店长',
    currentStylistRank: '',
    currentStylistPhoto: '',
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
    confirmModalVisible: false,
    confirmServiceLabel: '',
    confirmDateLabel: '',
    confirmTimeLabel: '',
    alertModalVisible: false,
    alertModalTitle: '',
    alertModalMessage: '',
    alertModalAppId: '',
    alertModalDateLabel: '',
    successVisible: false,
    displayId: '',
    successServiceLabel: '',
    successDateLabel: '',
    successTimeLabel: '',
    successStylistName: '',
    successStylistRank: '',
    successStylistAvatar: '/images/11.png',
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
    progressRows: [],
    storePickerVisible: false,
    storeMenuVisible: false,
    storeList: [],
    selectedStoreId: null,
    selectedStoreName: '门店',
    storeCapsuleWidth: 180,
    bookAheadDays: 3
  },

  onLoad(options) {
    this._launchStoreId = this.consumeLaunchStoreId(options);
    this.bootstrap();
  },

  consumeLaunchStoreId(options) {
    const fromPage = parseLaunchStoreId(options || {});
    if (fromPage != null) return fromPage;
    const app = getApp();
    if (!app || !app.globalData) return null;
    const pending = app.globalData.launchStoreId;
    app.globalData.launchStoreId = null;
    return pending != null ? pending : null;
  },

  async bootstrap() {
    await this.initStoreContext(this._launchStoreId);
    await this.initStylists(this.data.selectedStoreId);
    this.loadAnnouncement();
  },

  onShow(options) {
    const scanStoreId = parseLaunchStoreId(options || {});
    if (scanStoreId != null && scanStoreId !== this.data.selectedStoreId) {
      this._launchStoreId = scanStoreId;
      this.initStoreContext(scanStoreId).then(() => {
        this.initStylists(this.data.selectedStoreId);
        this.loadAnnouncement();
      });
    } else if (this.data.selectedStoreId) {
      this.initStylists(this.data.selectedStoreId);
    }
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
        confirmModalVisible: false,
        alertModalVisible: false,
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
        selectedTimeSlot: [],
        confirmModalVisible: false,
        phoneModalVisible: false,
        alertModalVisible: false,
        phoneError: ''
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
    const gapPx = (wx.getSystemInfoSync().windowWidth / 750) * 48;

    const applyScrollable = (scrollable, trackStyle = '') => {
      const next = {
        announcementScrollable: scrollable,
        announcementTrackStyle: trackStyle
      };
      if (
        scrollable !== this.data.announcementScrollable ||
        trackStyle !== this.data.announcementTrackStyle
      ) {
        this.setData(next);
      }
    };

    const query = this.createSelectorQuery();
    query.select('#announcementWrap').boundingClientRect();
    query.select('#announcementText').boundingClientRect();
    query.exec(res => {
      const wrap = res && res[0];
      const text = res && res[1];
      if (!wrap || !text || !wrap.width) {
        applyScrollable(heuristicScrollable, heuristicScrollable ? 'animation-duration: 12s;' : '');
        return;
      }
      const scrollable = text.width > wrap.width + 2 || heuristicScrollable;
      if (!scrollable) {
        applyScrollable(false, '');
        return;
      }
      const segmentWidth = text.width + gapPx;
      const duration = Math.min(36, Math.max(8, segmentWidth / 32));
      applyScrollable(true, `animation-duration: ${duration}s;`);
    });
  },

  scheduleAnnouncementMeasure() {
    wx.nextTick(() => this.updateAnnouncementScrollable());
    setTimeout(() => this.updateAnnouncementScrollable(), 80);
    setTimeout(() => this.updateAnnouncementScrollable(), 240);
  },

  async loadAnnouncement() {
    try {
      const storeId = this.data.selectedStoreId || 1;
      const data = await this.callApi('getAnnouncement', { storeId });
      const text = data && data.text && data.text.trim() ? data.text.trim() : EMPTY_ANNOUNCEMENT_TEXT;
      this.setData({
        announcementText: text,
        announcementScrollable: false,
        announcementTrackStyle: ''
      }, () => this.scheduleAnnouncementMeasure());
    } catch (e) {
      this.setData({
        announcementText: DEFAULT_ANNOUNCEMENT_TEXT,
        announcementScrollable: false,
        announcementTrackStyle: ''
      }, () => this.scheduleAnnouncementMeasure());
    }
  },

  async initStoreContext(preferredStoreId) {
    const launchId = preferredStoreId != null
      ? preferredStoreId
      : (this._launchStoreId != null ? this._launchStoreId : null);
    try {
      const ctx = await resolveStoreContext(
        () => this.callApi('getStores'),
        { preferredStoreId: launchId }
      );
      const selectedStore = ctx.selectedStore || {};
      const activeCount = (ctx.stores || []).length;
      console.log('[store] 营业门店数:', activeCount, (ctx.stores || []).map((s) => s.name));
      const selectedStoreName = formatStoreName(selectedStore.name);
      this.setData({
        storePickerVisible: activeCount > 1,
        storeList: ctx.stores,
        selectedStoreId: ctx.storeId,
        selectedStoreName,
        storeCapsuleWidth: estimateStoreCapsuleWidthRpx(selectedStoreName),
        bookAheadDays: clampBookAheadDays(selectedStore.bookAheadDays),
        storeMenuVisible: false,
        pageBgUrl: resolveStorePageBg(selectedStore)
      }, () => this.refineStoreCapsuleWidth());
      if (ctx.fromScan && ctx.selectedStore && ctx.selectedStore.name) {
        wx.showToast({ title: `已进入${ctx.selectedStore.name}`, icon: 'none', duration: 2000 });
      }
    } catch (e) {
      console.error('加载门店失败:', e);
      this.setData({
        storePickerVisible: false,
        selectedStoreId: 1,
        selectedStoreName: '门店',
        bookAheadDays: 3
      });
    }
  },

  async initStylists(storeId) {
    const sid = storeId || this.data.selectedStoreId || 1;
    try {
      const stylists = await this.callApi('getStylists', { storeId: sid });
      if (!Array.isArray(stylists) || stylists.length === 0) {
        this.setData({
          stylistId: null,
          currentId: null,
          bookingDisabled: true
        });
        return;
      }
      const stylist = stylists[0];
      this.setData({
        stylistId: stylist.id,
        currentId: stylist.id,
        currentStylistName: stylist.name || '店长',
        currentStylistRank: stylist.rank || '',
        currentStylistPhoto: stylist.photo || '',
        bookingDisabled: !hasBookableDayInWindow(stylist, this.data.bookAheadDays)
      });
    } catch (e) {
      console.error('加载发型师信息失败:', e);
    }
  },

  refineStoreCapsuleWidth() {
    wx.nextTick(() => {
      const query = this.createSelectorQuery();
      query.select('.store-capsule-name').boundingClientRect();
      query.select('.store-capsule-arrow').boundingClientRect();
      query.exec((res) => {
        const nameRect = res && res[0];
        if (!nameRect || !nameRect.width) return;
        const arrowRect = res && res[1];
        const sys = wx.getSystemInfoSync();
        const toRpx = (px) => (px / sys.windowWidth) * 750;
        const arrowRpx = arrowRect && arrowRect.width ? toRpx(arrowRect.width) : 24;
        const measured = Math.ceil(toRpx(nameRect.width) + arrowRpx + 44 + 8);
        const next = Math.min(440, Math.max(156, measured));
        if (Math.abs(next - this.data.storeCapsuleWidth) > 2) {
          this.setData({ storeCapsuleWidth: next });
        }
      });
    });
  },

  toggleStoreMenu() {
    if (!this.data.storePickerVisible) return;
    this.setData({ storeMenuVisible: !this.data.storeMenuVisible });
  },

  async onSelectStore(e) {
    const id = Number(e.currentTarget.dataset.id);
    const store = (this.data.storeList || []).find((s) => Number(s.id) === id);
    if (!store || id === this.data.selectedStoreId) {
      this.setData({ storeMenuVisible: false });
      return;
    }
    saveStoreSelection(store);
    const selectedStoreName = formatStoreName(store.name);
    this.setData({
      selectedStoreId: id,
      selectedStoreName,
      storeCapsuleWidth: estimateStoreCapsuleWidthRpx(selectedStoreName),
      bookAheadDays: clampBookAheadDays(store.bookAheadDays),
      storeMenuVisible: false,
      pageBgUrl: resolveStorePageBg(store)
    }, () => this.refineStoreCapsuleWidth());
    await this.initStylists(id);
    this.loadAnnouncement();
    if (this.data.drawerVisible) {
      this.closeDrawer();
    }
  },

  closeStoreMenu() {
    if (this.data.storeMenuVisible) {
      this.setData({ storeMenuVisible: false });
    }
  },

  async init() {
    await this.initStylists(this.data.selectedStoreId);
  },

  buildDateTabs() {
    const now = new Date();
    const count = clampBookAheadDays(this.data.bookAheadDays);
    return Array.from({ length: count }, (_, index) => {
      const d = new Date(now);
      d.setDate(now.getDate() + index);
      return {
        day: dayLabelForOffset(index),
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
      setTimeout(() => this.openConfirmModal(), 100);
      return;
    }

    this.setData({ selectedTimeSlot: [time] });
    this.openConfirmModal();
  },

  buildConfirmSummary() {
    const tab = this.data.dateTabs.find(t => t.date === this.data.selectedDate);
    const dateLabel = tab ? `${tab.day} ${tab.label}` : formatDateText(this.data.selectedDate);
    const slots = this.data.selectedTimeSlot;
    let timeLabel = '';
    if (this.data.selectedServiceType === 'dye' && slots.length > 1) {
      timeLabel = `${formatTimeDisplay(slots[0])} - ${formatTimeDisplay(slots[slots.length - 1])}`;
    } else if (slots.length) {
      timeLabel = formatTimeDisplay(slots[0]);
    }
    return {
      confirmServiceLabel: serviceTypeText(this.data.selectedServiceType),
      confirmDateLabel: dateLabel,
      confirmTimeLabel: timeLabel
    };
  },

  openConfirmModal() {
    this.setData({
      confirmModalVisible: true,
      maskVisible: true,
      ...this.buildConfirmSummary()
    }, () => syncIndexTabBar(this));
  },

  closeConfirmModal() {
    this.setData({
      confirmModalVisible: false,
      maskVisible: this.data.drawerVisible,
      selectedTimeSlot: []
    }, () => syncIndexTabBar(this));
    if (this.data.selectedDate) this.loadSlots(this.data.selectedDate, true);
  },

  async onConfirmBooking() {
    this.setData({ confirmModalVisible: false }, () => syncIndexTabBar(this));
    await this.proceedToBooking();
  },

  async proceedToBooking() {
    const verifiedPhone = getVerifiedPhone();
    if (verifiedPhone) {
      this.confirmBooking(verifiedPhone);
      return;
    }
    this.setData({
      phoneModalVisible: true,
      maskVisible: true,
      phoneError: ''
    }, () => syncIndexTabBar(this));
  },

  async checkExistingAppointmentForDate(phone, date, storeId) {
    if (!phone || !date) return null;
    const targetStoreId = Number(storeId || this.data.selectedStoreId || 1);
    try {
      const [data, stylists] = await Promise.all([
        this.callApi('queryAppointments', { phone }),
        this.callApi('getStylists', {})
      ]);
      if (!data || !data.success) return null;
      const stylistStoreMap = {};
      (Array.isArray(stylists) ? stylists : []).forEach((stylist) => {
        stylistStoreMap[stylist.id] = stylist.storeId != null ? Number(stylist.storeId) : 1;
      });
      const appointments = Array.isArray(data.appointments) ? data.appointments : [];
      const existing = appointments.find((app) => {
        if (app.date !== date) return false;
        const appStoreId = stylistStoreMap[app.stylistId] != null ? stylistStoreMap[app.stylistId] : 1;
        return appStoreId === targetStoreId;
      });
      if (!existing) return null;
      return {
        appId: existing.appId,
        message: '同一门店一天内只能预约一次'
      };
    } catch (e) {
      return null;
    }
  },

  showAlertModal(title, message, options = {}) {
    this.setData({
      alertModalVisible: true,
      alertModalTitle: title || '提示',
      alertModalMessage: message || '',
      alertModalAppId: options.appId || '',
      alertModalDateLabel: options.dateLabel || '',
      maskVisible: true
    }, () => syncIndexTabBar(this));
  },

  showBlockedBookingModal(blocked) {
    const tab = this.data.dateTabs.find(t => t.date === this.data.selectedDate);
    const dateLabel = tab ? `${tab.day} ${tab.label}` : formatDateText(this.data.selectedDate);
    this.showAlertModal('无法预约', blocked.message, { appId: blocked.appId, dateLabel });
  },

  closeAlertModal() {
    this.setData({
      alertModalVisible: false,
      alertModalTitle: '',
      alertModalMessage: '',
      alertModalAppId: '',
      alertModalDateLabel: '',
      maskVisible: this.data.drawerVisible
    }, () => syncIndexTabBar(this));
  },

  showBookingError(message) {
    const text = message || '预约失败，请刷新重试';
    if (this.data.phoneModalVisible) {
      this.setData({ phoneError: text });
      return;
    }
    this.showAlertModal('预约失败', text);
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

  buildSuccessSummary(time) {
    const tab = this.data.dateTabs.find(t => t.date === this.data.selectedDate);
    const weekday = weekdayText(this.data.selectedDate);
    const dateLabel = tab
      ? `${tab.day} ${tab.label} ${weekday}`.trim()
      : `${formatDateText(this.data.selectedDate)} ${weekday}`.trim();
    const serviceType = this.data.selectedServiceType || 'cut';
    return {
      successServiceLabel: serviceTypeText(serviceType),
      successDateLabel: dateLabel,
      successTimeLabel: buildSuccessTimeLabel(serviceType, time, this.data.selectedTimeSlot),
      successStylistName: this.data.currentStylistName || '店长',
      successStylistRank: this.data.currentStylistRank || '',
      successStylistAvatar: resolveStylistAvatar(
        { photo: this.data.currentStylistPhoto },
        serviceType
      )
    };
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

    const blocked = await this.checkExistingAppointmentForDate(
      phone,
      this.data.selectedDate,
      this.data.selectedStoreId
    );
    if (blocked) {
      this.setData({ phoneModalVisible: false });
      this.showBlockedBookingModal(blocked);
      this.setData({ selectedTimeSlot: [] });
      if (this.data.selectedDate) this.loadSlots(this.data.selectedDate, true);
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
              phoneError: '',
              ...this.buildSuccessSummary(time)
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

  buildProgressRow(app) {
    return createProgressRow(app, (action, payload) => this.callApi(action, payload), {
      formatDateText,
      timeDisplay: item => (item.serviceType === 'dye' ? item.time : String(item.time || '').split('-')[0]),
      serviceTypeText
    });
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
        confirmModalVisible: false,
        alertModalVisible: false,
        successVisible: false,
        cancelModalVisible: false,
        progressModalVisible: false,
        selectedTimeSlot: [],
        selectedServiceType: 'cut',
        storeMenuVisible: false
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
