const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: mongoose.Schema.Types.Mixed
});

const Settings = mongoose.model('Settings', settingsSchema);

const defaults = {
  referAmount: 10,
  minWithdrawal: 50,
  maxWithdrawal: 5000,
  withdrawalTax: 0,
  withdrawalCooldown: 24,
  withdrawalEnabled: true,
  botEnabled: true,
  verificationMode: 'device',
  paymentApiUrl: 'https://ultra-pay.store/APIs/api?token=pBD22DfWxXCsYxxG34rampbRWtEDyrvK&key=mxYoHxxA07021pK&paytoNumber={number}&amount={amount}&comment=Pay',
  payoutChannelId: null,
  channels: [],
  inviteBonus: 10
};

async function getSetting(key) {
  const doc = await Settings.findOne({ key });
  if (!doc) return defaults[key] ?? null;
  return doc.value;
}

async function setSetting(key, value) {
  await Settings.findOneAndUpdate({ key }, { value }, { upsert: true });
}

module.exports = { Settings, getSetting, setSetting, defaults };
