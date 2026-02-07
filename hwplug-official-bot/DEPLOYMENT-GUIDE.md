# 🚀 Homework Plug Official Bot - Deployment Guide

## 📋 Overview

This guide will help you deploy your Homework Plug Official Bot to your AWS server alongside the Discord bot.

---

## 🎯 What We're Deploying

- **Homework Plug Bot API** (Port 3002) - Your new Sparx Reader bot
- **Discord Bot** (Port 3001) - Your existing bot (already running)
- **Backend** (Render) - Already deployed, now updated with new endpoint

---

## 📦 Step 1: Upload Bot to AWS

### Option A: Using SCP (From Your PC)

```powershell
# Navigate to the bot folder
cd "C:\Users\shahm\.vscode\s1\hwplug-backend v2\hwplug-official-bot"

# Upload the entire folder to AWS
scp -i "C:\Users\shahm\.vscode\s1\.shh\hwplug-bot-key.pem" -r . ubuntu@13.60.26.180:~/hwplug-bot/
```

### Option B: Using SSH + Git (Recommended)

```powershell
# SSH into AWS
ssh -i "C:\Users\shahm\.vscode\s1\.shh\hwplug-bot-key.pem" ubuntu@13.60.26.180

# On AWS server:
cd ~/hwplug-bot
git pull  # If you're using git

# Or manually create the files (if not using git)
```

---

## ⚙️ Step 2: Install Dependencies on AWS

```bash
# SSH into AWS
ssh -i "C:\Users\shahm\.vscode\s1\.shh\hwplug-bot-key.pem" ubuntu@13.60.26.180

# Navigate to bot directory
cd ~/hwplug-bot

# Install dependencies
npm install puppeteer axios express

# Install Chromium dependencies (if not already installed)
sudo apt-get update
sudo apt-get install -y chromium-browser chromium-codecs-ffmpeg
```

---

## 🔐 Step 3: Configure Environment Variables

```bash
# Create .env file for the bot
nano ~/hwplug-bot/.env
```

Add these lines:

```env
# Perplexity AI API Key (REQUIRED!)
PERPLEXITY_API_KEY=your_perplexity_api_key_here

# Display for VNC
DISPLAY=:0

# Headless mode (false = visible in VNC)
HEADLESS=false

# Port
PORT=3002
```

**Press `Ctrl+X`, then `Y`, then `Enter` to save.**

---

## 🚀 Step 4: Start the Bot with PM2

```bash
# Start the Homework Plug Bot
pm2 start ~/hwplug-bot/hwplug-bot-api.js --name hwplug-bot

# Save PM2 configuration
pm2 save

# Check status
pm2 status
```

You should see:

```
┌─────┬──────────────────┬─────────┬─────────┬──────────┐
│ id  │ name             │ status  │ restart │ uptime   │
├─────┼──────────────────┼─────────┼─────────┼──────────┤
│ 0   │ sparxnow-api     │ online  │ 0       │ 5d       │
│ 1   │ hwplug-bot       │ online  │ 0       │ 0s       │
└─────┴──────────────────┴─────────┴─────────┴──────────┘
```

---

## 🔥 Step 5: Open Port 3002 in AWS Security Group

1. **Go to AWS Console** → EC2 → Security Groups
2. **Find your instance's security group**
3. **Add Inbound Rule:**
   - Type: `Custom TCP`
   - Port: `3002`
   - Source: `0.0.0.0/0` (or your backend IP)
   - Description: `Homework Plug Bot API`
4. **Save rules**

---

## 🧪 Step 6: Test the Bot

### Test 1: Health Check

```bash
# From AWS server
curl http://localhost:3002/health
```

Expected response:

```json
{
  "status": "online",
  "service": "Homework Plug Official Bot",
  "platform": "Sparx Reader",
  "timestamp": "2025-02-07T..."
}
```

### Test 2: From Your PC

```powershell
curl http://13.60.26.180:3002/health
```

Should get the same response!

---

## 🌐 Step 7: Update Backend Environment Variable

Your backend on Render needs to know about the new bot.

### Option A: Via Render Dashboard

1. Go to **Render Dashboard** → Your Backend Service
2. Go to **Environment** tab
3. Add new variable:
   - Key: `HWPLUG_BOT_API_URL`
   - Value: `http://13.60.26.180:3002`
4. **Save** (this will redeploy)

### Option B: Already Set in Code

The backend already has a default:

```javascript
const HWPLUG_BOT_API_URL = process.env.HWPLUG_BOT_API_URL || 'http://13.60.26.180:3002';
```

So if you don't set the env variable, it will use the default! ✅

---

## ✅ Step 8: Deploy Updated Backend to Render

Your backend code has been updated with the new endpoint. Deploy it:

### Option A: Git Push (Recommended)

```powershell
# In your project folder
git add server.js
git commit -m "Add Homework Plug Bot integration for Sparx Reader"
git push origin main
```

Render will auto-deploy! 🚀

### Option B: Manual Deploy

1. Go to **Render Dashboard**
2. Click **Manual Deploy** → **Deploy latest commit**

---

## 🎉 Step 9: Test End-to-End

### Test Scenario: Email Mode with Sparx Reader

1. **Set bot mode to EMAIL** (in admin panel)
2. **Make a test Sparx Reader purchase**
3. **Check your email** - you should see:
   - 🎓 **Homework Plug Bot** button (purple)
   - 🤖 **Discord Bot** button (blue)
   - ⚡ **Skip Queue** button
   - 🔄 **REDO** button
   - 👤 **I'll Do It** button

4. **Click "Homework Plug Bot"**
5. **Check VNC** - you should see Chrome opening and doing the homework!

---

## 📊 Monitoring & Logs

### View Bot Logs

```bash
# Real-time logs
pm2 logs hwplug-bot

# Last 100 lines
pm2 logs hwplug-bot --lines 100

# Only errors
pm2 logs hwplug-bot --err
```

### Restart Bot

```bash
pm2 restart hwplug-bot
```

### Stop Bot

```bash
pm2 stop hwplug-bot
```

### Delete Bot from PM2

```bash
pm2 delete hwplug-bot
```

---

## 🔧 Troubleshooting

### Bot Won't Start

```bash
# Check logs
pm2 logs hwplug-bot --lines 50

# Common issues:
# 1. Missing Perplexity API key
# 2. Port 3002 already in use
# 3. Missing dependencies
```

### Can't Connect from Backend

```bash
# Test from AWS server
curl http://localhost:3002/health

# If this works but external doesn't:
# → Check AWS Security Group (port 3002 open?)

# If this doesn't work:
# → Check if bot is running: pm2 status
# → Check logs: pm2 logs hwplug-bot
```

### Bot Crashes During Homework

```bash
# Check logs
pm2 logs hwplug-bot --err

# Common issues:
# 1. Perplexity API rate limit
# 2. Chromium crash (restart bot)
# 3. Network timeout
```

---

## 🎯 Architecture Overview

```
┌─────────────────┐
│   Customer      │
│   (Website)     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Render        │
│   (Backend)     │
│   Port 10000    │
└────────┬────────┘
         │
         ├──────────────────┐
         │                  │
         ▼                  ▼
┌─────────────────┐  ┌─────────────────┐
│  Discord Bot    │  │ Homework Plug   │
│  Port 3001      │  │ Bot (NEW!)      │
│                 │  │ Port 3002       │
│ • Sparx Maths   │  │ • Sparx Reader  │
│ • Sparx Reader  │  │   (AI-powered)  │
│ • Educate       │  │                 │
│ • Seneca        │  │                 │
└─────────────────┘  └─────────────────┘
         ▲                  ▲
         │                  │
         └──────────┬───────┘
                    │
              ┌─────▼─────┐
              │    VNC    │
              │  Display  │
              │   :0      │
              └───────────┘
```

---

## 📝 Summary

✅ **Homework Plug Bot** runs on AWS (port 3002)  
✅ **Discord Bot** runs on AWS (port 3001)  
✅ **Backend** on Render calls the right bot based on product  
✅ **Email mode** gives you choice between both bots (Sparx Reader only)  
✅ **Auto mode** uses Discord bot (as before)  

---

## 🆘 Need Help?

If something goes wrong:

1. **Check PM2 logs:** `pm2 logs hwplug-bot`
2. **Check backend logs:** Render dashboard → Logs
3. **Test health endpoint:** `curl http://13.60.26.180:3002/health`
4. **Check VNC:** Make sure bot can open Chrome

---

## 🎊 You're Done!

Your Homework Plug Bot is now live and ready to process Sparx Reader homework with AI! 🚀🎓
