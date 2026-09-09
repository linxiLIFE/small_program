const { COLLECTIONS, DEFAULT_SETTINGS } = require('./constants');
const { db, getOptional } = require('./db');

function mergeSettings(base, override) {
  const source = override || {};
  return {
    ...base,
    ...source,
    store: { ...base.store, ...(source.store || {}) },
    booking: { ...base.booking, ...(source.booking || {}) },
    points: { ...base.points, ...(source.points || {}) },
    schedule: { ...base.schedule, ...(source.schedule || {}) }
  };
}

async function getCurrentSettings() {
  try {
    const result = await db.collection(COLLECTIONS.settings).where({ published: true }).orderBy('version', 'desc').limit(1).get();
    return mergeSettings(DEFAULT_SETTINGS, result.data && result.data[0]);
  } catch (error) {
    console.warn('读取 settings_versions 失败，使用默认规则', error.message || error);
    return mergeSettings(DEFAULT_SETTINGS);
  }
}

async function getSettingsByVersion(version) {
  if (!version) return getCurrentSettings();
  const record = await getOptional(COLLECTIONS.settings, `v${version}`);
  return mergeSettings(DEFAULT_SETTINGS, record || {});
}

function publicSettings(settings) {
  return {
    version: settings.version,
    timezone: settings.timezone,
    store: settings.store,
    booking: settings.booking,
    points: settings.points
  };
}

module.exports = { mergeSettings, getCurrentSettings, getSettingsByVersion, publicSettings };
