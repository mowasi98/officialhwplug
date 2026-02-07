# Quick Start: Website Integration

## ✅ What's Been Added

Your bot now has **4 integration points** ready to connect to your website!

---

## 🚀 How to Connect to Your Website

### The Main Integration Function

Look at **line 32-42** in `hwplug-official-bot.js`:

```javascript
async function getCredentialsFromWebsite() {
    // TODO: Replace this with actual API call to your website
    
    // For now, return empty - will use manual input as fallback
    return null;
}
```

### Simple Example: Command Line

**Update line 32-42 to:**
```javascript
async function getCredentialsFromWebsite() {
    // Get from command line: node hwplug-official-bot.js "School" "user" "pass" "false"
    if (process.argv.length >= 6) {
        return {
            schoolName: process.argv[2],
            username: process.argv[3],
            password: process.argv[4],
            useGoogle: process.argv[5] === 'true'
        };
    }
    return null;
}
```

**Your website runs:**
```bash
node hwplug-official-bot.js "Heathcote School" "john.doe" "password123" "false"
```

---

## 📋 Data Format Your Website Should Send

```javascript
{
    schoolName: "Heathcote School & Science College",  // Student's school
    username: "studentusername",                       // Sparx username
    password: "studentpassword",                       // Sparx password
    useGoogle: false                                   // true = use Google login
}
```

---

## 🔐 Google Login Support

### How It Works:

1. **Your website** sends `useGoogle: true`
2. **Bot** clicks "Log in with Google" button
3. **Bot** enters Google email and password
4. **Done!**

### Example:

```javascript
// Customer selects "Use Google Login" on your website
const orderData = {
    schoolName: "Test School",
    username: "student@gmail.com",    // Google email
    password: "googlepassword",        // Google password
    useGoogle: true                    // Enable Google login
};
```

---

## 📝 Full Integration Guide

See **`WEBSITE-INTEGRATION-GUIDE.md`** for:
- 3 different integration methods
- Database connection examples
- Security best practices
- Full workflow examples

---

## 🧪 Testing

### Test 1: Manual Input (No Website)
```bash
node hwplug-official-bot.js
```
Bot will ask for credentials manually.

### Test 2: With Your Website Data
```javascript
// Update getCredentialsFromWebsite() with your method
// Then run:
node hwplug-official-bot.js ORDER_ID_123
```

---

## 🔗 Link to Your Other Chat

To integrate with your website code from your other chat:

1. Open the other chat with your website code
2. Add an API endpoint to provide credentials:
   ```javascript
   app.post('/api/get-homework-order', async (req, res) => {
       const order = await db.orders.findOne({ orderId: req.body.orderId });
       res.json({
           schoolName: order.schoolName,
           username: order.username,
           password: order.password,
           useGoogle: order.useGoogle
       });
   });
   ```
3. Update `getCredentialsFromWebsite()` in this bot to call that API

---

## ✅ Current Status

- ✅ Bot works perfectly (300 SRP completed!)
- ✅ Google login support added
- ✅ 4 integration points marked
- ✅ Manual input fallback included
- ⏳ Ready for website connection

---

**Next Step:** Update the `getCredentialsFromWebsite()` function with your preferred method!
