# 🚀 Earn Ultra — Complete Setup Guide

## Project Structure
```
earn-ultra/
├── server.js          ← Main backend (Express + MongoDB)
├── package.json       ← Dependencies
├── vercel.json        ← Vercel deployment config
├── .env.example       ← Environment variables template
├── public/
│   └── index.html     ← User Web App (Telegram Mini App)
└── admin/
    └── index.html     ← Admin Panel
```

---

## 🔧 Step 1: Deploy to Vercel

1. Push this folder to a GitHub repo
2. Go to [vercel.com](https://vercel.com) → New Project → Import repo
3. Add these **Environment Variables** in Vercel:
   - `MONGODB_URI` = your MongoDB connection string
   - `ADMIN_TOKEN` = your admin password (e.g. `MySecret123`)
   - `APP_URL` = will be set after first deploy

4. Deploy! After deploy, copy the URL (e.g. `https://earn-ultra.vercel.app`)
5. Go back to Vercel → Settings → Environment Variables
6. Add `APP_URL` = `https://earn-ultra.vercel.app`
7. Redeploy

---

## 🤖 Step 2: Create Telegram Bot

1. Open [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow instructions
3. Copy the **Bot Token**

---

## ⚙️ Step 3: Configure via Admin Panel

1. Open `https://your-app.vercel.app/admin`
2. Login with your `ADMIN_TOKEN` password
3. Go to **Settings** and:
   - Paste your **Bot Token**
   - Set **Required Channel** (e.g. `@yourchannel`) — bot must be admin there!
   - Set **Payout Channel** (e.g. `@payoutlog`)
   - Set **Referral Bonus Amount** (default ₹10)
   - Set **Min/Max Withdrawal**
   - Paste your **Withdrawal API URL**
   - Choose **Verification Mode**
   - Click **Save All Settings**
4. Enter your App URL and click **Setup Webhook**

---

## 📱 Step 4: Setup Telegram Mini App

1. Go to [@BotFather](https://t.me/BotFather)
2. Send `/mybots` → Select your bot → `Bot Settings` → `Menu Button`
3. Set URL: `https://your-app.vercel.app`
4. Set Button Text: `🚀 Open Earn Ultra`

---

## 🏦 Withdrawal API Setup

Your current API URL format:
```
https://ultra-pay.store/APIs/api?token=YOUR_TOKEN&key=YOUR_KEY&paytoNumber={number}&amount={amount}&comment=Pay
```

- `{number}` — auto-replaced with user's mobile number
- `{amount}` — auto-replaced with withdrawal amount

---

## 🔐 Admin Panel Features

| Feature | Description |
|---------|-------------|
| Dashboard | Stats, recent users |
| Users | View all users, search, add balance |
| Withdrawals | View all with status filter |
| Manage Balance | Add/Remove/Set any user's balance |
| Broadcast | Send to all users OR channel |
| Settings | All bot config from one page |

---

## 📢 Admin Settings Reference

- **Bot Token** — Telegram bot token from BotFather
- **Required Channel** — Users must join before using app
- **Payout Channel** — All withdrawal logs go here
- **Verification Mode** — Device/IP/None
- **Referral Amount** — ₹ per referral
- **Min/Max Withdrawal** — Withdrawal limits
- **Withdrawal API** — Payment gateway URL
- **Bot On/Off** — Toggle entire bot
- **Withdrawal On/Off** — Toggle withdrawals only

---

## 🌐 URLs

| URL | Description |
|-----|-------------|
| `https://your-app.vercel.app` | User Mini App |
| `https://your-app.vercel.app/admin` | Admin Panel |
| `https://your-app.vercel.app/api/*` | API Endpoints |

---

## ⚠️ Important Notes

1. Bot must be **admin** of the required channel for join-check to work
2. Change `ADMIN_TOKEN` to something secure before deploying
3. One device/IP per account (based on verification mode)
4. Referral bonus credited only after the referred user verifies device
