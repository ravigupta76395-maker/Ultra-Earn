const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  telegramId: { type: String, required: true, unique: true },
  username: String,
  firstName: String,
  lastName: String,
  balance: { type: Number, default: 0 },
  referredBy: { type: String, default: null },
  referralCode: { type: String, unique: true },
  totalReferred: { type: Number, default: 0 },
  verified: { type: Boolean, default: false },
  deviceHash: { type: String, default: null },
  ipAddress: { type: String, default: null },
  phoneNumber: { type: String, default: null },
  lastWithdrawal: { type: Date, default: null },
  totalWithdrawn: { type: Number, default: 0 },
  joinedAt: { type: Date, default: Date.now },
  channelsJoined: { type: Boolean, default: false }
});

module.exports = mongoose.model('User', userSchema);
