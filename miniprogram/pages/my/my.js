const { callApi } = require('../../utils/api');
const { getCachedStore } = require('../../utils/store-context');
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
  'cloud://reservation-d2gf73dgv8fd17503.7265-reservation-d2gf73dgv8fd17503-1435802081/img/bg.png';

const HAIRCUT_BG =
  'cloud://reservation-d2gf73dgv8fd17503.7265-reservation-d2gf73dgv8fd17503-1435802081/img/haircut.png';

const PERM_BG =
  'cloud://reservation-d2gf73dgv8fd17503.7265-reservation-d2gf73dgv8fd17503-1435802081/img/perm.png';

const STYLIST_AVATAR_CUT = '/images/11.png';
const STYLIST_AVATAR_DYE = '/images/22.png';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const TAB_LABELS = {
  pendingService: '待服务',
  completed: '已完成',
  cancelled: '已取消'
};

const BOOKING_LIST_MAX_VISIBLE = 3;

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
    phone: '',
    maskedPhone: '',
    isAdmin: false,
    appointmentTab: 'pendingService',
    tabLabel: '待服务',
    displayList: [],
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
    detailVisible: false,
    detailAppointment: null,
    detailProgress: null,
    detailLoading: false,
    cancelConfirmVisible: false
  },

  onLoad() {
    this.setData({ pagePaddingTop: getCustomNavPaddingTop(24) });
    this.restorePhoneSession(false);
  },

  onShow() {
    wx.nextTick(() => {
      showTabBar(this, {
        selected: 1,
        visible: !this.data.detailVisible
      });
    });
    this.restorePhoneSession(true);
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
    this.setData({
      appointmentTab: tab,
      tabLabel: TAB_LABELS[tab] || '预约'
    });
    this.updateDisplayList();
  },

  updateDisplayList() {
    const { appointmentTab, currentAppointments, historyAppointments, stylistMap } = this.data;
    const rawList = buildDisplayList(appointmentTab, currentAppointments, historyAppointments);
    this.setData({
      displayList: this.decorateList(rawList, stylistMap)
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

    const measure = () => {
      this.createSelectorQuery()
        .select('#bookingApptCard')
        .boundingClientRect()
        .exec(res => {
          const card = res && res[0];
          if (!card || !card.height) return;
          const gapPx = (wx.getSystemInfoSync().windowWidth / 750) * 20;
          const maxHeight = Math.ceil(
            card.height * BOOKING_LIST_MAX_VISIBLE + gapPx * (BOOKING_LIST_MAX_VISIBLE - 1)
          );
          this.setData({
            bookingListScrollable: true,
            bookingListMaxHeight: maxHeight
          });
        });
    };

    wx.nextTick(measure);
    setTimeout(measure, 120);
    setTimeout(measure, 400);
  },

  updateStats(currentList, historyList) {
    this.setData({
      stats: computeStats(currentList, historyList)
    });
    this.updateDisplayList();
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
    if (cached && cached.latitude != null && cached.longitude != null) {
      return {
        name: cached.name || SHOP_INFO.name,
        phone: cached.phone || SHOP_INFO.phone,
        address: SHOP_INFO.address,
        latitude: Number(cached.latitude),
        longitude: Number(cached.longitude)
      };
    }
    return SHOP_INFO;
  },

  openStoreNavigation() {
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
    wx.makePhoneCall({
      phoneNumber: SHOP_INFO.phone,
      fail: () => {
        wx.setClipboardData({
          data: SHOP_INFO.phone,
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

  async loadData(options = {}) {
    if (!this.data.phone) return;
    const { showLoading = true } = options;
    if (showLoading) wx.showLoading({ title: '加载中' });
    try {
      const [current, history, stylists] = await Promise.all([
        callApi('queryAppointments', { phone: this.data.phone }),
        callApi('queryAppointmentHistory', { phone: this.data.phone }),
        callApi('getStylists')
      ]);
      const stylistMap = this.buildStylistMap(stylists);
      const currentAppointments = this.decorateList(current && current.appointments, stylistMap);
      const historyAppointments = this.decorateList(history && history.appointments, stylistMap);
      if (showLoading) wx.hideLoading();
      this.setData({ currentAppointments, historyAppointments, stylistMap });
      this.updateStats(currentAppointments, historyAppointments);
    } catch (err) {
      if (showLoading) wx.hideLoading();
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  decorateList(list, stylistMap = {}) {
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
        cardBgUrl: app.serviceType === 'dye' ? PERM_BG : HAIRCUT_BG,
        stylistName: stylist.name || '店长',
        stylistRank: stylist.rank || '',
        stylistAvatar: app.serviceType === 'dye' ? STYLIST_AVATAR_DYE : STYLIST_AVATAR_CUT
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
