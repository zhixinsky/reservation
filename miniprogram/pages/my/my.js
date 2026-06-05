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

Page({
  data: {
    phone: '',
    maskedPhone: '',
    subtitleText: '授权手机号后查看预约记录',
    currentAppointments: [],
    historyAppointments: []
  },

  onShow() {
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
