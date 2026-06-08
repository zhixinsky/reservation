const { callApi } = require('../../utils/api');
const { getCachedStore, formatStoreName, saveStoreSelection } = require('../../utils/store-context');
const { getVerifiedPhone, setVerifiedPhone, clearVerifiedPhone } = require('../../utils/phone-auth');
const { getCustomNavPaddingTop } = require('../../utils/custom-nav');
const { showTabBar, hideTabBar } = require('../../utils/tab-bar');
const { buildProgressRow: createProgressRow } = require('../../utils/queue-progress');

const SHOP_INFO = {
  name: '欧诺造型',
  phone: '17675610733',
  address: '广州市白云区白灰场南路2号',
  latitude: 23.185396,
  longitude: 113.323372
};

const PROFILE_BG =
  'cloud://reservation-d2gf73dgv8fd17503.7265-reservation-d2gf73dgv8fd17503-1435802081/img/bg.webp';

const HAIRCUT_BG =
  'cloud://reservation-d2gf73dgv8fd17503.7265-reservation-d2gf73dgv8fd17503-1435802081/img/haircut.webp';

const PERM_BG =
  'cloud://reservation-d2gf73dgv8fd17503.7265-reservation-d2gf73dgv8fd17503-1435802081/img/perm.webp';

const { resolveStylistAvatar } = require('../../utils/stylist-avatar');

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const TAB_LABELS = {
  pendingService: '待服务',
  completed: '已完成',
  cancelled: '已取消'
};

const BOOKING_LIST_MAX_VISIBLE = 3;
const APPT_CARD_HEIGHT_RPX = 280;

function formatDateText(ymd) {
  const parts = String(ymd || '').split('-');
  if (parts.length < 3) return ymd || '';
  return `${parts[1]}/${parts[2]}`;
}

function formatDateCard(ymd) {
  const parts = String(ymd || '').split('-');
  if (parts.length < 3) return ymd || '';
  return `${Number(parts[1])}月${Number(parts[2])}日`;
}

function weekdayText(ymd) {
  const parts = String(ymd || '').split('-').map(Number);
  if (parts.length < 3) return '';
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  return WEEKDAYS[date.getDay()] || '';
}

function timeDisplay(app) {
  return app.serviceType === 'dye' ? app.time : String(app.time || '').split('-')[0];
}

function serviceTypeText(serviceType) {
  return serviceType === 'dye' ? '烫染' : '剪发';
}

function serviceDesc(serviceType) {
  return serviceType === 'dye' ? '专业烫发·染发服务' : '精致剪发·洗发造型';
}

function statusText(status) {
  if (status === 'cancelled') return '已取消';
  if (status === 'completed') return '已完成';
  return '待服务';
}

function statusClass(status) {
  if (status === 'cancelled') return 'cancelled';
  if (status === 'completed') return 'completed';
  return 'pending';
}

function computeStats(currentList, historyList) {
  const current = Array.isArray(currentList) ? currentList : [];
  const history = Array.isArray(historyList) ? historyList : [];
  return {
    pendingService: current.length,
    completed: history.filter(item => item.status === 'completed').length,
    cancelled: history.filter(item => item.status === 'cancelled').length
  };
}

function buildDisplayList(filter, currentList, historyList) {
  const current = Array.isArray(currentList) ? currentList : [];
  const history = Array.isArray(historyList) ? historyList : [];
  if (filter === 'pendingService') return current;
  if (filter === 'completed') return history.filter(item => item.status === 'completed');
  if (filter === 'cancelled') return history.filter(item => item.status === 'cancelled');
  return [];
}

Page({
  data: {
    pagePaddingTop: 88,
    profileBgUrl: PROFILE_BG,
    storeName: SHOP_INFO.name,
    phone: '',
    maskedPhone: '',
    isAdmin: false,
    appointmentTab: 'pendingService',
    tabLabel: '待服务',
    displayList: [],
    pendingDisplayList: [],
    completedDisplayList: [],
    cancelledDisplayList: [],
    haircutBgSrc: HAIRCUT_BG,
    permBgSrc: PERM_BG,
    bookingListScrollable: false,
    bookingListMaxHeight: 0,
    stats: {
      pendingService: 0,
      completed: 0,
      cancelled: 0
    },
    currentAppointments: [],
    historyAppointments: [],
    stylistMap: {},
    storeMap: {},
    detailVisible: false,
    detailAppointment: null,
    detailProgress: null,
    detailLoading: false,
    cancelConfirmVisible: false
  },

  onLoad() {
    this.setData({ pagePaddingTop: getCustomNavPaddingTop(24) });
    this.syncStoreDisplay();
    this.preloadApptCardBackgrounds();
    this.restorePhoneSession(false);
  },

  onShow() {
    this.syncStoreDisplay();
    this.refreshCachedStoreInfo();
    this.preloadApptCardBackgrounds();
    wx.nextTick(() => {
      showTabBar(this, {
        selected: 1,
        visible: !this.data.detailVisible
      });
    });
    this.restorePhoneSession(true);
  },

  preloadApptCardBackgrounds() {
    if (this._apptBgPreloadStarted) return;
    this._apptBgPreloadStarted = true;
    Promise.all([
      wx.getImageInfo({ src: HAIRCUT_BG }).catch(() => null),
      wx.getImageInfo({ src: PERM_BG }).catch(() => null)
    ]).then(([cut, perm]) => {
      const patch = {};
      if (cut && cut.path) patch.haircutBgSrc = cut.path;
      if (perm && perm.path) patch.permBgSrc = perm.path;
      if (!Object.keys(patch).length) return;
      this.setData(patch, () => {
        if (
          this.data.pendingDisplayList.length
          || this.data.completedDisplayList.length
          || this.data.cancelledDisplayList.length
        ) {
          this.updateAllDisplayLists();
        }
      });
    });
  },

  getActiveDisplayListKey(tab) {
    if (tab === 'completed') return 'completedDisplayList';
    if (tab === 'cancelled') return 'cancelledDisplayList';
    return 'pendingDisplayList';
  },

  syncStoreDisplay() {
    const cached = getCachedStore();
    const storeName = formatStoreName((cached && cached.name) || SHOP_INFO.name);
    if (storeName !== this.data.storeName) {
      this.setData({ storeName });
    }
  },

  async refreshCachedStoreInfo() {
    const cached = getCachedStore();
    if (!cached || cached.id == null) return;
    try {
      const stores = await callApi('getStores');
      const list = Array.isArray(stores) ? stores : [];
      const store = list.find((item) => Number(item.id) === Number(cached.id));
      if (store) saveStoreSelection(store);
    } catch (_) { /* ignore */ }
  },

  onHide() {
    if (this.data.detailVisible) {
      this.setData({ detailVisible: false, cancelConfirmVisible: false });
    }
  },

  restorePhoneSession(shouldLoadData) {
    const phone = getVerifiedPhone();
    if (!phone) {
      if (this.data.phone) {
        this.setData({
          phone: '',
          maskedPhone: '',
          isAdmin: false,
          stats: computeStats([], []),
          currentAppointments: [],
          historyAppointments: [],
          pendingDisplayList: [],
          completedDisplayList: [],
          cancelledDisplayList: [],
          displayList: []
        });
      }
      return;
    }
    if (phone !== this.data.phone) {
      this.setPhone(phone);
    } else {
      this.setData({ isAdmin: this.hasAdminSession() });
    }
    if (shouldLoadData) {
      this.loadData({ showLoading: false });
    }
  },

  setPhone(phone) {
    this.setData({
      phone,
      maskedPhone: phone ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : '',
      isAdmin: this.hasAdminSession()
    });
  },

  hasAdminSession() {
    const session = wx.getStorageSync('admin_session');
    return !!(session && session.sessionId && session.role === 'stylist');
  },

  saveAdminSession(session) {
    if (!session || !session.sessionId || session.role !== 'stylist') return false;
    wx.setStorageSync('admin_session', {
      sessionId: session.sessionId,
      role: session.role,
      stylistId: session.stylistId,
      stylistName: session.stylistName,
      loginTime: Date.now()
    });
    this.setData({ isAdmin: true });
    return true;
  },

  openAdminDashboard() {
    if (!this.hasAdminSession()) {
      wx.showToast({ title: '请先使用管理员手机号登录', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/admin-dashboard/admin-dashboard' });
  },

  switchAppointmentTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (!tab || tab === this.data.appointmentTab) return;
    const listKey = this.getActiveDisplayListKey(tab);
    this.setData({
      appointmentTab: tab,
      tabLabel: TAB_LABELS[tab] || '预约',
      displayList: this.data[listKey] || []
    }, () => this.scheduleBookingListMeasure());
  },

  updateAllDisplayLists() {
    const { currentAppointments, historyAppointments, stylistMap, storeMap, appointmentTab } = this.data;
    const history = Array.isArray(historyAppointments) ? historyAppointments : [];
    const pendingDisplayList = this.decorateList(currentAppointments, stylistMap, storeMap);
    const completedDisplayList = this.decorateList(
      history.filter(item => item.status === 'completed'),
      stylistMap,
      storeMap
    );
    const cancelledDisplayList = this.decorateList(
      history.filter(item => item.status === 'cancelled'),
      stylistMap,
      storeMap
    );
    const listKey = this.getActiveDisplayListKey(appointmentTab);
    this.setData({
      pendingDisplayList,
      completedDisplayList,
      cancelledDisplayList,
      displayList: listKey === 'pendingDisplayList'
        ? pendingDisplayList
        : listKey === 'completedDisplayList'
          ? completedDisplayList
          : cancelledDisplayList
    }, () => this.scheduleBookingListMeasure());
  },

  scheduleBookingListMeasure() {
    const count = this.data.displayList.length;
    if (count <= BOOKING_LIST_MAX_VISIBLE) {
      if (this.data.bookingListScrollable || this.data.bookingListMaxHeight) {
        this.setData({ bookingListScrollable: false, bookingListMaxHeight: 0 });
      }
      return;
    }

    const sys = wx.getSystemInfoSync();
    const toPx = (rpx) => (sys.windowWidth / 750) * rpx;
    const cardPx = toPx(APPT_CARD_HEIGHT_RPX);
    const gapPx = toPx(20);
    const maxHeight = Math.ceil(
      cardPx * BOOKING_LIST_MAX_VISIBLE + gapPx * (BOOKING_LIST_MAX_VISIBLE - 1)
    );
    this.setData({
      bookingListScrollable: true,
      bookingListMaxHeight: maxHeight
    });
  },

  updateStats(currentList, historyList) {
    this.setData({
      stats: computeStats(currentList, historyList)
    });
    this.updateAllDisplayLists();
  },

  goToBooking() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  async viewAppointmentDetail(e) {
    const id = e.currentTarget.dataset.id;
    const app = this.data.displayList.find(item => String(item.id) === String(id));
    if (!app) return;

    this.setData({
      detailVisible: true,
      detailAppointment: app,
      detailProgress: null,
      detailLoading: true,
      cancelConfirmVisible: false
    });
    hideTabBar(this);

    try {
      const progress = await createProgressRow(app, callApi, {
        formatDateText,
        timeDisplay,
        serviceTypeText
      });
      this.setData({ detailProgress: progress, detailLoading: false });
    } catch (err) {
      this.setData({
        detailLoading: false,
        detailProgress: {
          delayLine1: '暂无法获取排队信息',
          delayLine2: '请联系商家确认进度',
          statusLevel: 'contact',
          statusText: '建议联系商家',
          showStatus: true,
          showHint: false,
          hasAheadCount: false
        }
      });
    }
  },

  closeDetail() {
    this.setData({
      detailVisible: false,
      detailAppointment: null,
      detailProgress: null,
      detailLoading: false,
      cancelConfirmVisible: false
    });
    showTabBar(this, { selected: 1 });
  },

  refreshDetailProgress() {
    const app = this.data.detailAppointment;
    if (!app) return;
    this.setData({ detailLoading: true });
    createProgressRow(app, callApi, {
      formatDateText,
      timeDisplay,
      serviceTypeText
    }).then(progress => {
      this.setData({ detailProgress: progress, detailLoading: false });
    }).catch(() => {
      this.setData({ detailLoading: false });
      wx.showToast({ title: '刷新失败', icon: 'none' });
    });
  },

  showCancelConfirm() {
    this.setData({ cancelConfirmVisible: true });
  },

  hideCancelConfirm() {
    this.setData({ cancelConfirmVisible: false });
  },

  confirmDetailCancel() {
    const app = this.data.detailAppointment;
    if (!app || !app.canCancel) return;
    this.doCancel(app.id, true);
  },

  getShopInfo() {
    const cached = getCachedStore();
    if (cached) {
      return {
        name: cached.name || SHOP_INFO.name,
        phone: cached.phone || SHOP_INFO.phone,
        address: cached.address || SHOP_INFO.address,
        latitude: cached.latitude != null ? Number(cached.latitude) : SHOP_INFO.latitude,
        longitude: cached.longitude != null ? Number(cached.longitude) : SHOP_INFO.longitude
      };
    }
    return SHOP_INFO;
  },

  async openStoreNavigation() {
    await this.refreshCachedStoreInfo();
    const shop = this.getShopInfo();
    if (wx.openLocation && shop.latitude && shop.longitude) {
      wx.openLocation({
        latitude: shop.latitude,
        longitude: shop.longitude,
        scale: 18,
        name: shop.name,
        address: shop.address || shop.name,
        fail: () => this.copyStoreAddress(shop)
      });
      return;
    }
    this.copyStoreAddress(shop);
  },

  copyStoreAddress(shop) {
    const info = shop || this.getShopInfo();
    const text = info.address || `${info.name}（请在地图搜索门店名称导航）`;
    wx.setClipboardData({
      data: text,
      success: () => {
        wx.showModal({
          title: '门店地址',
          content: `${text}\n\n地址已复制，可在地图中搜索导航。`,
          showCancel: false
        });
      }
    });
  },

  contactService() {
    const phone = this.getShopInfo().phone || SHOP_INFO.phone;
    wx.makePhoneCall({
      phoneNumber: phone,
      fail: () => {
        wx.setClipboardData({
          data: phone,
          success: () => wx.showToast({ title: '商家电话已复制', icon: 'none' })
        });
      }
    });
  },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '确定退出当前手机号登录吗？',
      success: res => {
        if (!res.confirm) return;
        clearVerifiedPhone();
        wx.removeStorageSync('admin_session');
        this.setData({
          phone: '',
          maskedPhone: '',
          isAdmin: false,
          appointmentTab: 'pendingService',
          tabLabel: '待服务',
          displayList: [],
          stats: computeStats([], []),
          currentAppointments: [],
          historyAppointments: []
        });
        showTabBar(this, { selected: 1 });
      }
    });
  },

  async onPhoneNumber(e) {
    if (!e.detail || !e.detail.code) {
      wx.showToast({ title: '需要手机号快速登录', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '登录中' });
    try {
      const data = await callApi('getPhoneNumber', { code: e.detail.code });
      wx.hideLoading();
      if (!data || !data.success || !data.phone) {
        wx.showToast({ title: (data && data.message) || '手机号登录失败', icon: 'none' });
        return;
      }
      setVerifiedPhone(data.phone);
      this.setPhone(data.phone);
      if (data.isAdmin) {
        this.saveAdminSession(data.adminSession);
      }
      this.loadData({ showLoading: true });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '手机号登录失败', icon: 'none' });
    }
  },

  buildStylistMap(stylists) {
    const map = {};
    (Array.isArray(stylists) ? stylists : []).forEach(stylist => {
      map[stylist.id] = stylist;
    });
    return map;
  },

  buildStoreMap(stores) {
    const map = {};
    (Array.isArray(stores) ? stores : []).forEach(store => {
      if (store && store.id != null) {
        map[Number(store.id)] = formatStoreName(store.name);
      }
    });
    return map;
  },

  resolveStoreName(stylist, storeMap = {}) {
    const storeId = stylist && stylist.storeId != null ? Number(stylist.storeId) : null;
    if (storeId != null && storeMap[storeId]) return storeMap[storeId];
    return formatStoreName(SHOP_INFO.name);
  },

  async loadData(options = {}) {
    if (!this.data.phone) return;
    const { showLoading = true } = options;
    if (showLoading) wx.showLoading({ title: '加载中' });
    try {
      const [current, history, stylists, stores] = await Promise.all([
        callApi('queryAppointments', { phone: this.data.phone }),
        callApi('queryAppointmentHistory', { phone: this.data.phone }),
        callApi('getStylists'),
        callApi('getStores')
      ]);
      const stylistMap = this.buildStylistMap(stylists);
      const storeMap = this.buildStoreMap(stores);
      const currentAppointments = this.decorateList(current && current.appointments, stylistMap, storeMap);
      const historyAppointments = this.decorateList(history && history.appointments, stylistMap, storeMap);
      if (showLoading) wx.hideLoading();
      this.setData({ currentAppointments, historyAppointments, stylistMap, storeMap });
      this.updateStats(currentAppointments, historyAppointments);
    } catch (err) {
      if (showLoading) wx.hideLoading();
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  resolveCardBgUrl(serviceType) {
    return serviceType === 'dye'
      ? (this.data.permBgSrc || PERM_BG)
      : (this.data.haircutBgSrc || HAIRCUT_BG);
  },

  decorateList(list, stylistMap = {}, storeMap = {}) {
    return (Array.isArray(list) ? list : []).map(app => {
      const stylist = stylistMap[app.stylistId] || {};
      const cardStatusText = statusText(app.status);
      return {
        ...app,
        dateText: formatDateText(app.date),
        dateCardText: formatDateCard(app.date),
        weekdayText: weekdayText(app.date),
        timeDisplay: timeDisplay(app),
        serviceTypeText: serviceTypeText(app.serviceType),
        serviceDesc: serviceDesc(app.serviceType),
        statusText: cardStatusText,
        cardStatusText,
        statusClass: statusClass(app.status),
        cardBgUrl: this.resolveCardBgUrl(app.serviceType),
        stylistName: stylist.name || '店长',
        stylistRank: stylist.rank || '',
        stylistAvatar: resolveStylistAvatar(stylist, app.serviceType),
        storeName: this.resolveStoreName(stylist, storeMap)
      };
    });
  },

  async doCancel(id, closeDetailAfterSuccess = false) {
    wx.showLoading({ title: '取消中' });
    try {
      const data = await callApi('cancelAppointments', { appointmentIds: [id] });
      wx.hideLoading();
      wx.showToast({
        title: data && data.success ? '已取消' : ((data && data.message) || '取消失败'),
        icon: data && data.success ? 'success' : 'none'
      });
      if (data && data.success) {
        if (closeDetailAfterSuccess) this.closeDetail();
        this.loadData({ showLoading: false });
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '取消失败', icon: 'none' });
    }
  }
});
