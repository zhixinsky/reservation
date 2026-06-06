const STORAGE_KEY = 'verified_phone';

function isValidPhone(phone) {
  return /^1[3-9]\d{9}$/.test(String(phone || '').trim());
}

function getVerifiedPhone() {
  const phone = String(wx.getStorageSync(STORAGE_KEY) || '').trim();
  return isValidPhone(phone) ? phone : '';
}

function setVerifiedPhone(phone) {
  const clean = String(phone || '').trim();
  if (!isValidPhone(clean)) return false;
  wx.setStorageSync(STORAGE_KEY, clean);
  return true;
}

function clearVerifiedPhone() {
  wx.removeStorageSync(STORAGE_KEY);
}

module.exports = {
  STORAGE_KEY,
  getVerifiedPhone,
  setVerifiedPhone,
  clearVerifiedPhone,
  isValidPhone
};
