/**
 * @typedef {Object} Service
 * @property {string} id
 * @property {string} categoryId
 * @property {string} categoryName
 * @property {string} name
 * @property {number} priceFen
 * @property {number} durationMinutes
 * @property {number} bufferMinutes
 * @property {string} description
 * @property {string} coverUrl
 */

/**
 * @typedef {Object} Technician
 * @property {string} id
 * @property {string} name
 * @property {string} title
 * @property {string} bio
 * @property {string[]} skills
 * @property {string} avatarUrl
 */

/**
 * @typedef {Object} Quote
 * @property {string} quoteId
 * @property {number} totalFen
 * @property {number} discountFen
 * @property {number} paidFen
 * @property {number} pointsToUse
 * @property {number} expiresAt
 */

/**
 * @typedef {Object} Order
 * @property {string} id
 * @property {string} status
 * @property {string} statusLabel
 * @property {string} serviceName
 * @property {string} technicianName
 * @property {number} startAt
 * @property {number} totalFen
 * @property {number} discountFen
 * @property {number} paidFen
 * @property {number} pointsUsed
 * @property {string} refundStatus
 */

module.exports = {};
