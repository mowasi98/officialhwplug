# ⚡ Quick Command Reference

## 🚀 Deployment (One-Time Setup)

```powershell
# 1. Upload to AWS
scp -i "C:\Users\shahm\.vscode\s1\.shh\hwplug-bot-key.pem" -r hwplug-official-bot ubuntu@13.60.26.180:~/hwplug-bot/

# 2. SSH into AWS
ssh -i "C:\Users\shahm\.vscode\s1\.shh\hwplug-bot-key.pem" ubuntu@13.60.26.180

# 3. Install dependencies
cd ~/hwplug-bot
npm install puppeteer axios express

# 4. Create .env file
nano .env
# Add: PERPLEXITY_API_KEY=your_key_here
# Add: DISPLAY=:0
# Add: HEADLESS=false
# Add: PORT=3002
# Save: Ctrl+X, Y, Enter

# 5. Start bot
pm2 start hwplug-bot-api.js --name hwplug-bot
pm2 save

# 6. Open port 3002 in AWS Security Group (via AWS Console)
```

---

## 📊 Daily Operations

### Check Bot Status

```bash
pm2 status
```

### View Real-Time Logs

```bash
pm2 logs hwplug-bot
```

### View Last 50 Lines

```bash
pm2 logs hwplug-bot --lines 50
```

### View Only Errors

```bash
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

### Start Bot

```bash
pm2 start hwplug-bot
```

---

## 🧪 Testing

### Test Health Endpoint (From AWS)

```bash
curl http://localhost:3002/health
```

### Test Health Endpoint (From PC)

```powershell
curl http://13.60.26.180:3002/health
```

### Expected Response

```json
{
  "status": "online",
  "service": "Homework Plug Official Bot",
  "platform": "Sparx Reader",
  "timestamp": "2025-02-07T..."
}
```

---

## 🔧 Troubleshooting

### Bot Won't Start

```bash
# Check what's wrong
pm2 logs hwplug-bot --lines 100

# Delete and restart
pm2 delete hwplug-bot
pm2 start ~/hwplug-bot/hwplug-bot-api.js --name hwplug-bot
pm2 save
```

### Port Already in Use

```bash
# Find what's using port 3002
sudo lsof -i :3002

# Kill the process (replace PID with actual number)
sudo kill -9 PID
```

### Update Bot Code

```bash
# SSH into AWS
ssh -i "C:\Users\shahm\.vscode\s1\.shh\hwplug-bot-key.pem" ubuntu@13.60.26.180

# Navigate to folder
cd ~/hwplug-bot

# Edit file
nano hwplug-bot-api.js

# Restart bot
pm2 restart hwplug-bot
```

---

## 🔄 Update from PC

```powershell
# Upload new version
scp -i "C:\Users\shahm\.vscode\s1\.shh\hwplug-bot-key.pem" hwplug-official-bot/hwplug-bot-api.js ubuntu@13.60.26.180:~/hwplug-bot/

# SSH and restart
ssh -i "C:\Users\shahm\.vscode\s1\.shh\hwplug-bot-key.pem" ubuntu@13.60.26.180 "pm2 restart hwplug-bot"
```

---

## 📦 Backend Deployment (Render)

```powershell
# Commit changes
git add server.js
git commit -m "Update: Homework Plug Bot integration"
git push origin main

# Render will auto-deploy!
```

---

## 🎯 Common Tasks

### View All PM2 Processes

```bash
pm2 list
```

### Restart All Bots

```bash
pm2 restart all
```

### Save PM2 Configuration

```bash
pm2 save
```

### View PM2 Startup Script

```bash
pm2 startup
```

### Monitor Resource Usage

```bash
pm2 monit
```

---

## 🔐 Environment Variables

### Check Current Variables

```bash
cat ~/hwplug-bot/.env
```

### Edit Variables

```bash
nano ~/hwplug-bot/.env
```

### Required Variables

```env
PERPLEXITY_API_KEY=your_key_here
DISPLAY=:0
HEADLESS=false
PORT=3002
```

---

## 🖥️ VNC Commands

### Check VNC Status

```bash
ps aux | grep vnc
```

### Restart VNC

```bash
vncserver -kill :0
vncserver :0 -geometry 1920x1080 -localhost no
```

### Set VNC Password

```bash
vncpasswd
```

---

## 📝 Quick Notes

- **Discord Bot** runs on port `3001`
- **Homework Plug Bot** runs on port `3002`
- **Backend** runs on Render (port `10000`)
- **VNC** runs on display `:0`
- **PM2** manages both bots
- **Logs** are in `~/.pm2/logs/`

---

## 🆘 Emergency Commands

### Stop Everything

```bash
pm2 stop all
```

### Restart Everything

```bash
pm2 restart all
```

### Delete All PM2 Processes

```bash
pm2 delete all
```

### Reboot Server (Last Resort!)

```bash
sudo reboot
```

---

## 🎊 Success Indicators

✅ `pm2 status` shows both bots as **online**  
✅ Health endpoint returns `{"status":"online"}`  
✅ Email shows "Homework Plug Bot" button  
✅ VNC shows Chrome opening when bot runs  
✅ Backend logs show successful API calls  

---

## 📞 Quick SSH

```powershell
ssh -i "C:\Users\shahm\.vscode\s1\.shh\hwplug-bot-key.pem" ubuntu@13.60.26.180
```

---

## 🎯 One-Liner Commands

```bash
# Status + Logs
pm2 status && pm2 logs hwplug-bot --lines 20 --nostream

# Restart + Status
pm2 restart hwplug-bot && pm2 status

# Stop + Delete + Start Fresh
pm2 stop hwplug-bot && pm2 delete hwplug-bot && pm2 start ~/hwplug-bot/hwplug-bot-api.js --name hwplug-bot && pm2 save

# Test Health + View Logs
curl http://localhost:3002/health && pm2 logs hwplug-bot --lines 10 --nostream
```

---

## 🎉 Done!

Save this file for quick reference! 📌
