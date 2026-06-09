const TelegramBot = require('node-telegram-bot-api');
const User = require('./models/User');
const { getSetting, setSetting } = require('./models/Settings');
const crypto = require('crypto');

let bot;

function generateReferralCode(telegramId) {
  return 'EU' + telegramId.toString().slice(-6) + crypto.randomBytes(2).toString('hex').toUpperCase();
}

function initBot(token, baseUrl) {
  if (bot) return bot;

  bot = new TelegramBot(token, { polling: true });

  bot.on('message', async (msg) => {
    const botEnabled = await getSetting('botEnabled');
    if (!botEnabled) return;

    const chatId = msg.chat.id;
    const telegramId = msg.from.id.toString();
    const text = msg.text || '';

    if (text.startsWith('/start')) {
      await handleStart(msg, baseUrl);
    } else if (text === '/admin') {
      await handleAdmin(msg);
    } else if (text.startsWith('/addbalance ')) {
      await handleAddBalance(msg);
    } else if (text.startsWith('/removebalance ')) {
      await handleRemoveBalance(msg);
    } else if (text.startsWith('/setapi ')) {
      await handleSetApi(msg);
    } else if (text.startsWith('/addchannel ')) {
      await handleAddChannel(msg);
    } else if (text.startsWith('/removechannel ')) {
      await handleRemoveChannel(msg);
    } else if (text.startsWith('/setpayout ')) {
      await handleSetPayout(msg);
    } else if (text.startsWith('/setrefer ')) {
      await handleSetRefer(msg);
    } else if (text.startsWith('/broadcast ')) {
      await handleBroadcast(msg);
    } else if (text.startsWith('/broadcastchannel ')) {
      await handleBroadcastChannel(msg);
    } else if (text.startsWith('/setverify ')) {
      await handleSetVerify(msg);
    } else if (text.startsWith('/setwithdrawal ')) {
      await handleSetWithdrawal(msg);
    } else if (text.startsWith('/setbot ')) {
      await handleSetBot(msg);
    } else if (text.startsWith('/settax ')) {
      await handleSetTax(msg);
    } else if (text.startsWith('/setmin ')) {
      await handleSetMin(msg);
    } else if (text.startsWith('/setmax ')) {
      await handleSetMax(msg);
    } else if (text.startsWith('/setcooldown ')) {
      await handleSetCooldown(msg);
    } else if (text === '/stats') {
      await handleStats(msg);
    }
  });

  bot.on('callback_query', async (query) => {
    const data = query.data;
    const msg = query.message;
    const telegramId = query.from.id.toString();

    if (data === 'check_channels') {
      await handleCheckChannels(query);
    } else if (data === 'verify_device') {
      await handleVerifyDevice(query, baseUrl);
    }
  });

  return bot;
}

async function handleStart(msg, baseUrl) {
  const telegramId = msg.from.id.toString();
  const text = msg.text || '';
  const parts = text.split(' ');
  const refCode = parts[1] || null;

  let user = await User.findOne({ telegramId });

  if (!user) {
    let referrer = null;
    if (refCode && refCode !== telegramId) {
      referrer = await User.findOne({ referralCode: refCode });
      if (!referrer) referrer = await User.findOne({ telegramId: refCode });
    }

    user = new User({
      telegramId,
      username: msg.from.username || '',
      firstName: msg.from.first_name || '',
      lastName: msg.from.last_name || '',
      referredBy: referrer ? referrer.telegramId : null,
      referralCode: generateReferralCode(telegramId)
    });
    await user.save();
  }

  // Check required channels
  const channels = await getSetting('channels');
  if (channels && channels.length > 0) {
    const notJoined = await checkMissingChannels(telegramId, channels);
    if (notJoined.length > 0) {
      return sendChannelJoinMessage(msg.chat.id, notJoined, telegramId);
    }
  }

  // Mark channels joined
  if (!user.channelsJoined) {
    user.channelsJoined = true;
    await user.save();
  }

  // Send verification or home
  if (!user.verified) {
    await sendVerificationMessage(msg.chat.id, telegramId, baseUrl);
  } else {
    const inviteBonus = await getSetting('inviteBonus');
    const webUrl = `${baseUrl}/app?tid=${telegramId}`;
    await bot.sendMessage(msg.chat.id, 
      `🎉 *Welcome back, ${user.firstName}!*\n\n` +
      `💰 *Balance:* ₹${user.balance}\n` +
      `👥 *Total Referred:* ${user.totalReferred}\n` +
      `🎁 *Invite Bonus:* ₹${inviteBonus} per referral\n\n` +
      `Tap below to open Earn Ultra 👇`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '🚀 Open Earn Ultra', web_app: { url: webUrl } }]]
        }
      }
    );
  }
}

async function checkMissingChannels(telegramId, channels) {
  const missing = [];
  for (const ch of channels) {
    try {
      const member = await bot.getChatMember(ch.id, parseInt(telegramId));
      if (['left', 'kicked', 'banned'].includes(member.status)) {
        missing.push(ch);
      }
    } catch (e) {
      missing.push(ch);
    }
  }
  return missing;
}

async function sendChannelJoinMessage(chatId, channels, telegramId) {
  const channelButtons = channels.map(ch => [{ text: `📢 Join ${ch.name}`, url: ch.link }]);
  channelButtons.push([{ text: '✅ I Joined All Channels', callback_data: 'check_channels' }]);

  await bot.sendMessage(chatId,
    `⚠️ *Channel Join Required!*\n\n` +
    `Join the channels below to continue:\n\n` +
    channels.map(c => `📢 ${c.name}`).join('\n') +
    `\n\nAfter joining, tap ✅ below.`,
    {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: channelButtons }
    }
  );
}

async function sendVerificationMessage(chatId, telegramId, baseUrl) {
  const verifyMode = await getSetting('verificationMode');
  const verifyUrl = `${baseUrl}/verify?tid=${telegramId}`;

  if (verifyMode === 'device') {
    await bot.sendMessage(chatId,
      `🔒 *Secure Device Verification*\n\n` +
      `Tap the button below to quickly verify your device.\n` +
      `It only takes a few seconds ⚡🔥\n\n` +
      `_One device = One account_`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '⚡ Verify Device', web_app: { url: verifyUrl } }]]
        }
      }
    );
  } else if (verifyMode === 'captcha') {
    await bot.sendMessage(chatId,
      `🔒 *Captcha Verification Required*\n\nTap below to complete verification.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '🔐 Verify Now', web_app: { url: verifyUrl } }]]
        }
      }
    );
  } else {
    // No verification
    const user = await User.findOne({ telegramId });
    if (user) { user.verified = true; await user.save(); }
    const webUrl = `${baseUrl}/app?tid=${telegramId}`;
    const inviteBonus = await getSetting('inviteBonus');
    await bot.sendMessage(chatId,
      `🎉 *Welcome to Earn Ultra!*\n\n` +
      `💰 *Balance:* ₹0\n` +
      `🎁 *Invite Bonus:* ₹${inviteBonus} per referral\n\n` +
      `Tap below to Open App 👇`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '🚀 Open Earn Ultra', web_app: { url: webUrl } }]]
        }
      }
    );
  }
}

async function handleCheckChannels(query) {
  const telegramId = query.from.id.toString();
  const channels = await getSetting('channels');
  const notJoined = channels && channels.length > 0 
    ? await checkMissingChannels(telegramId, channels) 
    : [];

  if (notJoined.length > 0) {
    await bot.answerCallbackQuery(query.id, { text: '❌ Please join all channels first!', show_alert: true });
    return;
  }

  await bot.answerCallbackQuery(query.id, { text: '✅ All channels joined!' });
  const user = await User.findOne({ telegramId });
  if (user) { user.channelsJoined = true; await user.save(); }
  
  const baseUrl = process.env.BASE_URL;
  await sendVerificationMessage(query.message.chat.id, telegramId, baseUrl);
}

async function handleVerifyDevice(query, baseUrl) {
  await bot.answerCallbackQuery(query.id);
}

// Admin functions
async function isAdmin(telegramId) {
  const adminId = process.env.ADMIN_ID;
  return telegramId.toString() === adminId.toString();
}

async function handleAdmin(msg) {
  if (!await isAdmin(msg.from.id)) return;
  const adminText = `
🛠 *Earn Ultra - Admin Panel*

*Balance Management:*
/addbalance {userId} {amount}
/removebalance {userId} {amount}

*Bot Settings:*
/setapi {payment_api_url}
/setbot on|off
/setverify device|captcha|none
/setwithdrawal on|off

*Withdrawal Settings:*
/settax {percent}
/setmin {amount}
/setmax {amount}
/setcooldown {hours}
/setrefer {amount}

*Channels:*
/addchannel {channelId}|{name}|{link}
/removechannel {channelId}

*Broadcast:*
/broadcast {message}
/broadcastchannel {channelId} {message}

*Payout:*
/setpayout {channelId}

*Stats:*
/stats
  `;
  await bot.sendMessage(msg.chat.id, adminText, { parse_mode: 'Markdown' });
}

async function handleAddBalance(msg) {
  if (!await isAdmin(msg.from.id)) return;
  const parts = msg.text.split(' ');
  if (parts.length < 3) return bot.sendMessage(msg.chat.id, '❌ Usage: /addbalance {userId} {amount}');
  const userId = parts[1];
  const amount = parseFloat(parts[2]);
  if (isNaN(amount)) return bot.sendMessage(msg.chat.id, '❌ Invalid amount');
  const user = await User.findOneAndUpdate(
    { telegramId: userId },
    { $inc: { balance: amount } },
    { new: true }
  );
  if (!user) return bot.sendMessage(msg.chat.id, '❌ User not found');
  await bot.sendMessage(msg.chat.id, `✅ Added ₹${amount} to ${userId}\nNew Balance: ₹${user.balance}`);
  try {
    await bot.sendMessage(userId, `💰 *Balance Added!*\n\n+₹${amount} added to your account\nNew Balance: ₹${user.balance}`, { parse_mode: 'Markdown' });
  } catch(e) {}
}

async function handleRemoveBalance(msg) {
  if (!await isAdmin(msg.from.id)) return;
  const parts = msg.text.split(' ');
  if (parts.length < 3) return bot.sendMessage(msg.chat.id, '❌ Usage: /removebalance {userId} {amount}');
  const userId = parts[1];
  const amount = parseFloat(parts[2]);
  if (isNaN(amount)) return bot.sendMessage(msg.chat.id, '❌ Invalid amount');
  const user = await User.findOneAndUpdate(
    { telegramId: userId },
    { $inc: { balance: -amount } },
    { new: true }
  );
  if (!user) return bot.sendMessage(msg.chat.id, '❌ User not found');
  await bot.sendMessage(msg.chat.id, `✅ Removed ₹${amount} from ${userId}\nNew Balance: ₹${user.balance}`);
}

async function handleSetApi(msg) {
  if (!await isAdmin(msg.from.id)) return;
  const apiUrl = msg.text.replace('/setapi ', '').trim();
  await setSetting('paymentApiUrl', apiUrl);
  await bot.sendMessage(msg.chat.id, `✅ Payment API URL updated!`);
}

async function handleAddChannel(msg) {
  if (!await isAdmin(msg.from.id)) return;
  const parts = msg.text.replace('/addchannel ', '').split('|');
  if (parts.length < 3) return bot.sendMessage(msg.chat.id, '❌ Usage: /addchannel {channelId}|{name}|{link}');
  const channels = (await getSetting('channels')) || [];
  channels.push({ id: parts[0].trim(), name: parts[1].trim(), link: parts[2].trim() });
  await setSetting('channels', channels);
  await bot.sendMessage(msg.chat.id, `✅ Channel added: ${parts[1].trim()}`);
}

async function handleRemoveChannel(msg) {
  if (!await isAdmin(msg.from.id)) return;
  const channelId = msg.text.replace('/removechannel ', '').trim();
  let channels = (await getSetting('channels')) || [];
  channels = channels.filter(c => c.id !== channelId);
  await setSetting('channels', channels);
  await bot.sendMessage(msg.chat.id, `✅ Channel removed`);
}

async function handleSetPayout(msg) {
  if (!await isAdmin(msg.from.id)) return;
  const channelId = msg.text.replace('/setpayout ', '').trim();
  await setSetting('payoutChannelId', channelId);
  await bot.sendMessage(msg.chat.id, `✅ Payout channel set to: ${channelId}`);
}

async function handleSetRefer(msg) {
  if (!await isAdmin(msg.from.id)) return;
  const amount = parseFloat(msg.text.replace('/setrefer ', '').trim());
  if (isNaN(amount)) return bot.sendMessage(msg.chat.id, '❌ Invalid amount');
  await setSetting('referAmount', amount);
  await setSetting('inviteBonus', amount);
  await bot.sendMessage(msg.chat.id, `✅ Refer amount set to ₹${amount}`);
}

async function handleBroadcast(msg) {
  if (!await isAdmin(msg.from.id)) return;
  const text = msg.text.replace('/broadcast ', '');
  const users = await User.find({});
  let sent = 0, failed = 0;
  for (const u of users) {
    try {
      await bot.sendMessage(u.telegramId, text, { parse_mode: 'Markdown' });
      sent++;
    } catch(e) { failed++; }
  }
  await bot.sendMessage(msg.chat.id, `📢 Broadcast done!\n✅ Sent: ${sent}\n❌ Failed: ${failed}`);
}

async function handleBroadcastChannel(msg) {
  if (!await isAdmin(msg.from.id)) return;
  const parts = msg.text.split(' ');
  const channelId = parts[1];
  const text = parts.slice(2).join(' ');
  try {
    await bot.sendMessage(channelId, text, { parse_mode: 'Markdown' });
    await bot.sendMessage(msg.chat.id, '✅ Message sent to channel!');
  } catch(e) {
    await bot.sendMessage(msg.chat.id, '❌ Failed: ' + e.message);
  }
}

async function handleSetVerify(msg) {
  if (!await isAdmin(msg.from.id)) return;
  const mode = msg.text.replace('/setverify ', '').trim();
  if (!['device', 'captcha', 'none'].includes(mode)) {
    return bot.sendMessage(msg.chat.id, '❌ Valid modes: device, captcha, none');
  }
  await setSetting('verificationMode', mode);
  await bot.sendMessage(msg.chat.id, `✅ Verification mode set to: ${mode}`);
}

async function handleSetWithdrawal(msg) {
  if (!await isAdmin(msg.from.id)) return;
  const val = msg.text.replace('/setwithdrawal ', '').trim();
  await setSetting('withdrawalEnabled', val === 'on');
  await bot.sendMessage(msg.chat.id, `✅ Withdrawal: ${val}`);
}

async function handleSetBot(msg) {
  if (!await isAdmin(msg.from.id)) return;
  const val = msg.text.replace('/setbot ', '').trim();
  await setSetting('botEnabled', val === 'on');
  await bot.sendMessage(msg.chat.id, `✅ Bot: ${val}`);
}

async function handleSetTax(msg) {
  if (!await isAdmin(msg.from.id)) return;
  const tax = parseFloat(msg.text.replace('/settax ', '').trim());
  if (isNaN(tax)) return bot.sendMessage(msg.chat.id, '❌ Invalid tax percent');
  await setSetting('withdrawalTax', tax);
  await bot.sendMessage(msg.chat.id, `✅ Tax set to ${tax}%`);
}

async function handleSetMin(msg) {
  if (!await isAdmin(msg.from.id)) return;
  const amount = parseFloat(msg.text.replace('/setmin ', '').trim());
  await setSetting('minWithdrawal', amount);
  await bot.sendMessage(msg.chat.id, `✅ Min withdrawal set to ₹${amount}`);
}

async function handleSetMax(msg) {
  if (!await isAdmin(msg.from.id)) return;
  const amount = parseFloat(msg.text.replace('/setmax ', '').trim());
  await setSetting('maxWithdrawal', amount);
  await bot.sendMessage(msg.chat.id, `✅ Max withdrawal set to ₹${amount}`);
}

async function handleSetCooldown(msg) {
  if (!await isAdmin(msg.from.id)) return;
  const hours = parseFloat(msg.text.replace('/setcooldown ', '').trim());
  await setSetting('withdrawalCooldown', hours);
  await bot.sendMessage(msg.chat.id, `✅ Cooldown set to ${hours} hours`);
}

async function handleStats(msg) {
  if (!await isAdmin(msg.from.id)) return;
  const totalUsers = await User.countDocuments();
  const verifiedUsers = await User.countDocuments({ verified: true });
  const totalBalance = await User.aggregate([{ $group: { _id: null, total: { $sum: '$balance' } } }]);
  const bal = totalBalance[0]?.total || 0;
  await bot.sendMessage(msg.chat.id,
    `📊 *Bot Stats*\n\n` +
    `👥 Total Users: ${totalUsers}\n` +
    `✅ Verified: ${verifiedUsers}\n` +
    `💰 Total Balance in DB: ₹${bal}`,
    { parse_mode: 'Markdown' }
  );
}

function getBot() {
  return bot;
}

module.exports = { initBot, getBot, checkMissingChannels, sendVerificationMessage };
