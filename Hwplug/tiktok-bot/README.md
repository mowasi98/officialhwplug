# 🎵 TikTok Unfollow Bot

Automatically unfollow everyone on TikTok **except** your friends.

## 🚀 Quick Start

### 1. Install Dependencies
```bash
cd "C:\Users\shahm\.vscode\s1\hwplug-backend v2\Hwplug\tiktok-bot"
npm install
```

### 2. Run the Bot
```bash
node tiktok-unfollow-bot.js
```

### 3. Manual Steps
When the browser opens:
1. **Log into your TikTok account**
2. **Go to your profile page**
3. **Click on your "Following" count** to open the Following popup
4. **Press ENTER in the console** to start the bot

### 4. Watch It Work
The bot will:
- ✅ Keep all your **Friends**
- ❌ Unfollow everyone marked as **Following**
- 📜 Automatically scroll to load more users
- 🔄 Repeat until everyone is unfollowed

## ⚙️ Configuration

Edit these values in `tiktok-unfollow-bot.js`:

```javascript
const CONFIG = {
    HEADLESS: false,              // Set to true to hide browser
    DELAY_BETWEEN_CYCLES: 2000,   // 2 seconds between scans
    SCROLL_AMOUNT: 600,           // Scroll distance
    UNFOLLOW_DELAY: 1000,         // 1 second between unfollows
};
```

## 📊 What It Does

1. Scans all visible users in your Following list
2. Checks if they're marked as "Friends" or "Following"
3. Unfollows anyone marked "Following" (not friends)
4. Scrolls down to load more users
5. Repeats until done

## ⚠️ Safety Features

- ✅ Never touches your friends
- ✅ Delays between actions to avoid rate limiting
- ✅ Tracks processed users to avoid duplicates
- ✅ Stops automatically when no more users to unfollow

## 🎯 Result

Your Following list will only contain your **Friends**!
