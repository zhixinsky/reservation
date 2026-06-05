Component({
  data: {
    selected: 0,
    list: [
      {
        pagePath: '/pages/index/index',
        text: '预约'
      },
      {
        pagePath: '/pages/my/my',
        text: '我的'
      }
    ]
  },

  methods: {
    switchTab(e) {
      const { path, index } = e.currentTarget.dataset;
      if (index === this.data.selected) return;
      wx.switchTab({ url: path });
    }
  }
});
