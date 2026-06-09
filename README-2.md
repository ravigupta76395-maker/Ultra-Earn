# 🐚 Earn Ultra - Telegram Referral Bot + Web App

## Features
- ✅ Telegram Bot with channel verification
- ✅ Device verification (1 mobile = 1 account)
- ✅ Referral system with configurable bonus
- ✅ Withdrawal via UPI/payment API
- ✅ Admin panel (web + bot commands)
- ✅ Leaderboard (global + my referrals)
- ✅ Payout channel notifications
- ✅ Per-user withdrawal cooldown
- ✅ Tax on withdrawals
- ✅ Broadcast to all users

---

## 🚀 Deploy to Vercel

### Step 1: Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/earn-ultra.git
git push -u origin main
```

### Step 2: Import to Vercel
1. Go to [vercel.com](https://vercel.com) → New Project
2. Import your GitHub repo
3. Add these Environment Variables:

| Key | Value |
|-----|-------|
| `BOT_TOKEN` | `8627305903:AAEa4v_twNxi4Dl1sGCOMWwEyvLVXB7Rj50` |
| `BOT_USERNAME` | `EarnUltraMiniBot` |
| `MONGODB_URI` | `mongodb+srv://...` |
| `SESSION_SECRET` | `any_random_string_here` |
| `ADMIN_ID` | `YOUR_TELEGRAM_USER_ID` (get from @userinfobot) |
| `BASE_URL` | `https://your-app.vercel.app` (set after first deploy) |

4. Deploy!
5. After deploy, update `BASE_URL` env variable with your actual Vercel URL and redeploy.

---

## 🤖 Bot Commands (Admin only)

```
/admin          - Show all admin commands
/addbalance {userId} {amount}
/removebalance {userId} {amount}
/setapi {payment_api_url}
/setbot on|off
/setverify device|captcha|none
/setwithdrawal on|off
/settax {percent}
/setmin {amount}
/setmax {amount}
/setcooldown {hours}
/setrefer {amount}
/addchannel {channelId}|{name}|{link}
/removechannel {channelId}
/broadcast {message}
/broadcastchannel {channelId} {message}
/setpayout {channelId}
/stats
```

## 📱 Web App Pages
- `/` - Landing page
- `/verify?tid=TELEGRAM_ID` - Device verification
- `/app?tid=TELEGRAM_ID` - Main app (Home, Leaderboard, Withdraw, Stats)
- `/admin` - Admin panel

## 💳 Payment API Format
URL format: `https://your-api.com/pay?number={number}&amount={amount}`
- `{number}` = replaced with user's phone number
- `{amount}` = replaced with withdrawal amount after tax

## 📢 Channel Join
Add bot as admin to channels, then use:
```
/addchannel -1001234567890|My Channel|https://t.me/mychannel
```

## 🔒 Admin Panel
Visit `/admin` and enter your Telegram ID to access.
