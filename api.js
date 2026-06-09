const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Withdrawal = require('../models/Withdrawal');
const { getSetting, setSetting } = require('../models/Settings');
const { getBot } = require('../bot');
const axios = require('axios');
const crypto = require('crypto');

// Middleware: verify user session
function requireUser(req, res, next) {
  if (!req.session.telegramId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

// POST /api/verify - Device verification
router.post('/verify', async (req, res) => {
  const { telegramId, deviceHash, ipAddress } = req.body;
  if (!telegramId) return res.status(400).json({ error: 'Missing telegramId' });

  const verifyMode = await getSetting('verificationMode');

  const user = await User.findOne({ telegramId });
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (user.verified) {
    req.session.telegramId = telegramId;
    return res.json({ success: true, alreadyVerified: true });
  }

  if (verifyMode === 'device' && deviceHash) {
    // Check if device already used
    const existing = await User.findOne({ deviceHash, telegramId: { $ne: telegramId } });
    if (existing) {
      return res.status(400).json({ error: 'This device is already registered with another account.' });
    }
    user.deviceHash = deviceHash;
  }

  user.verified = true;
  user.ipAddress = ipAddress;
  await user.save();

  // Credit referrer
  if (user.referredBy) {
    const referrer = await User.findOne({ telegramId: user.referredBy });
    if (referrer) {
      const referAmount = await getSetting('referAmount');
      const prevBal = referrer.balance;
      referrer.balance += referAmount;
      referrer.totalReferred += 1;
      await referrer.save();

      const bot = getBot();
      if (bot) {
        try {
          await bot.sendMessage(referrer.telegramId,
            `🎉 *New Referral!*\n\n` +
            `Your friend joined and verified!\n` +
            `+₹${referAmount} added to your balance\n` +
            `New Balance: ₹${referrer.balance}`,
            { parse_mode: 'Markdown' }
          );
        } catch(e) {}
      }
    }
  }

  req.session.telegramId = telegramId;
  res.json({ success: true });
});

// GET /api/user - Get user data
router.get('/user', requireUser, async (req, res) => {
  const user = await User.findOne({ telegramId: req.session.telegramId });
  if (!user) return res.status(404).json({ error: 'User not found' });

  const inviteBonus = await getSetting('inviteBonus');
  const baseUrl = process.env.BASE_URL;

  res.json({
    telegramId: user.telegramId,
    firstName: user.firstName,
    username: user.username,
    balance: user.balance,
    totalReferred: user.totalReferred,
    referralCode: user.referralCode,
    inviteLink: `https://t.me/${process.env.BOT_USERNAME || 'EarnUltraMiniBot'}?start=${user.referralCode}`,
    inviteBonus,
    totalWithdrawn: user.totalWithdrawn,
    lastWithdrawal: user.lastWithdrawal,
    joinedAt: user.joinedAt
  });
});

// GET /api/leaderboard - Global & My referrals
router.get('/leaderboard', requireUser, async (req, res) => {
  const global = await User.find({})
    .sort({ totalReferred: -1 })
    .limit(50)
    .select('firstName username totalReferred telegramId');

  const user = await User.findOne({ telegramId: req.session.telegramId });
  const myReferrals = await User.find({ referredBy: req.session.telegramId })
    .sort({ joinedAt: -1 })
    .select('firstName username joinedAt balance');

  const myRank = global.findIndex(u => u.telegramId === req.session.telegramId) + 1;

  res.json({ global, myReferrals, myRank, user });
});

// GET /api/withdrawal-settings
router.get('/withdrawal-settings', requireUser, async (req, res) => {
  const minWithdrawal = await getSetting('minWithdrawal');
  const maxWithdrawal = await getSetting('maxWithdrawal');
  const withdrawalTax = await getSetting('withdrawalTax');
  const withdrawalEnabled = await getSetting('withdrawalEnabled');
  const cooldown = await getSetting('withdrawalCooldown');
  res.json({ minWithdrawal, maxWithdrawal, withdrawalTax, withdrawalEnabled, cooldown });
});

// POST /api/set-number - Save phone number
router.post('/set-number', requireUser, async (req, res) => {
  const { phoneNumber } = req.body;
  if (!phoneNumber) return res.status(400).json({ error: 'Phone number required' });
  await User.findOneAndUpdate({ telegramId: req.session.telegramId }, { phoneNumber });
  res.json({ success: true });
});

// POST /api/withdraw
router.post('/withdraw', requireUser, async (req, res) => {
  const { amount, phoneNumber } = req.body;
  const telegramId = req.session.telegramId;

  const [enabled, minW, maxW, tax, cooldownHours, apiUrl] = await Promise.all([
    getSetting('withdrawalEnabled'),
    getSetting('minWithdrawal'),
    getSetting('maxWithdrawal'),
    getSetting('withdrawalTax'),
    getSetting('withdrawalCooldown'),
    getSetting('paymentApiUrl')
  ]);

  if (!enabled) return res.status(400).json({ error: 'Withdrawals are currently disabled.' });

  const user = await User.findOne({ telegramId });
  if (!user) return res.status(404).json({ error: 'User not found' });

  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum < minW) return res.status(400).json({ error: `Minimum withdrawal is ₹${minW}` });
  if (amountNum > maxW) return res.status(400).json({ error: `Maximum withdrawal is ₹${maxW}` });
  if (user.balance < amountNum) return res.status(400).json({ error: 'Insufficient balance.' });

  // Cooldown check
  if (user.lastWithdrawal && cooldownHours > 0) {
    const diff = (Date.now() - new Date(user.lastWithdrawal).getTime()) / (1000 * 60 * 60);
    if (diff < cooldownHours) {
      const rem = (cooldownHours - diff).toFixed(1);
      return res.status(400).json({ error: `Cooldown active. Try again in ${rem} hours.` });
    }
  }

  const number = phoneNumber || user.phoneNumber;
  if (!number) return res.status(400).json({ error: 'Phone number required.' });

  const taxAmount = amountNum * (tax / 100);
  const finalAmount = amountNum - taxAmount;

  const previousBalance = user.balance;
  const newBalance = user.balance - amountNum;

  // Build API URL
  const finalApiUrl = (apiUrl || '')
    .replace('{number}', number)
    .replace('{amount}', finalAmount.toFixed(2));

  const gatewayBase = (apiUrl || '').split('/APIs')[0] || apiUrl;

  let status = 'pending';
  let gatewayResponse = {};

  const withdrawal = new Withdrawal({
    userId: user._id,
    telegramId,
    username: user.username,
    amount: amountNum,
    amountAfterTax: finalAmount,
    tax: taxAmount,
    phoneNumber: number,
    previousBalance,
    newBalance,
    status: 'pending'
  });

  try {
    const response = await axios.get(finalApiUrl, { timeout: 15000 });
    gatewayResponse = response.data;
    status = 'success';

    user.balance = newBalance;
    user.lastWithdrawal = new Date();
    user.totalWithdrawn += amountNum;
    await user.save();

    withdrawal.status = 'success';
    withdrawal.gatewayResponse = gatewayResponse;
    withdrawal.newBalance = newBalance;
    await withdrawal.save();

    // Notify payout channel
    const payoutChannel = await getSetting('payoutChannelId');
    const bot = getBot();
    if (bot && payoutChannel) {
      const msg = `💸 *Withdrawal Success!*\n\n` +
        `👤 User: ${user.firstName} (@${user.username || 'N/A'})\n` +
        `🆔 ID: ${telegramId}\n` +
        `📱 Number: ${number}\n` +
        `💰 Amount: ₹${amountNum}\n` +
        `🏦 Tax: ₹${taxAmount.toFixed(2)}\n` +
        `✅ Received: ₹${finalAmount.toFixed(2)}\n` +
        `📊 Prev Balance: ₹${previousBalance}\n` +
        `📊 New Balance: ₹${newBalance}\n` +
        `🌐 Gateway: ${gatewayBase}`;
      try { await bot.sendMessage(payoutChannel, msg, { parse_mode: 'Markdown' }); } catch(e) {}
    }

    // Notify user
    if (bot) {
      try {
        await bot.sendMessage(telegramId,
          `✅ *Withdrawal Successful!*\n\n` +
          `Amount: ₹${finalAmount.toFixed(2)}\n` +
          `To: ${number}\n` +
          `New Balance: ₹${newBalance}`,
          { parse_mode: 'Markdown' }
        );
      } catch(e) {}
    }

    return res.json({ success: true, newBalance, finalAmount });

  } catch (error) {
    status = 'failed';
    gatewayResponse = { error: error.message };
    withdrawal.status = 'failed';
    withdrawal.gatewayResponse = gatewayResponse;
    await withdrawal.save();

    const payoutChannel = await getSetting('payoutChannelId');
    const bot = getBot();
    if (bot && payoutChannel) {
      try {
        await bot.sendMessage(payoutChannel,
          `❌ *Withdrawal Failed!*\n\n` +
          `👤 User: ${user.firstName} (@${user.username || 'N/A'})\n` +
          `🆔 ID: ${telegramId}\n` +
          `💰 Amount: ₹${amountNum}\n` +
          `❗ Error: ${error.message}`,
          { parse_mode: 'Markdown' }
        );
      } catch(e) {}
    }

    return res.status(500).json({ error: 'Payment failed. Please try again.' });
  }
});

// GET /api/stats - User stats
router.get('/stats', requireUser, async (req, res) => {
  const user = await User.findOne({ telegramId: req.session.telegramId });
  if (!user) return res.status(404).json({ error: 'Not found' });

  const withdrawals = await Withdrawal.find({ telegramId: req.session.telegramId })
    .sort({ createdAt: -1 }).limit(10);

  const referrals = await User.find({ referredBy: req.session.telegramId })
    .sort({ joinedAt: -1 }).limit(10)
    .select('firstName username joinedAt');

  res.json({
    totalWithdrawn: user.totalWithdrawn,
    totalReferred: user.totalReferred,
    balance: user.balance,
    joinedAt: user.joinedAt,
    withdrawals,
    referrals
  });
});

// Admin API routes
function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Admin only' });
  next();
}

router.post('/admin/login', async (req, res) => {
  const { telegramId } = req.body;
  if (telegramId === process.env.ADMIN_ID) {
    req.session.isAdmin = true;
    req.session.telegramId = telegramId;
    return res.json({ success: true });
  }
  res.status(401).json({ error: 'Unauthorized' });
});

router.get('/admin/settings', requireAdmin, async (req, res) => {
  const keys = ['referAmount','inviteBonus','minWithdrawal','maxWithdrawal','withdrawalTax',
    'withdrawalCooldown','withdrawalEnabled','botEnabled','verificationMode',
    'paymentApiUrl','payoutChannelId','channels'];
  const result = {};
  for (const k of keys) result[k] = await getSetting(k);
  res.json(result);
});

router.post('/admin/settings', requireAdmin, async (req, res) => {
  const allowed = ['referAmount','inviteBonus','minWithdrawal','maxWithdrawal','withdrawalTax',
    'withdrawalCooldown','withdrawalEnabled','botEnabled','verificationMode',
    'paymentApiUrl','payoutChannelId'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) await setSetting(key, req.body[key]);
  }
  res.json({ success: true });
});

router.get('/admin/users', requireAdmin, async (req, res) => {
  const users = await User.find({}).sort({ joinedAt: -1 }).limit(100);
  res.json(users);
});

router.get('/admin/withdrawals', requireAdmin, async (req, res) => {
  const withdrawals = await Withdrawal.find({}).sort({ createdAt: -1 }).limit(100);
  res.json(withdrawals);
});

router.post('/admin/balance', requireAdmin, async (req, res) => {
  const { telegramId, amount, action } = req.body;
  const change = action === 'add' ? parseFloat(amount) : -parseFloat(amount);
  const user = await User.findOneAndUpdate({ telegramId }, { $inc: { balance: change } }, { new: true });
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ success: true, newBalance: user.balance });
});

module.exports = router;
