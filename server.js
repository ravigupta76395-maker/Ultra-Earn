const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const axios = require('axios');

const BOT_USERNAME = 'EarnUltra_Bot';

const app = express();
app.use(cors());
app.use(express.json());

// ─── TELEGRAM ONLY REDIRECT ────────────────────────────────────────────────
// Koi bhi browser se root open kare → Telegram bot pe redirect
app.get('/', (req, res) => {
  const hasTid = req.query.tid;
  const ua = req.headers['user-agent'] || '';
  const isTelegramBot = ua.includes('TelegramBot');
  if (hasTid || isTelegramBot) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  return res.redirect(301, `https://t.me/${BOT_USERNAME}`);
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://rg15756448_db_user:UD56WE02WvpJ5215@cluster0.nss1pnd.mongodb.net/referapp?retryWrites=true&w=majority&appName=Cluster0');

// ─── SCHEMAS ───────────────────────────────────────────────────────────────

const UserSchema = new mongoose.Schema({
  telegramId: { type: String, unique: true },
  username: String,
  firstName: String,
  lastName: String,
  balance: { type: Number, default: 0 },
  referralCode: { type: String, unique: true },
  referredBy: String,
  deviceId: { type: String, unique: true, sparse: true },
  ipAddress: String,
  verified: { type: Boolean, default: false },
  verificationMethod: String,
  joinedAt: { type: Date, default: Date.now },
  lastSeen: { type: Date, default: Date.now },
  totalWithdrawn: { type: Number, default: 0 },
  referralCount: { type: Number, default: 0 },
});

const SettingsSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  value: mongoose.Schema.Types.Mixed,
});

const WithdrawalSchema = new mongoose.Schema({
  telegramId: String,
  username: String,
  amount: Number,
  number: String,
  status: { type: String, default: 'pending' }, // pending, success, failed
  gateway: String,
  apiResponse: String,
  previousBalance: Number,
  newBalance: Number,
  createdAt: { type: Date, default: Date.now },
});

const ReferralSchema = new mongoose.Schema({
  referrerId: String,
  referredId: String,
  amount: Number,
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.model('User', UserSchema);
const Settings = mongoose.model('Settings', SettingsSchema);
const Withdrawal = mongoose.model('Withdrawal', WithdrawalSchema);
const Referral = mongoose.model('Referral', ReferralSchema);

// ─── HELPER FUNCTIONS ──────────────────────────────────────────────────────

async function getSetting(key, defaultVal = null) {
  const s = await Settings.findOne({ key });
  return s ? s.value : defaultVal;
}

async function setSetting(key, value) {
  await Settings.findOneAndUpdate({ key }, { key, value }, { upsert: true });
}

function generateReferralCode(telegramId) {
  return crypto.createHash('md5').update(telegramId + Date.now()).digest('hex').substring(0, 8).toUpperCase();
}

function generateDeviceId(fingerprint) {
  return crypto.createHash('sha256').update(fingerprint).digest('hex');
}

async function sendTelegramMessage(chatId, text, keyboard = null) {
  const botToken = await getSetting('botToken');
  if (!botToken) return;
  const payload = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (keyboard) payload.reply_markup = { inline_keyboard: keyboard };
  try {
    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, payload);
  } catch (e) {
    console.error('TG send error:', e.message);
  }
}

async function sendToPayoutChannel(message) {
  const channelId = await getSetting('payoutChannel');
  if (!channelId) return;
  await sendTelegramMessage(channelId, message);
}

async function checkChannelMembership(userId) {
  const channel = await getSetting('requiredChannel');
  if (!channel) return true;
  const botToken = await getSetting('botToken');
  if (!botToken) return true;
  try {
    const res = await axios.get(`https://api.telegram.org/bot${botToken}/getChatMember`, {
      params: { chat_id: channel, user_id: userId }
    });
    const status = res.data.result?.status;
    return ['member', 'administrator', 'creator'].includes(status);
  } catch {
    return false;
  }
}

// ─── DEFAULT SETTINGS INIT ─────────────────────────────────────────────────

async function initDefaults() {
  const defaults = {
    botToken: '',
    referAmount: 10,
    minWithdrawal: 50,
    maxWithdrawal: 500,
    withdrawalEnabled: true,
    botEnabled: true,
    verificationMode: 'device', // device, ip, captcha, none
    requiredChannel: '',
    payoutChannel: '',
    withdrawalApiUrl: 'https://ultra-pay.store/APIs/api?token=pBD22DfWxXCsYxxG34rampbRWtEDyrvK&key=mxYoHxxA07021pK&paytoNumber={number}&amount={amount}&comment=Pay',
    adminIds: [],
  };
  for (const [key, value] of Object.entries(defaults)) {
    const exists = await Settings.findOne({ key });
    if (!exists) await setSetting(key, value);
  }
}

// ─── AUTH MIDDLEWARE ───────────────────────────────────────────────────────

async function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (token !== (process.env.ADMIN_TOKEN || 'earnultra_admin_2024')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ═══════════════════════════════════════════════════════════════════════════
// USER APIs
// ═══════════════════════════════════════════════════════════════════════════

// Register / Login user
app.post('/api/user/init', async (req, res) => {
  try {
    const { telegramId, username, firstName, lastName, referralCode, deviceFingerprint, ipAddress } = req.body;
    
    const botEnabled = await getSetting('botEnabled', true);
    if (!botEnabled) return res.json({ success: false, error: 'Bot is currently offline.' });

    let user = await User.findOne({ telegramId: String(telegramId) });
    
    if (!user) {
      // New user
      const refCode = generateReferralCode(String(telegramId));
      user = new User({
        telegramId: String(telegramId),
        username, firstName, lastName,
        referralCode: refCode,
        ipAddress,
      });

      // Handle referral
      if (referralCode) {
        const referrer = await User.findOne({ referralCode });
        if (referrer && referrer.telegramId !== String(telegramId)) {
          user.referredBy = referrer.telegramId;
        }
      }
      await user.save();
    }

    user.lastSeen = new Date();
    await user.save();

    // Check channel membership
    const channelJoined = await checkChannelMembership(telegramId);
    const verificationMode = await getSetting('verificationMode', 'device');
    const requiredChannel = await getSetting('requiredChannel', '');

    res.json({
      success: true,
      user: {
        telegramId: user.telegramId,
        username: user.username,
        firstName: user.firstName,
        balance: user.balance,
        referralCode: user.referralCode,
        verified: user.verified,
        referralCount: user.referralCount,
        totalWithdrawn: user.totalWithdrawn,
      },
      channelJoined,
      requiredChannel,
      verificationMode,
      needsVerification: !user.verified,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verify device
app.post('/api/user/verify', async (req, res) => {
  try {
    const { telegramId, deviceFingerprint, ipAddress } = req.body;
    const user = await User.findOne({ telegramId: String(telegramId) });
    if (!user) return res.json({ success: false, error: 'User not found' });
    if (user.verified) return res.json({ success: true, alreadyVerified: true });

    const verificationMode = await getSetting('verificationMode', 'device');

    if (verificationMode === 'device') {
      const deviceId = generateDeviceId(deviceFingerprint || telegramId);
      const existing = await User.findOne({ deviceId, telegramId: { $ne: String(telegramId) } });
      if (existing) {
        return res.json({ success: false, error: 'This device is already registered with another account.' });
      }
      user.deviceId = deviceId;
    } else if (verificationMode === 'ip') {
      const existing = await User.findOne({ ipAddress, telegramId: { $ne: String(telegramId) }, verified: true });
      if (existing) {
        return res.json({ success: false, error: 'This IP is already used by another verified account.' });
      }
      user.ipAddress = ipAddress;
    }

    user.verified = true;
    user.verificationMethod = verificationMode;

    // Credit referral bonus
    if (user.referredBy) {
      const referAmount = await getSetting('referAmount', 10);
      const referrer = await User.findOne({ telegramId: user.referredBy });
      if (referrer) {
        referrer.balance += referAmount;
        referrer.referralCount += 1;
        await referrer.save();

        await new Referral({
          referrerId: referrer.telegramId,
          referredId: user.telegramId,
          amount: referAmount,
        }).save();

        // Notify referrer
        await sendTelegramMessage(referrer.telegramId, 
          `🎉 <b>Referral Bonus!</b>\n\n👤 ${user.firstName || user.username} joined using your link!\n💰 +₹${referAmount} added to your balance!\n\n💼 New Balance: ₹${referrer.balance}`
        );
      }
    }

    await user.save();
    res.json({ success: true, user: { balance: user.balance, verified: true } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get user data
app.get('/api/user/:telegramId', async (req, res) => {
  try {
    const user = await User.findOne({ telegramId: req.params.telegramId });
    if (!user) return res.json({ success: false });
    res.json({
      success: true,
      user: {
        telegramId: user.telegramId,
        username: user.username,
        firstName: user.firstName,
        balance: user.balance,
        referralCode: user.referralCode,
        verified: user.verified,
        referralCount: user.referralCount,
        totalWithdrawn: user.totalWithdrawn,
        joinedAt: user.joinedAt,
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Leaderboard
app.get('/api/leaderboard', async (req, res) => {
  try {
    const users = await User.find({ referralCount: { $gt: 0 } })
      .sort({ referralCount: -1 })
      .limit(50)
      .select('telegramId firstName username referralCount');
    res.json({ success: true, leaderboard: users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// My referrals
app.get('/api/referrals/:telegramId', async (req, res) => {
  try {
    const referrals = await Referral.find({ referrerId: req.params.telegramId }).sort({ createdAt: -1 });
    const referred = [];
    for (const r of referrals) {
      const u = await User.findOne({ telegramId: r.referredId }).select('firstName username joinedAt');
      referred.push({
        user: u,
        amount: r.amount,
        date: r.createdAt,
      });
    }
    res.json({ success: true, referrals: referred });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Withdrawal request
app.post('/api/withdraw', async (req, res) => {
  try {
    const { telegramId, amount, number } = req.body;
    
    const withdrawalEnabled = await getSetting('withdrawalEnabled', true);
    if (!withdrawalEnabled) return res.json({ success: false, error: 'Withdrawals are currently disabled.' });

    const user = await User.findOne({ telegramId: String(telegramId) });
    if (!user) return res.json({ success: false, error: 'User not found' });
    if (!user.verified) return res.json({ success: false, error: 'Please verify your device first.' });

    const minW = await getSetting('minWithdrawal', 50);
    const maxW = await getSetting('maxWithdrawal', 500);

    if (amount < minW) return res.json({ success: false, error: `Minimum withdrawal is ₹${minW}` });
    if (amount > maxW) return res.json({ success: false, error: `Maximum withdrawal is ₹${maxW}` });
    if (user.balance < amount) return res.json({ success: false, error: 'Insufficient balance' });

    const apiUrl = await getSetting('withdrawalApiUrl', '');
    const previousBalance = user.balance;
    const newBalance = user.balance - amount;

    // Process via API
    let apiResponse = 'No gateway configured';
    let status = 'failed';

    if (apiUrl) {
      const finalUrl = apiUrl
        .replace('{number}', encodeURIComponent(number))
        .replace('{amount}', amount);
      try {
        const apiRes = await axios.get(finalUrl, { timeout: 15000 });
        apiResponse = JSON.stringify(apiRes.data);
        status = 'success';
        user.balance = newBalance;
        user.totalWithdrawn += amount;
        await user.save();
      } catch (apiErr) {
        apiResponse = apiErr.message;
        status = 'failed';
      }
    }

    const withdrawal = await new Withdrawal({
      telegramId: user.telegramId,
      username: user.username || user.firstName,
      amount, number, status, apiResponse, previousBalance,
      newBalance: status === 'success' ? newBalance : previousBalance,
      gateway: apiUrl ? new URL(apiUrl.split('?')[0]).hostname : 'N/A',
    }).save();

    // Send to payout channel
    const gatewayBase = apiUrl ? apiUrl.split('/APIs')[0] || apiUrl.split('?')[0] : 'N/A';
    await sendToPayoutChannel(
      `${status === 'success' ? '✅' : '❌'} <b>Withdrawal ${status.toUpperCase()}</b>\n\n` +
      `👤 User: ${user.firstName || user.username} (@${user.username})\n` +
      `🆔 ID: ${user.telegramId}\n` +
      `📱 Number: ${number}\n` +
      `💰 Amount: ₹${amount}\n` +
      `💼 Previous Balance: ₹${previousBalance}\n` +
      `💼 New Balance: ₹${status === 'success' ? newBalance : previousBalance}\n` +
      `🏦 Gateway: ${gatewayBase}\n` +
      `📋 Response: ${apiResponse.substring(0, 200)}`
    );

    // Notify user
    if (status === 'success') {
      await sendTelegramMessage(user.telegramId,
        `✅ <b>Withdrawal Successful!</b>\n\n💰 Amount: ₹${amount}\n📱 Number: ${number}\n💼 Remaining Balance: ₹${newBalance}`
      );
    } else {
      await sendTelegramMessage(user.telegramId,
        `❌ <b>Withdrawal Failed!</b>\n\nAmount: ₹${amount}\nReason: Payment gateway error. Please try again later.`
      );
    }

    res.json({ success: status === 'success', status, message: status === 'success' ? 'Withdrawal processed!' : 'Withdrawal failed. Please try again.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get settings for frontend
app.get('/api/settings/public', async (req, res) => {
  const referAmount = await getSetting('referAmount', 10);
  const minWithdrawal = await getSetting('minWithdrawal', 50);
  const maxWithdrawal = await getSetting('maxWithdrawal', 500);
  const withdrawalEnabled = await getSetting('withdrawalEnabled', true);
  const botEnabled = await getSetting('botEnabled', true);
  const requiredChannel = await getSetting('requiredChannel', '');
  res.json({ referAmount, minWithdrawal, maxWithdrawal, withdrawalEnabled, botEnabled, requiredChannel });
});

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN APIs
// ═══════════════════════════════════════════════════════════════════════════

app.post('/api/admin/login', (req, res) => {
  const { token } = req.body;
  if (token === (process.env.ADMIN_TOKEN || 'earnultra_admin_2024')) {
    res.json({ success: true, token });
  } else {
    res.json({ success: false, error: 'Invalid password' });
  }
});

app.get('/api/admin/stats', adminAuth, async (req, res) => {
  const totalUsers = await User.countDocuments();
  const verifiedUsers = await User.countDocuments({ verified: true });
  const totalWithdrawals = await Withdrawal.countDocuments();
  const successWithdrawals = await Withdrawal.countDocuments({ status: 'success' });
  const totalPaid = await Withdrawal.aggregate([{ $match: { status: 'success' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]);
  const totalReferrals = await Referral.countDocuments();
  res.json({
    success: true,
    stats: {
      totalUsers, verifiedUsers,
      totalWithdrawals, successWithdrawals,
      totalPaid: totalPaid[0]?.total || 0,
      totalReferrals,
    }
  });
});

app.get('/api/admin/users', adminAuth, async (req, res) => {
  const { page = 1, search = '' } = req.query;
  const query = search ? { $or: [{ username: new RegExp(search, 'i') }, { firstName: new RegExp(search, 'i') }, { telegramId: search }] } : {};
  const users = await User.find(query).sort({ joinedAt: -1 }).skip((page - 1) * 20).limit(20);
  const total = await User.countDocuments(query);
  res.json({ success: true, users, total, pages: Math.ceil(total / 20) });
});

app.post('/api/admin/balance', adminAuth, async (req, res) => {
  const { telegramId, amount, action } = req.body;
  const user = await User.findOne({ telegramId: String(telegramId) });
  if (!user) return res.json({ success: false, error: 'User not found' });
  if (action === 'add') user.balance += Number(amount);
  else if (action === 'remove') user.balance = Math.max(0, user.balance - Number(amount));
  else user.balance = Number(amount);
  await user.save();
  await sendTelegramMessage(user.telegramId,
    `💰 <b>Balance Update</b>\n\n${action === 'add' ? '+' : action === 'remove' ? '-' : '='}₹${amount} ${action === 'set' ? 'set as' : ''}\n💼 New Balance: ₹${user.balance}`
  );
  res.json({ success: true, newBalance: user.balance });
});

app.post('/api/admin/broadcast', adminAuth, async (req, res) => {
  const { message, target } = req.body; // target: 'bot' or 'channel'
  if (target === 'channel') {
    await sendToPayoutChannel(message);
    const channel = await getSetting('requiredChannel');
    if (channel) await sendTelegramMessage(channel, message);
    return res.json({ success: true, message: 'Sent to channel' });
  }
  const users = await User.find({}, 'telegramId');
  let sent = 0, failed = 0;
  for (const u of users) {
    try {
      await sendTelegramMessage(u.telegramId, message);
      sent++;
      await new Promise(r => setTimeout(r, 50));
    } catch { failed++; }
  }
  res.json({ success: true, sent, failed });
});

app.get('/api/admin/settings', adminAuth, async (req, res) => {
  const keys = ['botToken', 'referAmount', 'minWithdrawal', 'maxWithdrawal', 'withdrawalEnabled', 'botEnabled', 'verificationMode', 'requiredChannel', 'payoutChannel', 'withdrawalApiUrl', 'adminIds'];
  const result = {};
  for (const k of keys) result[k] = await getSetting(k);
  res.json({ success: true, settings: result });
});

app.post('/api/admin/settings', adminAuth, async (req, res) => {
  const allowed = ['botToken', 'referAmount', 'minWithdrawal', 'maxWithdrawal', 'withdrawalEnabled', 'botEnabled', 'verificationMode', 'requiredChannel', 'payoutChannel', 'withdrawalApiUrl'];
  for (const [key, value] of Object.entries(req.body)) {
    if (allowed.includes(key)) await setSetting(key, value);
  }
  res.json({ success: true });
});

app.get('/api/admin/withdrawals', adminAuth, async (req, res) => {
  const { page = 1, status } = req.query;
  const query = status ? { status } : {};
  const withdrawals = await Withdrawal.find(query).sort({ createdAt: -1 }).skip((page - 1) * 20).limit(20);
  const total = await Withdrawal.countDocuments(query);
  res.json({ success: true, withdrawals, total, pages: Math.ceil(total / 20) });
});

// Telegram webhook
app.post('/webhook/:token', async (req, res) => {
  res.sendStatus(200);
  const botToken = await getSetting('botToken');
  if (!botToken || req.params.token !== botToken) return;
  
  const { message, callback_query } = req.body;
  if (!message) return;
  
  const chatId = message.chat.id;
  const text = message.text || '';
  const botEnabled = await getSetting('botEnabled', true);
  
  if (!botEnabled) {
    return sendTelegramMessage(chatId, '🔴 Bot is currently offline. Please try later.');
  }

  if (text.startsWith('/start')) {
    const parts = text.split(' ');
    const referralCode = parts[1] || '';
    const appUrl = process.env.APP_URL || `https://your-app.vercel.app`;
    const webAppUrl = `${appUrl}?tid=${chatId}&ref=${referralCode}&fn=${encodeURIComponent(message.from.first_name || '')}&un=${encodeURIComponent(message.from.username || '')}`;
    
    await sendTelegramMessage(chatId,
      `👋 <b>Welcome to Earn Ultra!</b>\n\n💰 Invite friends and earn rewards!\n🎁 Get ₹${await getSetting('referAmount', 10)} for every friend you invite\n\nTap below to open the app 👇`,
      [[{ text: '🚀 Open Earn Ultra', web_app: { url: webAppUrl } }]]
    );
  }
});

// Setup webhook
app.post('/api/admin/setup-webhook', adminAuth, async (req, res) => {
  const botToken = await getSetting('botToken');
  const appUrl = process.env.APP_URL || req.body.appUrl;
  if (!botToken || !appUrl) return res.json({ success: false, error: 'Missing botToken or appUrl' });
  try {
    const r = await axios.post(`https://api.telegram.org/bot${botToken}/setWebhook`, {
      url: `${appUrl}/webhook/${botToken}`,
      allowed_updates: ['message', 'callback_query'],
    });
    res.json({ success: true, result: r.data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  await initDefaults();
  console.log(`Earn Ultra running on port ${PORT}`);
});
