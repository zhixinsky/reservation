const { callApi } = require('../../utils/api');

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

Page({
  data: {
    phone: '',
    maskedPhone: '',
    subtitleText: '授权手机号后查看预约记录',
    currentAppointments: [],
    historyAppointments: [],
    progressRows: []
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
    const phone = wx.getStorageSync('verified_phone') || '';
    if (phone && phone !== this.data.phone) {
      this.setPhone(phone);
      this.loadData();
    }
  },

  setPhone(phone) {
    this.setData({
      phone,
      maskedPhone: phone ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : '',
      subtitleText: phone ? `手机号 ${phone.slice(0, 3)}****${phone.slice(-4)}` : '授权手机号后查看预约记录'
    });
  },

  async onPhoneNumber(e) {
    if (!e.detail || !e.detail.code) {
      wx.showToast({ title: '需要授权手机号', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '验证中' });
    try {
      const data = await callApi('getPhoneNumber', { code: e.detail.code });
      wx.hideLoading();
      if (!data || !data.success || !data.phone) {
        wx.showToast({ title: (data && data.message) || '手机号验证失败', icon: 'none' });
        return;
      }
      wx.setStorageSync('verified_phone', data.phone);
      this.setPhone(data.phone);
      this.loadData();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '手机号验证失败', icon: 'none' });
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
      wx.hideLoading();
      this.setData({
        currentAppointments: this.decorateList(current && current.appointments),
        historyAppointments: this.decorateList(history && history.appointments)
      });
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
          wx.showToast({ title: data && data.success ? '已取消' : ((data && data.message) || '取消失败'), icon: data && data.success ? 'success' : 'none' });
          if (data && data.success) this.loadData();
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: '取消失败', icon: 'none' });
        }
      }
    });
  }
});
