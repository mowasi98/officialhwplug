# 🚀 New AWS EC2 Setup for Discord Bots

Your old AWS EC2 instance (`13.60.26.180`) was deleted. This guide will help you set up a new one from scratch.

---

## 📁 Files Created for You

### Main Guides
1. **`AWS-EC2-SETUP-GUIDE.md`** - Comprehensive step-by-step guide (detailed)
2. **`Hwplug/discord-bot/SETUP-NEW-AWS.md`** - Quick setup guide (5-minute version)
3. **`Hwplug/discord-bot/NEW-AWS-CHECKLIST.md`** - Checklist format with troubleshooting

### Automation Scripts
4. **`Hwplug/discord-bot/deploy-to-new-aws.bat`** - Automated deployment script
5. **`Hwplug/discord-bot/test-deployment.bat`** - Test your deployment
6. **`Hwplug/discord-bot/update-website-env.bat`** - Update website configuration

---

## ⚡ Quick Start (15 minutes total)

### Step 1: Create EC2 Instance (5 minutes)
1. Go to https://console.aws.amazon.com/ec2/
2. Click "Launch Instance"
3. Configure:
   - Name: `hwplug-discord-bots-v2`
   - OS: Ubuntu Server 22.04 LTS
   - Type: `t3.small` (recommended) or `t2.micro` (free tier)
   - Key pair: Create new → `hwplug-bot-key-v2`
   - Security group: Allow ports 22, 3001, 3002
   - Storage: 20 GB
4. Launch and copy the Public IPv4 address

### Step 2: Save Key File (1 minute)
Move the downloaded key to:
```
C:\Users\shahm\.vscode\s1\.shh\hwplug-bot-key-v2.pem
```

### Step 3: Deploy Bots (10 minutes)
```powershell
# 1. Navigate to bot directory
cd "C:\Users\shahm\.vscode\s1\hwplug-backend v2\Hwplug\discord-bot"

# 2. Edit deploy-to-new-aws.bat
# Change line 15: set AWS_HOST=YOUR_NEW_IP_HERE

# 3. Run deployment
.\deploy-to-new-aws.bat
```

### Step 4: Update Website (2 minutes)
Edit `Hwplug\website\.env`:
```env
DISCORD_BOT_API_URL=http://YOUR_NEW_IP:3001
HWPLUG_BOT_API_URL=http://YOUR_NEW_IP:3002
```

### Step 5: Test (1 minute)
```powershell
.\test-deployment.bat
```

---

## 📋 What Gets Deployed

Your EC2 instance will run:

1. **Sparksbot** (Port 3001)
   - Handles: Sparx Maths, Sparx Reader, Sparx Science, Educate, Seneca
   - File: `discord-browser-bot.js`

2. **Sen AI Bot** (Port 3002)
   - Handles: Sen AI homework submissions
   - File: `senai-discord-bot-v6.js`

Both bots run 24/7 using PM2 process manager and auto-restart on crashes or reboots.

---

## 🔧 System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Your Website Server                       │
│                  (hwplug.store backend)                      │
│                                                              │
│  When user purchases homework:                               │
│  1. Reserve slot                                             │
│  2. Process payment (Stripe)                                 │
│  3. Send request to Discord bots →                          │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ HTTP POST
                         ↓
┌─────────────────────────────────────────────────────────────┐
│              AWS EC2 Instance (Ubuntu 22.04)                 │
│              IP: YOUR_NEW_IP                                 │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  PM2 Process Manager                                  │   │
│  │                                                       │   │
│  │  ┌─────────────────────┐  ┌─────────────────────┐   │   │
│  │  │   Sparksbot         │  │   Sen AI Bot        │   │   │
│  │  │   (Port 3001)       │  │   (Port 3002)       │   │   │
│  │  │                     │  │                     │   │   │
│  │  │ • Sparx Maths       │  │ • Sen AI            │   │   │
│  │  │ • Sparx Reader      │  │                     │   │   │
│  │  │ • Sparx Science     │  │                     │   │   │
│  │  │ • Educate           │  │                     │   │   │
│  │  │ • Seneca            │  │                     │   │   │
│  │  └─────────────────────┘  └─────────────────────┘   │   │
│  │                                                       │   │
│  │  Uses Puppeteer + Chromium to automate Discord       │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ Discord WebSocket
                         ↓
┌─────────────────────────────────────────────────────────────┐
│                      Discord Servers                         │
│                                                              │
│  • SparxNow Server (various channels)                       │
│  • Sen AI Server                                            │
│                                                              │
│  Bots send homework credentials to these channels           │
└─────────────────────────────────────────────────────────────┘
```

---

## 🎯 What Your Old Setup Was

**Old Configuration (DELETED):**
```
EC2 IP: 13.60.26.180
Key: hwplug-bot-key.pem
Location: C:\Users\shahm\.vscode\s1\.shh\hwplug-bot-key.pem
```

**New Configuration (TO BE CREATED):**
```
EC2 IP: [You'll get this after launching EC2]
Key: hwplug-bot-key-v2.pem
Location: C:\Users\shahm\.vscode\s1\.shh\hwplug-bot-key-v2.pem
```

---

## 💡 Why You Need EC2

Your Discord bots need to run 24/7 to:
1. Listen for homework submission requests from your website
2. Automate Discord interactions using Puppeteer
3. Send homework credentials to Discord channels
4. Provide API endpoints for your website to communicate with

You can't run this on your local machine because:
- ❌ Your computer would need to be on 24/7
- ❌ Your IP address changes
- ❌ Your website can't reliably connect to localhost
- ✅ EC2 provides a stable, always-on server with a fixed IP

---

## 📊 Cost Breakdown

| Component | Cost | Notes |
|-----------|------|-------|
| t3.small EC2 | ~$15/month | Recommended for production |
| t2.micro EC2 | Free (12 months) | Then ~$8/month |
| Storage (20 GB) | ~$2/month | SSD storage |
| Data transfer | ~$1/month | Discord bot traffic is minimal |
| **Total** | **~$15-20/month** | For t3.small setup |

**Free tier eligible:** If you're within your first 12 months of AWS, you can use t2.micro for free!

---

## 🔐 Security Notes

Your deployment includes:
- ✅ SSH access restricted to your IP only
- ✅ Bot API secured with `BOT_API_SECRET`
- ✅ Environment variables stored in `.env` (not in code)
- ✅ PM2 process isolation
- ✅ Automatic security updates (Ubuntu)

**Important:** Never commit your `.env` file or AWS keys to Git!

---

## 🆘 Getting Help

### If deployment fails:
1. Check `NEW-AWS-CHECKLIST.md` troubleshooting section
2. Run `test-deployment.bat` to diagnose issues
3. Check PM2 logs: `ssh to EC2 → pm2 logs`

### Common issues:
- **Can't SSH:** Fix key permissions (see checklist)
- **Bots won't start:** Check logs with `pm2 logs`
- **Website can't connect:** Check security group ports 3001/3002
- **Out of memory:** Upgrade to t3.small instance

### Useful commands:
```bash
# SSH to EC2
ssh -i "C:\Users\shahm\.vscode\s1\.shh\hwplug-bot-key-v2.pem" ubuntu@YOUR_IP

# Check bot status
pm2 status

# View logs
pm2 logs

# Restart bots
pm2 restart all

# Monitor resources
pm2 monit
```

---

## 📚 Documentation Structure

```
.
├── AWS-EC2-SETUP-GUIDE.md          ← Detailed guide (read this first!)
├── NEW-AWS-SETUP-README.md         ← This file (overview)
└── Hwplug/
    ├── discord-bot/
    │   ├── SETUP-NEW-AWS.md        ← Quick setup guide
    │   ├── NEW-AWS-CHECKLIST.md    ← Checklist format
    │   ├── deploy-to-new-aws.bat   ← Automated deployment
    │   ├── test-deployment.bat     ← Test deployment
    │   ├── update-website-env.bat  ← Update website config
    │   ├── discord-browser-bot.js  ← Sparksbot (main bot)
    │   ├── senai-discord-bot-v6.js ← Sen AI bot
    │   ├── test-server.js          ← API server (runs both bots)
    │   ├── package.json            ← Dependencies
    │   └── .env                    ← Configuration (DO NOT COMMIT!)
    └── website/
        ├── server.js               ← Your main website backend
        └── .env                    ← Website config (update with new IP)
```

---

## ✅ Success Checklist

You'll know everything is working when:
- [ ] EC2 instance shows "Running" in AWS Console
- [ ] `pm2 status` shows `discord-bot` as "online"
- [ ] `curl http://YOUR_IP:3001/status` returns JSON
- [ ] `curl http://YOUR_IP:3002/status` returns JSON
- [ ] Website can submit homework successfully
- [ ] Homework appears in Discord channels
- [ ] Bots survive EC2 reboot

---

## 🚀 Ready to Start?

1. **First time?** Read `AWS-EC2-SETUP-GUIDE.md` (comprehensive)
2. **Quick setup?** Follow `Hwplug/discord-bot/SETUP-NEW-AWS.md`
3. **Prefer checklist?** Use `Hwplug/discord-bot/NEW-AWS-CHECKLIST.md`

All guides lead to the same result - choose whichever format you prefer!

---

## 📞 Quick Reference

**AWS Console:** https://console.aws.amazon.com/ec2/  
**Your old IP (deleted):** `13.60.26.180`  
**Your new IP:** `________________` (fill in after EC2 launch)

**Key locations:**
- Old key: `C:\Users\shahm\.vscode\s1\.shh\hwplug-bot-key.pem`
- New key: `C:\Users\shahm\.vscode\s1\.shh\hwplug-bot-key-v2.pem`

**API endpoints:**
- Sparksbot: `http://YOUR_NEW_IP:3001`
- Hwplug Bot: `http://YOUR_NEW_IP:3002`

---

**Last Updated:** March 25, 2026  
**Status:** Ready for deployment  
**Estimated Setup Time:** 15-20 minutes

Good luck with your deployment! 🎉
