const { COLLECTIONS, DEFAULT_SETTINGS } = require('./constants');
const { db, getOptional } = require('./db');

function mergeSettings(base, override) {
  const source = override || {};
  return {
    ...base,
    ...source,
    store: { ...base.store, ...(source.store || {}) },
    home: { banners: [], ...(base.home || {}), ...(source.home || {}) },
    booking: { ...base.booking, ...(source.booking || {}), slotStepMinutes: 15 },
    points: { ...base.points, ...(source.points || {}) },
    schedule: { ...base.schedule, ...(source.schedule || {}) }
  };
}

async function getCurrentSettings() {
  const result = await db.collection(COLLECTIONS.settings).where({ published: true }).orderBy('version', 'desc').limit(1).get();
  return mergeSettings(DEFAULT_SETTINGS, result.data && result.data[0]);
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
    home: settings.home || { banners: [] },
    booking: settings.booking,
    points: settings.points
  };
}

module.exports = { mergeSettings, getCurrentSettings, getSettingsByVersion, publicSettings };
