const { callApi } = require('../../utils/api');
const { getVerifiedPhone, setVerifiedPhone, clearVerifiedPhone } = require('../../utils/phone-auth');

const SHOP_INFO = {
  name: '欧诺造型',
  phone: '17675610733',
  address: '广州市白云区白灰场南路2号'
};

const PROFILE_BG =
  'cloud://reservation-d2gf73dgv8fd17503.7265-reservation-d2gf73dgv8fd17503-1435802081/img/bg.png';

function formatDateText(ymd) {
  const parts = String(ymd || '').split('-');
  if (parts.length < 3) return ymd || '';
  return `${parts[1]}/${parts[2]}`;
}

function timeDisplay(app) {
  return app.serviceType === 'dye' ? app.time : String(app.time || '').split('-')[0];
}

function serviceTypeText(serviceType) {
  return serviceType === 'dye' ? '烫染' : '剪发';
}

function statusText(status) {
  if (status === 'cancelled') return '已取消';
  if (status === 'completed') return '已完成';
  return '已预约';
}

function ymdFromDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatWaitTime(totalMinutes) {
  if (totalMinutes <= 0) return { line2: '到店后预计准时' };
  if (totalMinutes < 60) return { line2: '按您预约时间到店需等待 ', numberPart: `${totalMinutes} 分钟` };
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (m === 0) return { line2: '按您预约时间到店需等待 ', numberPart: `${h} 小时` };
  return { line2: '按您预约时间到店需等待 ', numberPart: `${h} 小时 ${m} 分钟` };
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

function buildDetailList(filter, currentList, historyList) {
  const current = Array.isArray(currentList) ? currentList : [];
  const history = Array.isArray(historyList) ? historyList : [];
  if (filter === 'pendingService') return current;
  if (filter === 'completed') return history.filter(item => item.status === 'completed');
  if (filter === 'cancelled') return history.filter(item => item.status === 'cancelled');
  return [];
}

const DETAIL_TITLES = {
  all: '我的预约',
  pendingService: '待服务',
  completed: '已完成',
  cancelled: '已取消'
};

Page({
  data: {
    profileBgUrl: PROFILE_BG,
    phone: '',
    maskedPhone: '',
    detailVisible: false,
    detailFilter: 'all',
    detailTitle: '我的预约',
    detailList: [],
    stats: {
      pendingService: 0,
      completed: 0,
      cancelled: 0
    },
    currentAppointments: [],
    historyAppointments: [],
    progressRows: []
  },

  onLoad() {
    this.restorePhoneSession(false);
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1, visible: !this.data.detailVisible });
    }
    this.restorePhoneSession(true);
  },

  onHide() {
    if (this.data.detailVisible) {
      this.setData({ detailVisible: false });
    }
  },

  restorePhoneSession(shouldLoadData) {
    const phone = getVerifiedPhone();
    if (!phone) {
      if (this.data.phone) {
        this.setData({
          phone: '',
          maskedPhone: '',
          stats: computeStats([], []),
          currentAppointments: [],
          historyAppointments: [],
          progressRows: []
        });
      }
      return;
    }
    if (phone !== this.data.phone) {
      this.setPhone(phone);
    }
    if (shouldLoadData) {
      this.loadData();
    }
  },

  setPhone(phone) {
    this.setData({
      phone,
      maskedPhone: phone ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : ''
    });
  },

  updateStats(currentList, historyList) {
    this.setData({
      stats: computeStats(currentList, historyList)
    });
    this.refreshDetailListIfOpen();
  },

  refreshDetailListIfOpen() {
    const { detailVisible, detailFilter, currentAppointments, historyAppointments } = this.data;
    if (!detailVisible || detailFilter === 'all') return;
    this.setData({
      detailList: buildDetailList(detailFilter, currentAppointments, historyAppointments)
    });
  },

  openStatsDetail(e) {
    const type = e.currentTarget.dataset.type;
    if (!type) return;
    this.openDetailPanel(type);
  },

  async openAllAppointments() {
    await this.openDetailPanel('all');
  },

  async openDetailPanel(filter) {
    if (!this.data.phone) {
      wx.showToast({ title: '请先手机号快速登录', icon: 'none' });
      return;
    }
    if (!this.data.currentAppointments.length && !this.data.historyAppointments.length) {
      await this.loadData();
    }
    const detailList = buildDetailList(filter, this.data.currentAppointments, this.data.historyAppointments);
    this.setData({
      detailVisible: true,
      detailFilter: filter,
      detailTitle: DETAIL_TITLES[filter] || '我的预约',
      detailList
    });
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ visible: false });
    }
    if (filter === 'pendingService') {
      this.loadProgress(false);
    }
  },

  closeAllAppointments() {
    this.setData({
      detailVisible: false,
      detailFilter: 'all',
      detailTitle: '我的预约',
      detailList: []
    });
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ visible: true, selected: 1 });
    }
  },

  openStoreNavigation() {
    wx.setClipboardData({
      data: SHOP_INFO.address,
      success: () => {
        wx.showModal({
          title: '门店地址',
          content: `${SHOP_INFO.address}\n\n地址已复制，可在地图中搜索导航。`,
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
          success: () => wx.showToast({ title: '客服电话已复制', icon: 'none' })
        });
      }
    });
  },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '确定退出当前手机号登录吗？',
      success: (res) => {
        if (!res.confirm) return;
        clearVerifiedPhone();
        this.setData({
          phone: '',
          maskedPhone: '',
          detailVisible: false,
          detailFilter: 'all',
          detailTitle: '我的预约',
          detailList: [],
          stats: computeStats([], []),
          currentAppointments: [],
          historyAppointments: [],
          progressRows: []
        });
        if (typeof this.getTabBar === 'function' && this.getTabBar()) {
          this.getTabBar().setData({ visible: true, selected: 1 });
        }
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
      this.loadData();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '手机号登录失败', icon: 'none' });
    }
  },

  async loadData() {
    if (!this.data.phone) return;
    wx.showLoading({ title: '加载中' });
    try {
      const [current, history] = await Promise.all([
        callApi('queryAppointments', { phone: this.data.phone }),
        callApi('queryAppointmentHistory', { phone: this.data.phone })
      ]);
      const currentAppointments = this.decorateList(current && current.appointments);
      const historyAppointments = this.decorateList(history && history.appointments);
      wx.hideLoading();
      this.setData({ currentAppointments, historyAppointments });
      this.updateStats(currentAppointments, historyAppointments);
      await this.loadProgress(false);
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  decorateList(list) {
    return (Array.isArray(list) ? list : []).map(app => ({
      ...app,
      dateText: formatDateText(app.date),
      timeDisplay: timeDisplay(app),
      serviceTypeText: serviceTypeText(app.serviceType),
      statusText: statusText(app.status)
    }));
  },

  async loadProgress(showLoading = true) {
    if (!this.data.phone) return;
    if (showLoading) wx.showLoading({ title: '查询中' });
    try {
      const data = await callApi('queryAppointments', { phone: this.data.phone });
      const appointments = Array.isArray(data && data.appointments) ? data.appointments : [];
      const rows = [];
      for (const app of appointments) {
        rows.push(await this.buildProgressRow(app));
      }
      if (showLoading) wx.hideLoading();
      this.setData({ progressRows: rows });
    } catch (err) {
      if (showLoading) wx.hideLoading();
      wx.showToast({ title: '排队查询失败', icon: 'none' });
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
        const queue = await callApi('getDayQueue', {
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
      } catch (err) {
        delayLine1 = '暂无排队信息';
      }
    }

    return {
      key: `${app.id || app.appId}-${app.date}-${app.time}`,
      dateStr: formatDateText(app.date),
      timeDisplay: timeDisplay(app),
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

  cancelOne(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '取消预约',
      content: '确定取消该预约吗？',
      success: async res => {
        if (!res.confirm) return;
        wx.showLoading({ title: '取消中' });
        try {
          const data = await callApi('cancelAppointments', { appointmentIds: [id] });
          wx.hideLoading();
          wx.showToast({
            title: data && data.success ? '已取消' : ((data && data.message) || '取消失败'),
            icon: data && data.success ? 'success' : 'none'
          });
          if (data && data.success) this.loadData();
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: '取消失败', icon: 'none' });
        }
      }
    });
  }
});
