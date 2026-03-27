# Files Created for AWS EC2 Setup

## Summary

I've created a complete AWS EC2 setup package for your Discord bots. Your old EC2 instance (`13.60.26.180`) was deleted, and these files will help you set up a new one quickly and easily.

---

## 📁 Files Created

### 1. Documentation Files

#### `AWS-EC2-SETUP-GUIDE.md` (Root folder)
- **Purpose:** Comprehensive, detailed step-by-step guide
- **Length:** ~500 lines
- **Best for:** First-time setup, understanding the full process
- **Includes:**
  - AWS account creation
  - IAM user setup
  - EC2 instance configuration
  - Security group setup
  - Dependency installation
  - PM2 configuration
  - Troubleshooting guide
  - Cost breakdown

#### `NEW-AWS-SETUP-README.md` (Root folder)
- **Purpose:** Overview and quick reference
- **Best for:** Understanding the big picture
- **Includes:**
  - System architecture diagram
  - File structure overview
  - Quick start guide
  - Cost breakdown
  - Success checklist

#### `Hwplug/discord-bot/SETUP-NEW-AWS.md`
- **Purpose:** Quick 5-minute setup guide
- **Best for:** Experienced users who want just the essentials
- **Includes:**
  - Condensed steps
  - Troubleshooting tips
  - Useful commands

#### `Hwplug/discord-bot/NEW-AWS-CHECKLIST.md`
- **Purpose:** Checklist format with detailed troubleshooting
- **Best for:** Following along step-by-step, marking progress
- **Includes:**
  - Pre-deployment checklist
  - Step-by-step checkboxes
  - Verification commands
  - Troubleshooting section
  - Quick reference card

#### `Hwplug/discord-bot/QUICK-START-CARD.txt`
- **Purpose:** Printable quick reference card
- **Best for:** Keeping handy while working
- **Includes:**
  - ASCII art formatted guide
  - All commands in one place
  - Configuration reference
  - Troubleshooting quick tips

#### `FILES-CREATED-SUMMARY.md` (This file)
- **Purpose:** Overview of all created files
- **Best for:** Understanding what was created and why

---

### 2. Automation Scripts

#### `Hwplug/discord-bot/deploy-to-new-aws.bat`
- **Purpose:** Automated deployment script
- **What it does:**
  1. Tests SSH connection
  2. Installs Node.js, Chromium, PM2 on EC2
  3. Creates application directory
  4. Uploads bot files (discord-browser-bot.js, senai-discord-bot-v6.js, test-server.js)
  5. Installs npm dependencies
  6. Configures environment variables
  7. Starts bots with PM2
  8. Verifies deployment
- **Usage:**
  ```powershell
  cd "C:\Users\shahm\.vscode\s1\hwplug-backend v2\Hwplug\discord-bot"
  # Edit line 15 with your new EC2 IP
  .\deploy-to-new-aws.bat
  ```

#### `Hwplug/discord-bot/test-deployment.bat`
- **Purpose:** Test your deployment after setup
- **What it does:**
  1. Tests Sparksbot API (port 3001)
  2. Tests Hwplug Bot API (port 3002)
  3. Checks PM2 status on EC2
  4. Retrieves recent logs
  5. Provides test summary
- **Usage:**
  ```powershell
  .\test-deployment.bat
  # Enter your EC2 IP when prompted
  ```

#### `Hwplug/discord-bot/update-website-env.bat`
- **Purpose:** Update website .env with new EC2 IP
- **What it does:**
  1. Prompts for new IP address
  2. Backs up current .env file
  3. Updates DISCORD_BOT_API_URL and HWPLUG_BOT_API_URL
  4. Tests connection to new endpoints
- **Usage:**
  ```powershell
  .\update-website-env.bat
  # Enter your new EC2 IP when prompted
  ```

---

## 🎯 Which File Should You Use?

### If you're setting up for the first time:
1. **Start with:** `NEW-AWS-SETUP-README.md` (overview)
2. **Then follow:** `AWS-EC2-SETUP-GUIDE.md` (detailed steps)
3. **Use:** `deploy-to-new-aws.bat` (automation)
4. **Verify with:** `test-deployment.bat`

### If you want a quick setup:
1. **Follow:** `Hwplug/discord-bot/SETUP-NEW-AWS.md`
2. **Use:** `deploy-to-new-aws.bat`
3. **Verify with:** `test-deployment.bat`

### If you prefer checklists:
1. **Follow:** `Hwplug/discord-bot/NEW-AWS-CHECKLIST.md`
2. **Check off items as you go**
3. **Use troubleshooting section if needed**

### If you want a quick reference:
- **Keep handy:** `Hwplug/discord-bot/QUICK-START-CARD.txt`
- **Print it or keep it open in a text editor**

---

## 📊 File Sizes & Complexity

| File | Lines | Complexity | Time to Read |
|------|-------|------------|--------------|
| AWS-EC2-SETUP-GUIDE.md | ~500 | Detailed | 15-20 min |
| NEW-AWS-SETUP-README.md | ~300 | Overview | 10 min |
| SETUP-NEW-AWS.md | ~100 | Quick | 5 min |
| NEW-AWS-CHECKLIST.md | ~400 | Checklist | 15 min |
| QUICK-START-CARD.txt | ~200 | Reference | 2 min |
| deploy-to-new-aws.bat | ~200 | Script | N/A |
| test-deployment.bat | ~100 | Script | N/A |
| update-website-env.bat | ~50 | Script | N/A |

---

## 🚀 Recommended Workflow

### First-Time Setup (Total: ~20 minutes)

```
1. Read NEW-AWS-SETUP-README.md (5 min)
   ↓
2. Create EC2 instance in AWS Console (5 min)
   ↓
3. Edit deploy-to-new-aws.bat with your IP (1 min)
   ↓
4. Run deploy-to-new-aws.bat (10 min - automated)
   ↓
5. Run test-deployment.bat (1 min)
   ↓
6. Run update-website-env.bat (1 min)
   ↓
7. Test homework submission from website (2 min)
   ↓
✅ Done!
```

### Troubleshooting

```
Problem occurs
   ↓
Check QUICK-START-CARD.txt for quick fix
   ↓
If not solved, check NEW-AWS-CHECKLIST.md troubleshooting section
   ↓
If still not solved, check AWS-EC2-SETUP-GUIDE.md detailed guide
   ↓
SSH to EC2 and check logs: pm2 logs
```

---

## 🔄 What Changed from Your Old Setup

### Old Setup (Deleted)
```
IP: 13.60.26.180
Key: C:\Users\shahm\.vscode\s1\.shh\hwplug-bot-key.pem
Deployment: clean-deploy-aws.bat (pointed to old IP)
```

### New Setup (To Be Created)
```
IP: [Your new EC2 IP]
Key: C:\Users\shahm\.vscode\s1\.shh\hwplug-bot-key-v2.pem
Deployment: deploy-to-new-aws.bat (updated script)
```

### What Stays the Same
- ✅ Bot code (discord-browser-bot.js, senai-discord-bot-v6.js)
- ✅ Package dependencies (package.json)
- ✅ Environment variables (.env structure)
- ✅ PM2 process management
- ✅ API endpoints (ports 3001 and 3002)

### What's New
- ✨ Better documentation (5 guides instead of 1)
- ✨ Automated deployment script
- ✨ Testing script
- ✨ Website update script
- ✨ Comprehensive troubleshooting
- ✨ Quick reference card

---

## 📝 Your Action Items

### Before You Start
- [ ] Have AWS account credentials ready
- [ ] Have credit card for AWS billing
- [ ] Decide on instance type (t2.micro free tier or t3.small recommended)
- [ ] Choose AWS region (eu-west-2 London or us-east-1 N. Virginia)

### During Setup
- [ ] Create EC2 instance
- [ ] Download and save key file
- [ ] Copy Public IPv4 address
- [ ] Update deploy-to-new-aws.bat with new IP
- [ ] Run deployment script
- [ ] Update website .env file
- [ ] Test deployment

### After Setup
- [ ] Test homework submission end-to-end
- [ ] Verify bots appear in Discord
- [ ] Save new IP address in documentation
- [ ] Delete old EC2 instance from AWS Console (if still there)
- [ ] Update any other services that use the bot API

---

## 💡 Tips for Success

1. **Don't skip the security group setup** - Ports 3001 and 3002 must be open
2. **Save your key file immediately** - You can't download it again
3. **Use t3.small for production** - t2.micro may be too slow
4. **Test each step** - Don't wait until the end to test
5. **Keep QUICK-START-CARD.txt open** - It has all the commands you need
6. **Check PM2 logs if something fails** - `pm2 logs` shows everything

---

## 🆘 Getting Help

### If deployment fails:
1. Check the error message in the deployment script
2. Look up the error in NEW-AWS-CHECKLIST.md troubleshooting section
3. SSH to EC2 and check logs: `pm2 logs discord-bot`

### If bots won't start:
1. SSH to EC2: `ssh -i "path/to/key.pem" ubuntu@YOUR_IP`
2. Check PM2 status: `pm2 status`
3. Check logs: `pm2 logs discord-bot --lines 100`
4. Restart: `pm2 restart discord-bot`

### If website can't connect:
1. Check EC2 security group has ports 3001 and 3002 open
2. Test from EC2: `curl http://localhost:3001/status`
3. Check website .env has correct IP address
4. Check bots are running: `pm2 status`

---

## 📞 Quick Reference

**AWS Console:** https://console.aws.amazon.com/ec2/

**Your Configuration:**
- Old IP (deleted): `13.60.26.180`
- New IP: `[Fill in after EC2 launch]`
- Old key: `hwplug-bot-key.pem`
- New key: `hwplug-bot-key-v2.pem`

**API Endpoints:**
- Sparksbot: `http://YOUR_NEW_IP:3001`
- Hwplug Bot: `http://YOUR_NEW_IP:3002`

**Important Directories:**
- Bot files: `C:\Users\shahm\.vscode\s1\hwplug-backend v2\Hwplug\discord-bot\`
- Website: `C:\Users\shahm\.vscode\s1\hwplug-backend v2\Hwplug\website\`
- Keys: `C:\Users\shahm\.vscode\s1\.shh\`
- EC2 bot directory: `~/sparxnow-bot`

---

## ✅ Success Criteria

You'll know everything is working when:
1. ✅ EC2 instance shows "Running" in AWS Console
2. ✅ `pm2 status` shows `discord-bot` as "online"
3. ✅ `curl http://YOUR_IP:3001/status` returns JSON
4. ✅ `curl http://YOUR_IP:3002/status` returns JSON
5. ✅ Website can submit homework successfully
6. ✅ Homework appears in Discord channels
7. ✅ Bots survive EC2 reboot (test with `sudo reboot`)

---

## 🎉 What's Next After Setup

1. **Monitor your bots:**
   - Set up CloudWatch alerts (optional)
   - Check PM2 logs regularly
   - Monitor AWS billing

2. **Optimize if needed:**
   - Upgrade to t3.small if t2.micro is slow
   - Add more storage if needed
   - Configure automatic backups

3. **Maintain your instance:**
   - Update Ubuntu: `sudo apt update && sudo apt upgrade`
   - Update npm packages: `cd ~/sparxnow-bot && npm update`
   - Check PM2 logs for errors

4. **Consider improvements:**
   - Set up Elastic IP (prevents IP change on restart)
   - Configure auto-scaling (if traffic increases)
   - Set up staging environment for testing

---

**Created:** March 25, 2026  
**Status:** Ready for deployment  
**Estimated Setup Time:** 15-20 minutes  
**Total Files Created:** 8

Good luck with your deployment! 🚀
