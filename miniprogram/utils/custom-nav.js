function getCustomNavPaddingTop(extraRpx = 24) {
  try {
    const menuButton = wx.getMenuButtonBoundingClientRect();
    const { windowWidth } = wx.getSystemInfoSync();
    const extraPx = (extraRpx * windowWidth) / 750;
    return menuButton.bottom + extraPx;
  } catch (e) {
    return 88;
  }
}

module.exports = {
  getCustomNavPaddingTop
};
