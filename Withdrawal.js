const mongoose = require('mongoose');

const withdrawalSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  telegramId: { type: String, required: true },
  username: String,
  amount: { type: Number, required: true },
  amountAfterTax: { type: Number, required: true },
  tax: { type: Number, default: 0 },
  phoneNumber: { type: String, required: true },
  status: { type: String, enum: ['pending', 'success', 'failed'], default: 'pending' },
  gatewayResponse: mongoose.Schema.Types.Mixed,
  previousBalance: Number,
  newBalance: Number,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Withdrawal', withdrawalSchema);
