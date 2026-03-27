# 🚀 START HERE - New AWS EC2 Setup

## Your Situation
Your old AWS EC2 instance (`13.60.26.180`) was **deleted**. You need to set up a new one to host your Discord bots.

---

## 📦 What I've Created for You

I've created **8 files** to help you set up your new AWS EC2 instance:

### 📚 Documentation (Choose One)
1. **`AWS-EC2-SETUP-GUIDE.md`** ⭐ **RECOMMENDED FOR FIRST TIME**
   - Comprehensive, detailed guide
   - Everything explained step-by-step
   - ~20 minutes to read and follow

2. **`NEW-AWS-SETUP-README.md`**
   - Overview and architecture
   - Quick reference
   - ~10 minutes to read

3. **`Hwplug/discord-bot/SETUP-NEW-AWS.md`**
   - Quick 5-minute guide
   - For experienced users

4. **`Hwplug/discord-bot/NEW-AWS-CHECKLIST.md`**
   - Checklist format
   - Check off items as you go
   - Includes troubleshooting

5. **`Hwplug/discord-bot/QUICK-START-CARD.txt`**
   - Printable reference card
   - All commands in one place

### 🤖 Automation Scripts
6. **`Hwplug/discord-bot/deploy-to-new-aws.bat`** ⭐ **MAIN DEPLOYMENT SCRIPT**
   - Automatically sets up everything on EC2
   - Just edit line 15 with your new IP and run

7. **`Hwplug/discord-bot/test-deployment.bat`**
   - Test your deployment
   - Verify everything works

8. **`Hwplug/discord-bot/update-website-env.bat`**
   - Update your website configuration
   - Quick and easy

---

## ⚡ Quick Start (15 minutes)

### Step 1: Create EC2 Instance (5 min)
```
1. Go to: https://console.aws.amazon.com/ec2/
2. Click "Launch Instance"
3. Name: hwplug-discord-bots-v2
4. OS: Ubuntu Server 22.04 LTS
5. Type: t3.small (or t2.micro for free tier)
6. Key: Create new → hwplug-bot-key-v2 → Download
7. Security: Allow ports 22, 3001, 3002
8. Storage: 20 GB
9. Launch → Copy Public IPv4 address
```

**Write your new IP here:** `_______________________`

### Step 2: Save Key File (1 min)
Move the downloaded key to:
```
C:\Users\shahm\.vscode\s1\.shh\hwplug-bot-key-v2.pem
```

### Step 3: Deploy Bots (10 min)
```powershell
# Open PowerShell
cd "C:\Users\shahm\.vscode\s1\hwplug-backend v2\Hwplug\discord-bot"

# Edit the deployment script
notepad deploy-to-new-aws.bat
# Change line 15: set AWS_HOST=YOUR_NEW_IP_HERE

# Run deployment
.\deploy-to-new-aws.bat
```

### Step 4: Update Website (2 min)
```powershell
# Run this script
.\update-website-env.bat
# Enter your new IP when prompted
```

### Step 5: Test (1 min)
```powershell
.\test-deployment.bat
```

---

## 🎯 What Gets Deployed

Your new EC2 instance will run:

### Sparksbot (Port 3001)
- Sparx Maths
- Sparx Reader
- Sparx Science
- Educate
- Seneca

### Sen AI Bot (Port 3002)
- Sen AI homework submissions

Both bots run 24/7 with PM2 and auto-restart on crashes.

---

## 💰 Cost

| Instance | Cost/Month | Recommended |
|----------|------------|-------------|
| t2.micro | Free (12 months) then $8 | Testing |
| t3.small | $15 | ⭐ Production |
| t3.medium | $30 | High traffic |

---

## ✅ Success Checklist

You'll know it's working when:
- [ ] EC2 shows "Running" in AWS Console
- [ ] `pm2 status` shows "online"
- [ ] `curl http://YOUR_IP:3001/status` returns JSON
- [ ] `curl http://YOUR_IP:3002/status` returns JSON
- [ ] Website can submit homework
- [ ] Homework appears in Discord

---

## 🆘 Need Help?

### Can't SSH to EC2?
```powershell
# Fix key permissions
icacls "C:\Users\shahm\.vscode\s1\.shh\hwplug-bot-key-v2.pem" /inheritance:r
icacls "C:\Users\shahm\.vscode\s1\.shh\hwplug-bot-key-v2.pem" /grant:r "%username%:R"
```

### Bots won't start?
```bash
# SSH to EC2
ssh -i "C:\Users\shahm\.vscode\s1\.shh\hwplug-bot-key-v2.pem" ubuntu@YOUR_IP

# Check logs
pm2 logs discord-bot

# Restart
pm2 restart discord-bot
```

### Website can't connect?
1. Check security group has ports 3001 & 3002 open
2. Check bots running: `pm2 status`
3. Check website .env has correct IP

---

## 📞 Quick Commands

### SSH to EC2
```bash
ssh -i "C:\Users\shahm\.vscode\s1\.shh\hwplug-bot-key-v2.pem" ubuntu@YOUR_IP
```

### Check Status
```bash
pm2 status
```

### View Logs
```bash
pm2 logs
```

### Restart Bots
```bash
pm2 restart all
```

---

## 📚 More Information

For detailed instructions, see:
- **`AWS-EC2-SETUP-GUIDE.md`** - Full guide
- **`FILES-CREATED-SUMMARY.md`** - Overview of all files

---

## 🎯 Your Configuration

| Item | Old (Deleted) | New (To Create) |
|------|---------------|-----------------|
| IP | `13.60.26.180` | `_______________` |
| Key | `hwplug-bot-key.pem` | `hwplug-bot-key-v2.pem` |
| Sparksbot | `http://13.60.26.180:3001` | `http://YOUR_NEW_IP:3001` |
| Hwplug Bot | `http://13.60.26.180:3002` | `http://YOUR_NEW_IP:3002` |

---

## 🚀 Ready? Let's Go!

1. **First time?** → Read `AWS-EC2-SETUP-GUIDE.md`
2. **Want quick setup?** → Follow steps above
3. **Prefer checklist?** → Use `NEW-AWS-CHECKLIST.md`

**Estimated time:** 15-20 minutes  
**Difficulty:** Easy (mostly automated)

---

**Last Updated:** March 25, 2026  
**Status:** Ready to deploy 🎉
