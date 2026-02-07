# Website Integration Guide
## How to Connect Your Website to the Sparx Reader Bot

---

## Overview

This bot is designed to receive homework order details from your website and automatically complete Sparx Reader assignments.

---

## Integration Points in Code

There are **4 main integration points** marked in `hwplug-official-bot.js`:

### ✅ Integration Point #1: Configuration (Line 9-15)
Where bot configuration is stored.

### ✅ Integration Point #2: getCredentialsFromWebsite() (Line 26-42)
**THIS IS WHERE YOU CONNECT YOUR WEBSITE**

### ✅ Integration Point #3: collectCredentials() (Line 60-98)
Tries to get data from website first, falls back to manual input.

### ✅ Integration Point #4: Google Login Support (Line in login function)
Handles "Log in with Google" button if user chooses Google login.

---

## How to Connect Your Website

### Method 1: Command Line Arguments (Simplest)

**Your website calls the bot like this:**
```bash
node hwplug-official-bot.js "School Name" "username" "password" "false"
```

**Update `getCredentialsFromWebsite()` to:**
```javascript
async function getCredentialsFromWebsite() {
    // Get credentials from command line arguments
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

---

### Method 2: API Call to Your Website (Recommended)

**Update `getCredentialsFromWebsite()` to:**
```javascript
async function getCredentialsFromWebsite() {
    try {
        // Get order ID from command line
        const orderId = process.argv[2];
        
        if (!orderId) {
            return null;
        }
        
        // Call your website API
        const response = await axios.post('https://yourwebsite.com/api/get-homework-order', {
            orderId: orderId,
            apiKey: 'YOUR_SECRET_API_KEY' // For security
        });
        
        // Expected response format:
        // {
        //     schoolName: "Heathcote School & Science College",
        //     username: "studentusername",
        //     password: "studentpassword",
        //     useGoogle: false
        // }
        
        return response.data;
    } catch (error) {
        console.error('Error fetching from website:', error.message);
        return null;
    }
}
```

**Your website would call:**
```bash
node hwplug-official-bot.js ORDER_ID_123
```

---

### Method 3: Database Connection (For AWS Deployment)

**Update `getCredentialsFromWebsite()` to:**
```javascript
const { MongoClient } = require('mongodb'); // Install: npm install mongodb

async function getCredentialsFromWebsite() {
    try {
        const orderId = process.argv[2];
        if (!orderId) return null;
        
        // Connect to your database
        const client = await MongoClient.connect('YOUR_MONGODB_CONNECTION_STRING');
        const db = client.db('hwplug');
        
        // Get order from database
        const order = await db.collection('orders').findOne({ 
            orderId: orderId,
            status: 'pending'
        });
        
        await client.close();
        
        if (!order) return null;
        
        return {
            schoolName: order.schoolName,
            username: order.sparxUsername,
            password: order.sparxPassword,
            useGoogle: order.useGoogleLogin || false
        };
    } catch (error) {
        console.error('Database error:', error.message);
        return null;
    }
}
```

---

## Google Login Support

### How It Works:

1. User selects "Use Google Login" on your website
2. Your website sends `useGoogle: true` to the bot
3. Bot clicks "Log in with Google" button
4. Bot handles Google OAuth flow

### Current Implementation:

- ✅ Detects "Log in with Google" button
- ✅ Clicks it automatically
- ⚠️ **TODO**: Complete Google OAuth (email, password, 2FA)

### To Complete Google Login:

You have 2 options:

**Option A: Store Google Credentials**
```javascript
// Your website sends:
{
    schoolName: "...",
    username: "student@gmail.com",  // Google email
    password: "googlepassword",      // Google password
    useGoogle: true
}
```

**Option B: Use Pre-authenticated Session**
- Have users log in to Google on your website first
- Use Puppeteer's `setCookie()` to inject Google session cookies
- Bot will be automatically logged in

---

## Example: Full Website Integration Flow

### 1. Customer Orders on Your Website
```
Customer fills form:
- School: Heathcote School & Science College
- Username: john.doe
- Password: mypassword123
- Login Method: Google (checkbox)
```

### 2. Your Website Saves Order to Database
```javascript
// In your website backend (Node.js/PHP/Python)
const order = {
    orderId: "ORDER_12345",
    schoolName: req.body.school,
    sparxUsername: req.body.username,
    sparxPassword: req.body.password,
    useGoogleLogin: req.body.useGoogle,
    status: "pending",
    createdAt: new Date()
};

await db.orders.insert(order);
```

### 3. Your Website Triggers the Bot
```javascript
// On your server (AWS/local)
const { exec } = require('child_process');

exec(`node hwplug-official-bot.js ORDER_12345`, (error, stdout, stderr) => {
    if (error) {
        console.error('Bot error:', error);
        // Update order status to "failed"
        return;
    }
    
    console.log('Bot output:', stdout);
    // Bot completed! Update order status to "completed"
});
```

### 4. Bot Runs and Completes Homework
- Bot fetches order details from database
- Logs in to Sparx Reader
- Completes 300 SRP
- Exits

### 5. Your Website Notifies Customer
```javascript
// Send email/SMS to customer
sendEmail(customer.email, {
    subject: "Homework Completed!",
    body: "Your Sparx Reader homework (300 SRP) has been completed successfully!"
});
```

---

## Testing Integration

### Step 1: Test with Command Line First
```bash
node hwplug-official-bot.js
```
Enter credentials manually to verify bot works.

### Step 2: Test with Your Integration
```javascript
// Example: Test command line args
node hwplug-official-bot.js "Test School" "testuser" "testpass" "false"
```

### Step 3: Test from Your Website
Trigger the bot from your website backend and monitor logs.

---

## Security Best Practices

⚠️ **IMPORTANT**: 

1. **Never expose credentials in logs**
2. **Use HTTPS for all API calls**
3. **Encrypt passwords in database**
4. **Use API keys for authentication**
5. **Run bot on secure server (not customer's computer)**
6. **Delete credentials after job completes**

---

## Need Help?

Check your other chat for website code examples and integration!

This bot is ready to receive data from your website - just update the `getCredentialsFromWebsite()` function!
