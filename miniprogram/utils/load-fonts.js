function loadFontFace(options) {
  return new Promise(resolve => {
    wx.loadFontFace({
      global: true,
      scopes: ['webview', 'native'],
      ...options,
      success: resolve,
      fail: () => resolve()
    });
  });
}

function loadAppFonts() {
  return Promise.all([
    loadFontFace({
      family: 'Noto Serif SC',
      source: 'url("/fonts/NotoSerifSC-400.woff2")',
      desc: {
        style: 'normal',
        weight: '400'
      }
    }),
    loadFontFace({
      family: 'Noto Serif SC',
      source: 'url("/fonts/NotoSerifSC-700.woff2")',
      desc: {
        style: 'normal',
        weight: '700'
      }
    })
  ]);
}

module.exports = {
  loadAppFonts
};
