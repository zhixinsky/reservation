const { callApi } = require('../../utils/api');

Page({
  data: {
    username: '',
    password: '',
    loading: false,
    error: '',
    keyboardHeight: 0
  },

  onLoad() {
    if (wx.onKeyboardHeightChange) {
      this._onKeyboardHeightChange = res => {
        this.setData({ keyboardHeight: res.height || 0 });
      };
      wx.onKeyboardHeightChange(this._onKeyboardHeightChange);
    }
  },

  onUnload() {
    if (this._onKeyboardHeightChange && wx.offKeyboardHeightChange) {
      wx.offKeyboardHeightChange(this._onKeyboardHeightChange);
    }
  },

  onFormFocus() {
    this.scrollLoginButtonIntoView();
  },

  scrollLoginButtonIntoView() {
    setTimeout(() => {
      wx.pageScrollTo({
        selector: '.login-btn',
        duration: 200
      });
    }, 80);
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
