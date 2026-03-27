# AWS EC2 Setup Guide for Discord Bots

## Overview
This guide will help you set up a new AWS EC2 instance to host your Discord bots that handle homework automation.

---

## Part 1: Create AWS Account & Get Credentials

### Step 1: Create/Access AWS Account
1. Go to https://aws.amazon.com/
2. Click "Create an AWS Account" (or sign in if you have one)
3. Follow the registration process (requires credit card)

### Step 2: Create IAM User (For API Access)
1. Sign in to AWS Console: https://console.aws.amazon.com/
2. Search for "IAM" in the top search bar
3. Click "Users" in the left sidebar
4. Click "Create user"
5. Username: `hwplug-bot-user`
6. Click "Next"
7. Select "Attach policies directly"
8. Search and select: `AmazonEC2FullAccess`
9. Click "Next" → "Create user"

### Step 3: Create Access Keys
1. Click on the user you just created (`hwplug-bot-user`)
2. Go to "Security credentials" tab
3. Scroll down to "Access keys"
4. Click "Create access key"
5. Select "Command Line Interface (CLI)"
6. Check the confirmation box
7. Click "Next" → "Create access key"
8. **IMPORTANT**: Copy both:
   - Access Key ID (starts with `AKIA...`)
   - Secret Access Key (only shown once!)
9. Save these in a secure location

---

## Part 2: Launch EC2 Instance

### Step 1: Navigate to EC2
1. In AWS Console, search for "EC2"
2. Make sure you're in the correct region (top-right corner)
   - Recommended: `eu-west-2` (London) for UK-based users
   - Or `us-east-1` (N. Virginia) for lowest cost

### Step 2: Launch Instance
1. Click "Launch Instance" (orange button)
2. **Name**: `hwplug-discord-bots`
3. **Application and OS Images (AMI)**:
   - Select: **Ubuntu Server 22.04 LTS** (Free tier eligible)
4. **Instance type**:
   - Select: **t2.micro** (Free tier) or **t3.small** (better performance, ~$15/month)
5. **Key pair (login)**:
   - Click "Create new key pair"
   - Name: `hwplug-bot-key`
   - Key pair type: RSA
   - Private key format: `.pem` (for SSH) or `.ppk` (for PuTTY on Windows)
   - Click "Create key pair" (file will download - SAVE IT!)
6. **Network settings**:
   - Click "Edit"
   - **Firewall (security groups)**: Create security group
   - Security group name: `hwplug-bot-sg`
   - Description: `Security group for Discord bots`
   - **Inbound rules**:
     - Rule 1: SSH (port 22) - Source: My IP (for your access)
     - Rule 2: Custom TCP (port 3001) - Source: Anywhere (0.0.0.0/0) - For Sparksbot API
     - Rule 3: Custom TCP (port 3002) - Source: Anywhere (0.0.0.0/0) - For Hwplug Bot API
7. **Configure storage**:
   - 20 GB gp3 (recommended for better performance)
8. Click "Launch instance"

### Step 3: Get Instance IP Address
1. Wait for instance state to show "Running" (takes 1-2 minutes)
2. Click on your instance
3. Copy the **Public IPv4 address** (e.g., `13.60.26.180`)
4. Save this IP - you'll need it for your `.env` file

---

## Part 3: Connect to EC2 Instance

### Option A: Using Windows PowerShell/Terminal
```powershell
# Navigate to where you saved the .pem file
cd C:\Users\YourName\Downloads

# Set permissions (Windows)
icacls hwplug-bot-key.pem /inheritance:r
icacls hwplug-bot-key.pem /grant:r "%username%:R"

# Connect to EC2
ssh -i hwplug-bot-key.pem ubuntu@YOUR_EC2_IP_ADDRESS
```

### Option B: Using PuTTY (Windows)
1. Download PuTTY: https://www.putty.org/
2. Open PuTTYgen:
   - Load your `.pem` file
   - Save as `.ppk` file
3. Open PuTTY:
   - Host Name: `ubuntu@YOUR_EC2_IP_ADDRESS`
   - Port: 22
   - Connection → SSH → Auth → Credentials: Browse to your `.ppk` file
   - Click "Open"

---

## Part 4: Install Dependencies on EC2

Once connected to your EC2 instance, run these commands:

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20.x (LTS)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version  # Should show v20.x.x
npm --version

# Install Git
sudo apt install -y git

# Install Chromium dependencies (for Puppeteer)
sudo apt install -y \
  chromium-browser \
  chromium-codecs-ffmpeg \
  fonts-liberation \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libatspi2.0-0 \
  libcups2 \
  libdbus-1-3 \
  libdrm2 \
  libgbm1 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libwayland-client0 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxkbcommon0 \
  libxrandr2 \
  xdg-utils

# Install PM2 (process manager to keep bots running)
sudo npm install -g pm2

# Create application directory
mkdir -p ~/hwplug-bots
cd ~/hwplug-bots
```

---

## Part 5: Deploy Your Discord Bots

### Option 1: Manual Upload (Recommended for first time)

1. On your local machine, create a deployment package:
   - Copy the files from `.\Hwplug\discord-bot\` to a new folder
   - Include: `discord-browser-bot.js`, `senai-discord-bot-v6.js`, `package.json`, `.env`

2. Upload to EC2 using SCP (from your local machine):
```powershell
# Windows PowerShell
scp -i hwplug-bot-key.pem -r C:\path\to\discord-bot\* ubuntu@YOUR_EC2_IP:~/hwplug-bots/
```

### Option 2: Using Git (Recommended for updates)

On EC2:
```bash
cd ~/hwplug-bots
git clone YOUR_GITHUB_REPO_URL .
# Or if you don't have a git repo, use Option 1
```

---

## Part 6: Configure Environment Variables

On EC2, create `.env` file:
```bash
cd ~/hwplug-bots
nano .env
```

Add your configuration:
```env
# Discord Credentials
DISCORD_EMAIL=your_discord_email@example.com
DISCORD_PASSWORD=your_discord_password

# Discord Bot Tokens
DISCORD_BOT_TOKEN=your_sparksbot_token_here
SENAI_BOT_TOKEN=your_senai_bot_token_here

# Channel IDs
CHANNEL_SPARX_MATHS=1234567890123456789
CHANNEL_SPARX_READER=1234567890123456789
CHANNEL_SPARX_SCIENCE=1234567890123456789
CHANNEL_EDUCATE=1234567890123456789
CHANNEL_SENECA=1234567890123456789
CHANNEL_SENAI=1340821032239501424

# Bot API Configuration
BOT_API_SECRET=your_bot_secret_here
PORT_SPARKSBOT=3001
PORT_HWPLUG_BOT=3002

# Limits
MAX_DAILY_SLOTS=30
```

Save: `Ctrl+X` → `Y` → `Enter`

---

## Part 7: Install Node Modules & Start Bots

```bash
cd ~/hwplug-bots

# Install dependencies
npm install

# Start bots with PM2
pm2 start discord-browser-bot.js --name sparksbot
pm2 start senai-discord-bot-v6.js --name senai-bot

# Save PM2 configuration
pm2 save

# Set PM2 to start on system boot
pm2 startup
# Copy and run the command it outputs (starts with 'sudo env...')

# Check bot status
pm2 status
pm2 logs
```

---

## Part 8: Update Your Website .env

On your local machine, update `.\Hwplug\website\.env`:

```env
ADMIN_PASSWORD=hwplug2025
DISCORD_BOT_API_URL=http://YOUR_NEW_EC2_IP:3001
HWPLUG_BOT_API_URL=http://YOUR_NEW_EC2_IP:3002
BOT_API_SECRET=your_bot_secret_here
```

**Important**: Replace `YOUR_NEW_EC2_IP` with the actual IP address from Step 2.3

---

## Part 9: Test the Setup

### Test from your website server:
```bash
# Test Sparksbot API
curl http://YOUR_EC2_IP:3001/status

# Test Hwplug Bot API
curl http://YOUR_EC2_IP:3002/status
```

### Monitor logs on EC2:
```bash
# View all logs
pm2 logs

# View specific bot
pm2 logs sparksbot
pm2 logs senai-bot

# Stop logs: Ctrl+C
```

---

## Part 10: Useful PM2 Commands

```bash
# View status
pm2 status

# View logs
pm2 logs

# Restart a bot
pm2 restart sparksbot
pm2 restart senai-bot

# Stop a bot
pm2 stop sparksbot

# Start a bot
pm2 start sparksbot

# Restart all
pm2 restart all

# View detailed info
pm2 show sparksbot

# Monitor CPU/Memory
pm2 monit
```

---

## Troubleshooting

### Bot won't start:
```bash
# Check logs
pm2 logs sparksbot --lines 100

# Check if port is in use
sudo netstat -tulpn | grep 3001

# Restart bot
pm2 restart sparksbot
```

### Can't connect from website:
1. Check EC2 security group has ports 3001 and 3002 open
2. Check bot is running: `pm2 status`
3. Test locally on EC2: `curl http://localhost:3001/status`
4. Check firewall: `sudo ufw status` (should be inactive or allow ports)

### Puppeteer/Chromium issues:
```bash
# Install missing dependencies
sudo apt install -y chromium-browser

# Set Chromium path in your bot code
export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
```

### Out of memory:
```bash
# Check memory usage
free -h

# Upgrade to larger instance type (t3.small or t3.medium)
```

---

## Security Best Practices

1. **Never commit `.env` files to Git**
2. **Regularly update your instance**:
   ```bash
   sudo apt update && sudo apt upgrade -y
   ```
3. **Use strong passwords**
4. **Restrict SSH access** to your IP only in security group
5. **Enable AWS CloudWatch** for monitoring
6. **Set up automatic backups** (EC2 snapshots)

---

## Cost Estimate

- **t2.micro** (Free tier): $0/month for first 12 months, then ~$8/month
- **t3.small**: ~$15/month (better performance, recommended)
- **t3.medium**: ~$30/month (if you need more resources)
- **Data transfer**: Usually minimal for Discord bots

---

## Next Steps After Setup

1. ✅ EC2 instance running
2. ✅ Bots deployed and running with PM2
3. ✅ Website `.env` updated with new EC2 IP
4. ✅ Test homework submissions
5. 📝 Set up monitoring/alerts (optional)
6. 📝 Configure automatic backups (optional)
7. 📝 Set up Elastic IP (optional - prevents IP change on restart)

---

## Need Help?

- AWS Documentation: https://docs.aws.amazon.com/ec2/
- PM2 Documentation: https://pm2.keymetrics.io/docs/
- Discord.js Guide: https://discordjs.guide/

---

**Your old IP**: `13.60.26.180` (deleted)  
**Your new IP**: `[Get from EC2 console after launch]`

Remember to update the IP in your website's `.env` file!
