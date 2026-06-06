const { callApi } = require('../../utils/api');

Page({
  data: {
    username: '',
    password: '',
    loading: false,
    error: '',
    keyboardHeight: 0,
    cardTop: 0,
    cardPositionReady: false
  },

  onLoad() {
    if (wx.onKeyboardHeightChange) {
      this._onKeyboardHeightChange = res => {
        const keyboardHeight = res.height || 0;
        if (keyboardHeight) {
          this.placeCardAboveKeyboard(keyboardHeight);
        } else {
          this.setData({ keyboardHeight: 0 }, () => this.placeCardAtRest());
        }
      };
      wx.onKeyboardHeightChange(this._onKeyboardHeightChange);
    }
  },

  onReady() {
    this.placeCardAtRest();
  },

  onUnload() {
    if (this._onKeyboardHeightChange && wx.offKeyboardHeightChange) {
      wx.offKeyboardHeightChange(this._onKeyboardHeightChange);
    }
  },

  noop() {},

  placeCardAtRest() {
    wx.nextTick(() => {
      const query = this.createSelectorQuery();
      query.select('.login-card').boundingClientRect();
      query.exec(res => {
        const card = res && res[0];
        if (!card) return;
        const sys = wx.getSystemInfoSync();
        const cardTop = Math.max(16, Math.floor((sys.windowHeight - card.height) / 2));
        this.setData({ cardTop, cardPositionReady: true });
      });
    });
  },

  placeCardAboveKeyboard(keyboardHeight) {
    wx.nextTick(() => {
      const query = this.createSelectorQuery();
      query.select('.login-card').boundingClientRect();
      query.exec(res => {
        const card = res && res[0];
        if (!card) return;
        const sys = wx.getSystemInfoSync();
        const visibleBottom = sys.windowHeight - keyboardHeight - 16;
        const minTop = 16;
        const cardTop = Math.max(minTop, Math.floor(visibleBottom - card.height));
        this.setData({ keyboardHeight, cardTop });
      });
    });
  },

  onUsernameInput(e) {
    this.setData({ username: e.detail.value, error: '' });
  },

  onPasswordInput(e) {
    this.setData({ password: e.detail.value, error: '' });
  },

  callApi(action, payload = {}) {
    return callApi(action, payload);
  },

  async login() {
    const username = String(this.data.username || '').trim();
    const password = String(this.data.password || '').trim();
    if (!username || !password) {
      this.setData({ error: '请输入用户名和密码' });
      return;
    }

    this.setData({ loading: true, error: '' });
    try {
      const data = await this.callApi('adminLogin', { username, password });
      if (data && data.success && data.role === 'stylist') {
        wx.setStorageSync('admin_session', {
          sessionId: data.sessionId,
          role: data.role,
          stylistId: data.stylistId,
          stylistName: data.stylistName,
          loginTime: Date.now()
        });
        wx.redirectTo({ url: '/pages/admin-dashboard/admin-dashboard' });
      } else {
        this.setData({ error: (data && data.message) || '登录失败，请检查用户名和密码' });
      }
    } catch (e) {
      this.setData({ error: '网络错误，请稍后重试' });
    } finally {
      this.setData({ loading: false });
    }
  }
});
