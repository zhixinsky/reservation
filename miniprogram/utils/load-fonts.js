const FONT_FAMILY = 'Noto Serif SC';

const CLOUD_FONT_ROOT =
  'cloud://reservation-d2gf73dgv8fd17503.7265-reservation-d2gf73dgv8fd17503-1435802081/fonts';

const FONT_FILES = [
  {
    filename: 'NotoSerifSC-400.woff',
    packagePath: '/pkg/font400/NotoSerifSC-400.woff',
    subPackageName: 'font400',
    weight: '400',
    mime: 'font/woff'
  },
  {
    filename: 'NotoSerifSC-700.woff',
    packagePath: '/pkg/font700/NotoSerifSC-700.woff',
    subPackageName: 'font700',
    weight: '700',
    mime: 'font/woff'
  }
];

function getFSM() {
  return wx.getFileSystemManager();
}

function access(path) {
  return new Promise((resolve, reject) => {
    getFSM().access({ path, success: resolve, fail: reject });
  });
}

function readBase64(path) {
  return new Promise((resolve, reject) => {
    getFSM().readFile({
      filePath: path,
      encoding: 'base64',
      success: res => resolve(res.data),
      fail: reject
    });
  });
}

function copyFile(srcPath, destPath) {
  return new Promise((resolve, reject) => {
    getFSM().copyFile({ srcPath, destPath, success: resolve, fail: reject });
  });
}

function saveFile(tempFilePath, filePath) {
  return new Promise((resolve, reject) => {
    getFSM().saveFile({ tempFilePath, filePath, success: resolve, fail: reject });
  });
}

function cachePath(filename) {
  return `${wx.env.USER_DATA_PATH}/${filename}`;
}

function loadSubPackage(name) {
  const loader = wx.loadSubpackage || wx.loadSubPackage;
  return new Promise((resolve, reject) => {
    if (!loader) {
      resolve();
      return;
    }
    loader({
      name,
      success: resolve,
      fail: reject
    });
  });
}

async function downloadCloudFont(filename) {
  const target = cachePath(filename);
  const fileID = `${CLOUD_FONT_ROOT}/${filename}`;
  const res = await wx.cloud.downloadFile({ fileID });
  await saveFile(res.tempFilePath, target);
  return target;
}

async function ensureFontPath(font) {
  const cached = cachePath(font.filename);
  try {
    await access(cached);
    return cached;
  } catch (e) {
    // ignore
  }

  if (font.subPackageName) {
    try {
      await loadSubPackage(font.subPackageName);
    } catch (err) {
      console.warn('[loadAppFonts] subpackage', font.subPackageName, err);
    }
  }

  try {
    await access(font.packagePath);
    await copyFile(font.packagePath, cached);
    return cached;
  } catch (e) {
    // ignore
  }

  if (wx.cloud) {
    return downloadCloudFont(font.filename);
  }

  throw new Error(`font not found: ${font.filename}`);
}

function loadFontFromBase64(base64, mime, weight) {
  return new Promise(resolve => {
    wx.loadFontFace({
      global: true,
      family: FONT_FAMILY,
      source: `url("data:${mime};charset=utf-8;base64,${base64}")`,
      desc: {
        style: 'normal',
        weight: String(weight)
      },
      success: () => resolve(true),
      fail: err => {
        console.error('[loadFontFace]', weight, err);
        resolve(false);
      }
    });
  });
}

async function loadAppFonts() {
  if (!wx.loadFontFace || !wx.getFileSystemManager) {
    return false;
  }

  let allOk = true;
  for (const font of FONT_FILES) {
    try {
      const path = await ensureFontPath(font);
      const base64 = await readBase64(path);
      const ok = await loadFontFromBase64(base64, font.mime, font.weight);
      allOk = allOk && ok;
    } catch (err) {
      console.error('[loadAppFonts]', font.filename, err);
      allOk = false;
    }
  }
  return allOk;
}

module.exports = {
  loadAppFonts,
  FONT_FAMILY
};
