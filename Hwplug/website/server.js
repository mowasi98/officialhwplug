require('dotenv').config();
const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Resend } = require('resend');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const helmet = require('helmet');
const WebSocket = require('ws');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

// Fetch support (built-in in Node 18+, fallback for older versions)
const fetch = globalThis.fetch || require('node-fetch');

// Discord Bot API URL Configuration
const DISCORD_BOT_API_URL = process.env.DISCORD_BOT_API_URL;
if (!DISCORD_BOT_API_URL) {
  console.error('❌ DISCORD_BOT_API_URL environment variable is not set');
  process.exit(1);
}
console.log(`🤖 Sparksbot API configured: ${DISCORD_BOT_API_URL}`);

// Homework Plug Official Bot API URL Configuration (for Sparx Reader)
// Base URL only (e.g. http://host:3002). Strips trailing slashes and a mistaken /submit-homework suffix.
function normalizeHwplugBotApiBase(raw) {
  if (!raw) return raw;
  let u = String(raw).trim().replace(/\/+$/, '');
  if (u.endsWith('/submit-homework')) {
    u = u.slice(0, -'/submit-homework'.length).replace(/\/+$/, '');
  }
  return u;
}
const HWPLUG_BOT_API_URL = normalizeHwplugBotApiBase(process.env.HWPLUG_BOT_API_URL);
if (!HWPLUG_BOT_API_URL) {
  console.error('❌ HWPLUG_BOT_API_URL environment variable is not set');
  process.exit(1);
}
console.log(`🎓 Homework Plug Bot API configured: ${HWPLUG_BOT_API_URL}`);
if (/^(https?:\/\/)?(localhost|127\.0\.0\.1)(\b|:|\/|$)/i.test(HWPLUG_BOT_API_URL)) {
  console.warn(
    '⚠️ HWPLUG_BOT_API_URL points to localhost. On Render (or any cloud), that is THIS machine—not your PC. ' +
    'Expose the bot with ngrok/Cloudflare Tunnel and set HWPLUG_BOT_API_URL to that HTTPS URL, or run the bot on a host with a public IP.'
  );
}

// Bot API Authentication
const BOT_API_SECRET = process.env.BOT_API_SECRET;
if (!BOT_API_SECRET) {
  console.error('❌ BOT_API_SECRET environment variable is not set');
  process.exit(1);
}
console.log(`🔐 Bot API authentication: ✅ Configured`);

const app = express();

// Security: Helmet for security headers
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP to avoid breaking frontend
  crossOriginEmbedderPolicy: false
}));

// Security: CORS - Only allow your domain
const allowedOrigins = [
  'https://www.hwplug.store',
  'https://hwplug.store',
  'http://localhost:3000', // For local testing
  'http://localhost:10000', // For local testing
  'http://127.0.0.1:3000',
  'http://127.0.0.1:10000'
];

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps, Postman, or server-to-server)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.warn('⚠️ Blocked CORS request from:', origin);
      callback(null, true); // Still allow but log it (change to false to block)
    }
  },
  credentials: true
}));

// ⚠️ IMPORTANT: Stripe webhook endpoint MUST come BEFORE express.json()
// Stripe needs the raw body to verify webhook signatures
app.post('/stripe-webhook', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  if (!webhookSecret) {
    console.error('❌ STRIPE_WEBHOOK_SECRET not set in environment variables');
    return res.status(500).send('Webhook secret not configured');
  }
  
  let event;
  
  try {
    // Verify webhook signature
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    console.log('✅ Webhook signature verified:', event.type);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  
  // Handle the checkout.session.completed event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log('💳 WEBHOOK: Payment completed for session:', session.id);
    
    // Extract metadata we attached during checkout session creation
    const metadata = session.metadata || {};
    const { reservationId, school, username, password, loginType, productName: rawProductName, productPrice, previousUsername } = metadata;
    
    // Clean product name (remove " - Extra Slot" suffix for backend processing)
    const productName = rawProductName ? rawProductName.replace(' - Extra Slot', '').trim() : '';
    const isExtraSlot = rawProductName && rawProductName.includes(' - Extra Slot');
    
    console.log('💳 WEBHOOK: Extracted metadata:', {
      reservationId,
      school,
      schoolType: typeof school,
      schoolLength: school ? school.length : 0,
      username,
      productName,
      rawProductName,
      isExtraSlot,
      productPrice,
      previousUsername,
      hasPassword: !!password
    });
    
    // Check if this is a new login
    const isNewLogin = !previousUsername || previousUsername !== username;
    
    // Process the purchase (same logic as /submit-login-details)
    try {
      // Check if product is available
      resetDailyCountersIfNeeded();
      if (productName && dailyLimits[productName] && !dailyLimits[productName].available) {
        console.error(`❌ WEBHOOK: Product "${productName}" is not available`);
        return res.json({ received: true, warning: 'Product not available' });
      }
      
      // Confirm reservation and get slot status
      let remainingSlots = 0;
      let currentCount = 0;
      let maxSlots = MAX_PURCHASES_PER_DAY;
      
      if (productName && dailyLimits[productName]) {
        // Determine if this is an extra slot purchase
        if (isExtraSlot && dailyLimits[productName].extraSlots) {
          // Extra slot purchase - show extra slot info
          currentCount = dailyLimits[productName].extraSlots.count;
          maxSlots = dailyLimits[productName].extraSlots.max;
          remainingSlots = Math.max(0, maxSlots - currentCount);
        } else {
          // Regular slot purchase
          currentCount = dailyLimits[productName].count;
          maxSlots = MAX_PURCHASES_PER_DAY;
          remainingSlots = Math.max(0, maxSlots - currentCount);
        }
        
        // Confirm the reservation
        if (reservationId && activeReservations[reservationId]) {
          if (activeReservations[reservationId].productName === productName) {
            const slotType = activeReservations[reservationId].isExtraSlot ? 'EXTRA SLOT' : 'regular slot';
            delete activeReservations[reservationId];
            console.log(`✅ WEBHOOK: Reservation CONFIRMED (${slotType}) for "${productName}" - ID: ${reservationId}`);
          } else {
            console.warn(`⚠️ WEBHOOK: Reservation ID mismatch, confirming all for ${productName}`);
            confirmReservation(productName);
          }
        } else {
          console.log(`✅ WEBHOOK: Confirming all reservations for "${productName}"`);
          confirmReservation(productName);
        }
        
        console.log(`✅ WEBHOOK: Product "${productName}" ${isExtraSlot ? 'extra slots' : 'regular slots'}: ${currentCount}/${maxSlots} (${remainingSlots} remaining)`);
      }
      
      // Send email notification
      if (username && password && productName) {
        // Check bot automation mode for ALL products
        let orderId = null;
        const isBotProduct = (productName === 'Sparx Maths' || productName === 'Sparx Reader' || productName === 'Educate' || productName === 'Seneca' || productName === 'Sparx Science');
        
        // ALWAYS create order ID for bot products (for REDO button in emails)
        if (isBotProduct) {
          orderId = `order_${session.id}_${Date.now()}`;
          pendingOrders[orderId] = {
            productName: productName,
            username: username,
            password: password,
            loginType: loginType || 'Google',
            school: school || 'Not provided',
            sessionId: session.id,
            createdAt: new Date().toISOString(),
            processed: botAutomationMode === 'auto' ? true : false // Auto mode = already processed
          };
          console.log(`📋 WEBHOOK: Order created (ID: ${orderId}) - Mode: ${botAutomationMode}`);
        }
        
        // Calculate actual dynamic price for extra slots
        let actualPrice = productPrice;
        if (isExtraSlot && dailyLimits[productName]?.extraSlots) {
          // For extra slots, price = basePrice + (count - 1)
          // Since count was already incremented, we use (currentCount - 1) to get the price this person paid
          const basePrice = dailyLimits[productName].extraSlots.basePrice;
          actualPrice = basePrice + (currentCount - 1);
          console.log(`💰 WEBHOOK: Extra slot price calculated: base £${basePrice} + ${currentCount - 1} = £${actualPrice}`);
        }
        
        console.log(`📧 WEBHOOK: Sending card payment email for ${isExtraSlot ? 'EXTRA SLOT' : 'regular slot'}...`);
        await sendLoginDetailsNotification({
          school: school || 'Not provided',
          username,
          password,
          platform: rawProductName || productName, // Use raw name for display (includes "- Extra Slot")
          sessionId: session.id,
          productName: rawProductName || productName, // Use raw name for display
          productPrice: actualPrice, // Use dynamic price for extra slots
          paymentMethod: 'card',
          remainingSlots,
          currentCount,
          maxSlots,
          isExtraSlot: isExtraSlot || false,
          isNewLogin,
          orderId: orderId, // Now set for both auto and email modes
          botMode: botAutomationMode // Pass the bot mode to email
        });
        console.log('✅ WEBHOOK: Email sent successfully');
        
        // 🤖 BOT AUTOMATION MODE CHECK
        console.log(`🎛️ WEBHOOK: Bot automation mode is: ${botAutomationMode}`);
        console.log(`🎯 WEBHOOK: Is bot product: ${isBotProduct} (${productName})`);
        
        if (isBotProduct) {
          if (botAutomationMode === 'auto') {
            // AUTO MODE: Trigger bot automatically (using SenAI with queue system)
            try {
              console.log(`🤖 WEBHOOK: [AUTO MODE] Sending order to AWS SenAI queue for ${productName}...`);
              
              const queueResponse = await fetch(`${DISCORD_BOT_API_URL}/add-to-queue`, {
                method: 'POST',
                headers: { 
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${BOT_API_SECRET}`
                },
                body: JSON.stringify({
                  orderId: orderId,
                  productName: productName,
                  username: username,
                  password: password,
                  school: school || 'Not provided',
                  loginType: loginType || 'Google'
                })
              });
              
              const queueResult = await queueResponse.json();
              
              if (queueResult.success) {
                console.log(`✅ WEBHOOK: Order added to AWS queue (Position #${queueResult.position}, Est. wait: ${queueResult.estimatedWaitMinutes}min)`);
              } else {
                console.error(`❌ WEBHOOK: Failed to add to queue: ${queueResult.error}`);
              }
            } catch (botError) {
              console.error(`❌ WEBHOOK: Error calling AWS queue:`, botError);
              console.error(`   Error message: ${botError.message}`);
            }
          } else {
            // EMAIL MODE: Wait for admin decision via email buttons
            console.log(`📧 WEBHOOK: [EMAIL MODE] Awaiting admin decision via email buttons for ${productName}`);
          }
        } else {
          console.log(`ℹ️ WEBHOOK: Not a bot product, skipping bot automation`);
        }
      }
      
      // Track login history (skip if user is whitelisted)
      const isWhitelisted = username && whitelistedUsers.includes(username);
      if (!isWhitelisted) {
        loginHistory.push({
          username,
          school: school || 'Not provided',
          productName: rawProductName || productName || 'Unknown', // Use raw name for display
          productPrice: productPrice || 'Unknown',
          paymentMethod: 'Card (Webhook)',
          timestamp: new Date().toISOString(),
          isNewLogin
        });
        console.log(`📊 WEBHOOK: Login tracked: ${username} (Total: ${loginHistory.length})`);
      } else {
        console.log(`📊 WEBHOOK: Skipping login tracking for whitelisted user: ${username}`);
      }
      
      // Update active session
      if (username && activeSessions[username]) {
        activeSessions[username].lastActive = Date.now();
      }
      
      // Save to MongoDB
      await saveData();
      console.log('✅ WEBHOOK: Purchase processed successfully');
      
    } catch (error) {
      console.error('❌ WEBHOOK: Error processing purchase:', error);
    }
  }
  
  // Return 200 to acknowledge receipt
  res.json({ received: true });
});

// NOW apply express.json() for all other routes
app.use(express.json());

// Serve static files (HTML, CSS, JS, images, etc.)
app.use(express.static(__dirname));
console.log('📁 Serving static files from:', __dirname);

// Security: Sanitize data to prevent MongoDB injection
app.use(mongoSanitize({
  replaceWith: '_'
}));

// Security: Rate limiting
// General API rate limit - 100 requests per 15 minutes
// General rate limiter - very lenient for legitimate users
// Frontend checks availability every 5 seconds, so needs high limit
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 2000, // Increased to 2000 requests per 15 min (plenty for normal use)
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many requests, please try again later.' });
  }
});

// Admin rate limiter - moderate (100 requests per 15 minutes)
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Increased from 20 to 100
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many admin requests, please try again later.' });
  }
});

// Auth rate limiter - strict but fair (30 login attempts per 15 minutes)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // Increased from 10 to 30
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many login attempts, please try again later.' });
  }
});

// Payment rate limiter - moderate (50 payment attempts per 15 minutes)
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Increased from 30 to 50
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many payment attempts, please try again later.' });
  }
});

// Apply general rate limiter to all routes (except webhook which was already handled)
app.use(generalLimiter);

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/hwplug';
console.log('🔌 Connecting to MongoDB...');

let mongoConnected = false;

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('✅ MongoDB connected successfully');
  mongoConnected = true;
}).catch(err => {
  console.error('❌ MongoDB connection error:', err);
  console.error('⚠️  Server will continue with in-memory storage (data will not persist)');
  mongoConnected = false;
});

// In-memory storage fallback for giveaway when MongoDB is not available
let inMemoryGiveaway = {
  active: false,
  wheelVisible: false,
  spinDate: '',
  minParticipants: 15,
  maxParticipants: 30,
  entries: [],
  eliminated: [],
  winner: null
};

// MongoDB Schema for persistent data
const DataSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  dailyLimits: { type: Object, default: {} },
  activeReservations: { type: Object, default: {} },
  lastTimerResetTime: { type: Number, default: Date.now },
  loginHistory: { type: Array, default: [] },
  cashPaymentCodes: { type: Array, default: [] }, // Array of valid codes for cash payments
  codeUsageHistory: { type: Array, default: [] }, // Track who used which codes
  availabilitySchedule: { type: Object, default: {} }, // Availability timing configuration
  siteDeal: { type: Object, default: {} }, // Holiday promotion / site-wide deal configuration
  bannedUsers: { type: Array, default: [] }, // List of banned users
  testMode: { type: Boolean, default: false }, // Test mode flag
  whitelistMode: { type: Boolean, default: false }, // Whitelist mode - only approved users can access
  whitelistedUsers: { type: Array, default: [] }, // List of approved usernames
  moderatorUsers: { type: Array, default: [] }, // List of moderator usernames/emails (subset of whitelist)
  updatedAt: { type: Date, default: Date.now }
});

const DataModel = mongoose.model('Data', DataSchema);

// Giveaway Schema
const GiveawaySchema = new mongoose.Schema({
  active: { type: Boolean, default: false },
  wheelVisible: { type: Boolean, default: false },
  spinDate: { type: String, default: '' },
  minParticipants: { type: Number, default: 15 }, // Minimum participants to start (1-15)
  maxParticipants: { type: Number, default: 30 }, // Maximum participants allowed to enter (configurable)
  entries: [{
    firstName: String,
    lastName: String,
    email: String,
    enteredAt: { type: Date, default: Date.now }
  }],
  eliminated: [String], // Array of eliminated names
  winner: {
    firstName: String,
    lastName: String
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const GiveawayModel = mongoose.model('Giveaway', GiveawaySchema);

// Daily purchase limit tracking (5 per product per day)
let dailyLimits = {
  'Sparx Reader': { count: 0, date: null, available: true, maxSlots: 5, extraSlots: { count: 0, max: 8, basePrice: 3, currentPrice: 3 } },
  'Sparx Maths': { count: 0, date: null, available: true, maxSlots: 5, extraSlots: { count: 0, max: 8, basePrice: 3, currentPrice: 3 } },
  'Educate': { count: 0, date: null, available: true, maxSlots: 5, extraSlots: { count: 0, max: 8, basePrice: 3, currentPrice: 3 } },
  'Seneca': { count: 0, date: null, available: true, maxSlots: 5, extraSlots: { count: 0, max: 8, basePrice: 3, currentPrice: 3 } },
  'Sparx Science': { count: 0, date: null, available: true, maxSlots: 5, extraSlots: { count: 0, max: 8, basePrice: 3, currentPrice: 3 }, comingSoon: true }
};

// Test mode flag - when enabled, shows "Come back later" screen to all users
let testMode = false;

// Whitelist mode - when enabled, only approved users can access the website
let whitelistMode = false;
let whitelistedUsers = []; // Array of approved usernames
let moderatorUsers = []; // Array of moderator usernames/emails

const MAX_PURCHASES_PER_DAY = 5; // Default starting slots per product per day (changed from 3 to 5)
const ADMIN_MAX_SLOTS = 20; // Maximum slots admin can set per product
const EXTRA_SLOT_PRICE = 3; // £3 starting price for extra slots (increases by £1 per purchase)
const EXTRA_SLOT_MAX = 8; // Maximum 8 extra slots per product (prices from £3 to £10)
const RESERVATION_TIMEOUT = 30 * 60 * 1000; // 30 minutes in milliseconds (increased for Stripe payment flow)

// Track active reservations: { reservationId: { productName, timestamp } }
let activeReservations = {};

// Store the last timer reset time (for frontend to sync) - Initialize with current time
let lastTimerResetTime = Date.now();

// Track all login history
let loginHistory = [];

// Track active sessions: { username: { lastActive: timestamp, school: '' } }
let activeSessions = {};
const SESSION_TIMEOUT = 2 * 60 * 1000; // 2 minutes of inactivity = offline

// Cash payment codes (admin can add/remove)
let cashPaymentCodes = [];

// Track code usage: { code, username, school, productName, timestamp }
let codeUsageHistory = [];

// Banned users list: { username, reason, bannedAt, bannedBy }
let bannedUsers = [];

// Availability Schedule Configuration
let availabilitySchedule = {
  weekday: { // Monday to Friday
    enabled: true,
    startTime: '11:00', // 11:00 AM
    endTime: '00:00' // 12:00 AM (midnight)
  },
  weekend: { // Saturday and Sunday
    enabled: true,
    allDay: true // 24/7
  },
  timezone: 'Europe/London' // Default timezone (can be changed from admin panel)
};

// ====== SITE DEAL / PROMOTION CONFIGURATION ======
// Holiday promotions / special deals (Bank Holiday, Christmas, Easter, etc.)
// When enabled: applies a discount to ALL regular product prices (not extra slots)
// Themes provide visual animations/banners on the website
let siteDeal = {
  enabled: false,
  discountAmount: 1, // £ off (e.g., £1 off £2 = £1 final price)
  theme: 'none', // 'none', 'christmas', 'bankHoliday', 'easter', 'newYear', 'valentines', 'halloween', 'summer', 'blackFriday'
  name: 'Special Deal', // Display name (e.g., "Bank Holiday Sale!")
  message: 'Limited Time Offer!' // Sub-message shown on banner
};

// Check if products are currently available based on schedule

// Helper function to get current date/time in configured timezone
function getConfiguredTimezoneTime() {
  const timezone = availabilitySchedule.timezone || 'Europe/London';
  
  try {
    const timezoneTimeStr = new Date().toLocaleString('en-GB', { 
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    
    // Parse the string: "DD/MM/YYYY, HH:MM:SS"
    const [datePart, timePart] = timezoneTimeStr.split(', ');
    const [day, month, year] = datePart.split('/');
    const [hours, minutes, seconds] = timePart.split(':');
    
    return {
      hours: parseInt(hours, 10),
      minutes: parseInt(minutes, 10),
      dayOfWeek: new Date(`${year}-${month}-${day}T${hours}:${minutes}:${seconds}`).getDay(),
      timeString: `${hours}:${minutes}`,
      dateString: `${year}-${month}-${day}`,
      timezone: timezone
    };
  } catch (error) {
    console.error(`❌ Invalid timezone "${timezone}", falling back to Europe/London`, error);
    availabilitySchedule.timezone = 'Europe/London';
    return getConfiguredTimezoneTime();
  }
}

// Helper function to get date string for daily resets
function getLondonDateString() {
  const timezoneTime = getConfiguredTimezoneTime();
  // Return in same format as toDateString() for compatibility
  const date = new Date(timezoneTime.dateString);
  return date.toDateString();
}

// Helper function to get yesterday's date in configured timezone
function getLondonYesterdayString() {
  const timezone = availabilitySchedule.timezone || 'Europe/London';
  
  const timezoneTimeStr = new Date().toLocaleString('en-GB', { 
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour12: false
  });
  
  // Parse the date and subtract one day
  const [datePart] = timezoneTimeStr.split(', ');
  const [day, month, year] = datePart.split('/');
  const currentDate = new Date(`${year}-${month}-${day}`);
  currentDate.setDate(currentDate.getDate() - 1);
  return currentDate.toDateString();
}

// Helper function to convert 24-hour time to 12-hour format
function formatTime12Hour(time24) {
  const [hours, minutes] = time24.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const hours12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${hours12}:${String(minutes).padStart(2, '0')} ${period}`;
}

function checkAvailability() {
  const timezoneTime = getConfiguredTimezoneTime();
  const dayOfWeek = timezoneTime.dayOfWeek; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6); // Sunday or Saturday
  
  // Get current time in HH:MM format
  const currentTime = timezoneTime.timeString;
  
  console.log(`🕐 Checking availability - Time (${timezoneTime.timezone}): ${currentTime}, Day: ${dayOfWeek}, IsWeekend: ${isWeekend}`);
  
  // Format schedules for display
  const weekdaySchedule = availabilitySchedule.weekday.enabled 
    ? `Monday-Friday: ${formatTime12Hour(availabilitySchedule.weekday.startTime)} - ${availabilitySchedule.weekday.endTime === '00:00' ? 'Midnight' : formatTime12Hour(availabilitySchedule.weekday.endTime)}`
    : 'Monday-Friday: Closed';
  const weekendSchedule = (availabilitySchedule.weekend.enabled && availabilitySchedule.weekend.allDay)
    ? 'Saturday-Sunday: Open 24/7'
    : 'Saturday-Sunday: Closed';
  const fullSchedule = `${weekdaySchedule} | ${weekendSchedule}`;
  
  if (isWeekend) {
    // Weekend: Check if allDay is enabled
    if (availabilitySchedule.weekend.enabled && availabilitySchedule.weekend.allDay) {
      return { 
        available: true,
        message: 'Products available 24/7 on weekends',
        nextAvailableTime: null,
        schedule: fullSchedule
      };
    } else {
      const weekdayStart = formatTime12Hour(availabilitySchedule.weekday.startTime);
      return {
        available: false,
        message: 'Products not available on weekends',
        nextAvailableTime: `Monday at ${weekdayStart}`,
        schedule: fullSchedule
      };
    }
  } else {
    // Weekday (Monday-Friday)
    if (!availabilitySchedule.weekday.enabled) {
      return {
        available: false,
        message: 'Products not available on weekdays',
        nextAvailableTime: availabilitySchedule.weekend.allDay ? 'Saturday (24/7)' : 'Not available',
        schedule: fullSchedule
      };
    }
    
    const startTime = availabilitySchedule.weekday.startTime;
    const endTime = availabilitySchedule.weekday.endTime;
    const startTime12 = formatTime12Hour(startTime);
    const endTime12 = formatTime12Hour(endTime);
    
    console.log(`📅 Weekday schedule - Start: ${startTime}, End: ${endTime}, Current: ${currentTime}`);
    
    // Handle midnight crossing (e.g., 01:00 to 00:00 means 1 AM to midnight)
    if (endTime === '00:00' || endTime < startTime) {
      console.log(`🌙 Midnight crossing detected - checking if ${currentTime} >= ${startTime} OR ${currentTime} < ${endTime}`);
      
      // If current time is at or after start time OR before end time (next day)
      // Fixed: Changed >= to > for startTime comparison to avoid edge case
      if (currentTime >= startTime || (endTime !== '00:00' && currentTime < endTime)) {
        console.log(`✅ AVAILABLE - Time is within schedule`);
        return {
          available: true,
          message: `Products available until midnight`,
          nextAvailableTime: null,
          schedule: fullSchedule
        };
      } else {
        console.log(`❌ NOT AVAILABLE - Time is outside schedule`);
        return {
          available: false,
          message: `Products available from ${startTime12} to Midnight`,
          nextAvailableTime: `${startTime12} today`,
          schedule: fullSchedule
        };
      }
    } else {
      // Normal time range (no midnight crossing)
      if (currentTime >= startTime && currentTime <= endTime) {
        return {
          available: true,
          message: `Products available until ${endTime12}`,
          nextAvailableTime: null,
          schedule: fullSchedule
        };
      } else if (currentTime < startTime) {
        return {
          available: false,
          message: `Products available from ${startTime12} to ${endTime12}`,
          nextAvailableTime: `${startTime12} today`,
          schedule: fullSchedule
        };
      } else {
        return {
          available: false,
          message: `Products available from ${startTime12} to ${endTime12}`,
          nextAvailableTime: `${startTime12} tomorrow`,
          schedule: fullSchedule
        };
      }
    }
  }
}

// ====== MONGODB PERSISTENT STORAGE FUNCTIONS ======

// Save data to MongoDB (async, non-blocking)
async function saveData() {
  try {
    if (mongoose.connection.readyState !== 1) {
      console.log('⚠️  MongoDB not connected, skipping save');
      return;
    }
    
    await DataModel.findOneAndUpdate(
      { key: 'main' },
      {
        key: 'main',
      dailyLimits,
      activeReservations,
      lastTimerResetTime,
      loginHistory,
      cashPaymentCodes,
      codeUsageHistory,
      availabilitySchedule,
      siteDeal,
      bannedUsers,
      testMode,
      whitelistMode,
      whitelistedUsers,
      moderatorUsers,
      updatedAt: new Date()
      },
      { upsert: true, new: true }
    );
    
    console.log('💾 Data saved to MongoDB');
  } catch (error) {
    console.error('❌ Error saving data to MongoDB:', error.message);
  }
}

// Load data from MongoDB
async function loadData() {
  try {
    if (mongoose.connection.readyState !== 1) {
      console.log('⚠️  MongoDB not connected, using default data');
      return;
    }
    
    const data = await DataModel.findOne({ key: 'main' });
    
    if (data) {
      // Restore data
      const loadedLimits = data.dailyLimits || dailyLimits;
      
      // Merge loaded data with default structure to ensure extraSlots and maxSlots are always present
      dailyLimits = {
        'Sparx Reader': {
          ...dailyLimits['Sparx Reader'],
          ...loadedLimits['Sparx Reader'],
          maxSlots: loadedLimits['Sparx Reader']?.maxSlots || 5,
          extraSlots: {
            count: loadedLimits['Sparx Reader']?.extraSlots?.count || 0,
            max: loadedLimits['Sparx Reader']?.extraSlots?.max || 8,
            basePrice: loadedLimits['Sparx Reader']?.extraSlots?.basePrice || 3,
            currentPrice: loadedLimits['Sparx Reader']?.extraSlots?.currentPrice || 3
          }
        },
        'Sparx Maths': {
          ...dailyLimits['Sparx Maths'],
          ...loadedLimits['Sparx Maths'],
          maxSlots: loadedLimits['Sparx Maths']?.maxSlots || 5,
          extraSlots: {
            count: loadedLimits['Sparx Maths']?.extraSlots?.count || 0,
            max: loadedLimits['Sparx Maths']?.extraSlots?.max || 8,
            basePrice: loadedLimits['Sparx Maths']?.extraSlots?.basePrice || 3,
            currentPrice: loadedLimits['Sparx Maths']?.extraSlots?.currentPrice || 3
          }
        },
        'Educate': {
          ...dailyLimits['Educate'],
          ...loadedLimits['Educate'],
          maxSlots: loadedLimits['Educate']?.maxSlots || 5,
          extraSlots: {
            count: loadedLimits['Educate']?.extraSlots?.count || 0,
            max: loadedLimits['Educate']?.extraSlots?.max || 8,
            basePrice: loadedLimits['Educate']?.extraSlots?.basePrice || 3,
            currentPrice: loadedLimits['Educate']?.extraSlots?.currentPrice || 3
          }
        },
        'Seneca': {
          ...dailyLimits['Seneca'],
          ...loadedLimits['Seneca'],
          maxSlots: loadedLimits['Seneca']?.maxSlots || 5,
          extraSlots: {
            count: loadedLimits['Seneca']?.extraSlots?.count || 0,
            max: loadedLimits['Seneca']?.extraSlots?.max || 8,
            basePrice: loadedLimits['Seneca']?.extraSlots?.basePrice || 3,
            currentPrice: loadedLimits['Seneca']?.extraSlots?.currentPrice || 3
          }
        },
        'Sparx Science': {
          ...dailyLimits['Sparx Science'],
          ...loadedLimits['Sparx Science'],
          maxSlots: loadedLimits['Sparx Science']?.maxSlots || 5,
          extraSlots: {
            count: loadedLimits['Sparx Science']?.extraSlots?.count || 0,
            max: loadedLimits['Sparx Science']?.extraSlots?.max || 8,
            basePrice: loadedLimits['Sparx Science']?.extraSlots?.basePrice || 3,
            currentPrice: loadedLimits['Sparx Science']?.extraSlots?.currentPrice || 3
          },
          comingSoon: loadedLimits['Sparx Science']?.comingSoon !== undefined ? loadedLimits['Sparx Science'].comingSoon : true
        }
      };
      
      activeReservations = data.activeReservations || {};
      lastTimerResetTime = data.lastTimerResetTime || Date.now();
      loginHistory.push(...(data.loginHistory || []));
      cashPaymentCodes = data.cashPaymentCodes || [];
      codeUsageHistory = data.codeUsageHistory || [];
      availabilitySchedule = data.availabilitySchedule || availabilitySchedule;
      // Merge loaded siteDeal with defaults to ensure all fields are present
      if (data.siteDeal && Object.keys(data.siteDeal).length > 0) {
        siteDeal = {
          enabled: data.siteDeal.enabled ?? false,
          discountAmount: data.siteDeal.discountAmount ?? 1,
          theme: data.siteDeal.theme || 'none',
          name: data.siteDeal.name || 'Special Deal',
          message: data.siteDeal.message || 'Limited Time Offer!'
        };
      }
      bannedUsers = data.bannedUsers || [];
      testMode = data.testMode || false;
      whitelistMode = data.whitelistMode || false;
      whitelistedUsers = data.whitelistedUsers || [];
      moderatorUsers = data.moderatorUsers || [];
      
      console.log('✅ Data loaded from MongoDB');
      console.log(`   - Last updated: ${data.updatedAt}`);
      console.log(`   - Login history entries: ${loginHistory.length}`);
      console.log(`   - Active reservations: ${Object.keys(activeReservations).length}`);
      console.log(`   - Cash payment codes: ${cashPaymentCodes.length}`);
      console.log(`   - Code usage history: ${codeUsageHistory.length}`);
      console.log(`   - Banned users: ${bannedUsers.length}`);
      console.log(`   - Availability schedule:`, availabilitySchedule);
      console.log(`   - Whitelist mode: ${whitelistMode ? 'ENABLED' : 'disabled'} (${whitelistedUsers.length} users)`);
      console.log(`   - Slot counts:`, Object.entries(dailyLimits).map(([k, v]) => `${k}: ${v.count}${v.extraSlots ? ` (extra: ${v.extraSlots.count}/${v.extraSlots.max})` : ''}`).join(', '));
    } else {
      console.log('📝 No saved data found in MongoDB, starting fresh');
      await saveData(); // Create initial document
    }
  } catch (error) {
    console.error('❌ Error loading data from MongoDB:', error.message);
  }
}

// Load data on startup (after MongoDB connects)
mongoose.connection.once('open', async () => {
  await loadData();
});

  // Clean up expired reservations (run every minute)
setInterval(() => {
  const now = Date.now();
  let hasChanges = false;
  Object.keys(activeReservations).forEach(reservationId => {
    const reservation = activeReservations[reservationId];
    const age = now - reservation.timestamp;
    if (age > RESERVATION_TIMEOUT) {
      // Release expired reservation
      const productName = reservation.productName;
      
      // Check if this is an extra slot reservation
      if (reservation.isExtraSlot && dailyLimits[productName]?.extraSlots) {
        if (dailyLimits[productName].extraSlots.count > 0) {
          const oldCount = dailyLimits[productName].extraSlots.count;
          dailyLimits[productName].extraSlots.count--;
          
          // Decrement price back (since expired slot is released)
          if (dailyLimits[productName].extraSlots.currentPrice > dailyLimits[productName].extraSlots.basePrice) {
            dailyLimits[productName].extraSlots.currentPrice--;
          }
          
          const newCount = dailyLimits[productName].extraSlots.count;
          console.log(`⏰ Expired EXTRA SLOT reservation released for "${productName}": ${oldCount} → ${newCount}/${dailyLimits[productName].extraSlots.max} - Price reset to £${dailyLimits[productName].extraSlots.currentPrice} (ID: ${reservationId}, age: ${Math.round(age / 60000)} min)`);
          hasChanges = true;
        } else {
          console.log(`⏰ Expired EXTRA SLOT reservation for "${productName}" but count already at 0 (ID: ${reservationId}, age: ${Math.round(age / 60000)} min)`);
        }
      } else {
        // Regular slot reservation
        if (dailyLimits[productName] && dailyLimits[productName].count > 0) {
          const oldCount = dailyLimits[productName].count;
          dailyLimits[productName].count--;
          const newCount = dailyLimits[productName].count;
          console.log(`⏰ Expired reservation released for "${productName}": ${oldCount} → ${newCount} (ID: ${reservationId}, age: ${Math.round(age / 60000)} min)`);
          hasChanges = true;
        } else {
          console.log(`⏰ Expired reservation for "${productName}" but count already at 0 (ID: ${reservationId}, age: ${Math.round(age / 60000)} min)`);
        }
      }
      
      delete activeReservations[reservationId];
      hasChanges = true;
    }
  });
  if (hasChanges) {
    saveData();
  }
}, 60000); // Check every minute

// Clean up inactive sessions (run every minute)
setInterval(() => {
  const now = Date.now();
  Object.keys(activeSessions).forEach(username => {
    const session = activeSessions[username];
    const inactiveTime = now - session.lastActive;
    if (inactiveTime > SESSION_TIMEOUT) {
      console.log(`👋 User "${username}" is now inactive (${Math.round(inactiveTime / 60000)} min)`);
      delete activeSessions[username];
    }
  });
}, 60000); // Check every minute

// Reset counters if it's a new day
function resetDailyCountersIfNeeded() {
  const today = getLondonDateString();
  let hasChanges = false;
  Object.keys(dailyLimits).forEach(product => {
    if (dailyLimits[product].date !== today) {
      // Only reset slots for products that are currently AVAILABLE
      if (dailyLimits[product].available) {
        dailyLimits[product].count = 0;
        dailyLimits[product].date = today;
        
        // Reset extra slots for all products
        if (dailyLimits[product].extraSlots) {
          dailyLimits[product].extraSlots.count = 0;
          dailyLimits[product].extraSlots.currentPrice = dailyLimits[product].extraSlots.basePrice; // Reset price
          console.log(`✅ Extra slots also reset for "${product}" (price reset to £${dailyLimits[product].extraSlots.basePrice})`);
        }
        
        hasChanges = true;
        console.log(`✅ Slots reset for AVAILABLE product: "${product}" (0/${MAX_PURCHASES_PER_DAY})`);
      } else {
        // Product is disabled - just update the date but DON'T reset count
        dailyLimits[product].date = today;
        console.log(`⏭️ Product "${product}" is DISABLED - slots NOT reset (keeping ${dailyLimits[product].count}/${MAX_PURCHASES_PER_DAY})`);
      }
    }
  });
  if (hasChanges) {
    lastTimerResetTime = Date.now(); // Update timer for frontend countdown
    console.log('🔄 Daily counters reset (new day) - only for available products');
    console.log(`⏰ Timer reset time updated: ${new Date(lastTimerResetTime).toLocaleString()}`);
    saveData();
  }
}

// Check product availability endpoint
app.get('/check-product-availability', (req, res) => {
  resetDailyCountersIfNeeded();
  const productName = req.query.product;
  
  if (!productName || !dailyLimits[productName]) {
    return res.json({ available: false, error: 'Product not found' });
  }
  
  const product = dailyLimits[productName];
  
  // Check if store is open based on availability schedule
  const availabilityStatus = checkAvailability();
  if (!availabilityStatus.available) {
    return res.json({
      available: false,
      remaining: 0,
      count: product.count,
      max: MAX_PURCHASES_PER_DAY,
      timeRestricted: true,
      message: availabilityStatus.message,
      nextAvailableTime: availabilityStatus.nextAvailableTime,
      extraSlots: product.extraSlots || null
    });
  }
  
  // Check if product is manually set as unavailable
  if (!product.available) {
    return res.json({
      available: false,
      remaining: 0,
      count: product.count,
      max: MAX_PURCHASES_PER_DAY,
      manuallyDisabled: true,
      timeRestricted: false,
      extraSlots: product.extraSlots || null
    });
  }
  
  // Check if product is in Coming Soon mode
  if (product.comingSoon) {
    return res.json({
      available: false,
      remaining: 0,
      count: product.count,
      max: MAX_PURCHASES_PER_DAY,
      comingSoon: true,
      timeRestricted: false,
      manuallyDisabled: false,
      extraSlots: product.extraSlots || null
    });
  }
  
  // Check if regular slots are full
  const regularAvailable = product.count < MAX_PURCHASES_PER_DAY;
  const remaining = Math.max(0, MAX_PURCHASES_PER_DAY - product.count);
  
  // Check extra slots availability for all products
  let extraSlotsInfo = null;
  if (product.extraSlots) {
    const extraSlotsAvailable = !regularAvailable && product.extraSlots.count < product.extraSlots.max;
    extraSlotsInfo = {
      available: extraSlotsAvailable,
      count: product.extraSlots.count,
      max: product.extraSlots.max,
      price: product.extraSlots.currentPrice, // Dynamic price (increases by £1 per purchase)
      basePrice: product.extraSlots.basePrice, // Starting price
      nextPrice: product.extraSlots.currentPrice + 1 // What next person will pay (if they reserve)
    };
  }
  
  res.json({
    available: regularAvailable,
    remaining: remaining,
    count: product.count,
    max: MAX_PURCHASES_PER_DAY,
    manuallyDisabled: false,
    timeRestricted: false,
    extraSlots: extraSlotsInfo
  });
});

// Reserve a slot (atomically check and increment) - prevents race conditions
app.post('/reserve-slot', (req, res) => {
  resetDailyCountersIfNeeded();
  const { productName, isExtraSlot, username } = req.body;
  
  if (!productName || !dailyLimits[productName]) {
    return res.status(400).json({ success: false, error: 'Product not found' });
  }
  
  // **FIX DOUBLE-COUNTING BUG:** Check if user already has an active reservation for this product
  if (username) {
    const existingReservation = Object.entries(activeReservations).find(([id, reservation]) => {
      // Check if this user has an active reservation for the same product
      return reservation.productName === productName && 
             reservation.username === username &&
             (!!reservation.isExtraSlot === !!isExtraSlot); // Same slot type
    });
    
    if (existingReservation) {
      const [existingId, existingRes] = existingReservation;
      const ageMinutes = Math.round((Date.now() - existingRes.timestamp) / 60000);
      console.log(`⚠️ User "${username}" already has an active reservation for "${productName}" (ID: ${existingId}, age: ${ageMinutes} min) - returning existing reservation`);
      return res.json({
        success: true,
        reserved: true,
        reservationId: existingId,
        isExtraSlot: !!existingRes.isExtraSlot,
        isDuplicate: true, // Flag to indicate this is a duplicate request
        message: 'You already have an active reservation for this product'
      });
    }
  }
  
  const product = dailyLimits[productName];
  
  // Check if product is manually disabled
  if (!product.available) {
    return res.json({ 
      success: false, 
      error: 'Product is not available right now',
      manuallyDisabled: true
    });
  }
  
  // Check if product is in Coming Soon mode
  if (product.comingSoon) {
    return res.json({ 
      success: false, 
      error: 'This product is coming soon! Stay tuned.',
      comingSoon: true
    });
  }
  
  // Check if test mode is active (block purchases unless user is whitelisted)
  if (testMode) {
    // Test mode is active - check if user is whitelisted
    const isWhitelisted = username && whitelistedUsers.includes(username);
    if (!isWhitelisted) {
      console.log(`⚠️ Test mode active - blocking reservation for non-whitelisted user: ${username || 'unknown'}`);
      return res.json({
        success: false,
        error: 'Website is in test mode. Please refresh the page.',
        testMode: true
      });
    }
    console.log(`✅ Test mode active but user ${username} is whitelisted - allowing purchase`);
  }
  
  // Check availability schedule (time-based)
  const availabilityStatus = checkAvailability();
  if (!availabilityStatus.available) {
    return res.json({
      success: false,
      error: availabilityStatus.message,
      nextAvailableTime: availabilityStatus.nextAvailableTime,
      timeRestricted: true
    });
  }
  
  // Handle EXTRA SLOT for all products
  if (isExtraSlot) {
    // Check if regular slots are full
    if (product.count < MAX_PURCHASES_PER_DAY) {
      return res.json({
        success: false,
        error: 'Regular slots are still available. Extra slots only available when regular slots are full.'
      });
    }
    
    // Check if extra slots are available
    if (!product.extraSlots || product.extraSlots.count >= product.extraSlots.max) {
      return res.json({
        success: false,
        error: 'Extra slots are finished for today',
        extraSlotsFull: true
      });
    }
    
    // Reserve extra slot
    const oldExtraCount = product.extraSlots.count;
    const currentPrice = product.extraSlots.currentPrice; // Capture current price for THIS purchase
    
    product.extraSlots.count++;
    const extraRemaining = product.extraSlots.max - product.extraSlots.count;
    
    // Increment price for NEXT person (dynamic pricing: £3, £4, £5, etc.)
    product.extraSlots.currentPrice++;
    
    const reservationId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    activeReservations[reservationId] = {
      productName: productName,
      timestamp: Date.now(),
      isExtraSlot: true,
      extraSlotPrice: currentPrice, // Store the price THIS user will pay
      username: username || 'unknown' // Track who made the reservation
    };
    
    console.log(`💎 EXTRA SLOT RESERVED for "${productName}": ${oldExtraCount} → ${product.extraSlots.count}/${product.extraSlots.max} (${extraRemaining} remaining) - Price: £${currentPrice} (next: £${product.extraSlots.currentPrice}) - Reservation ID: ${reservationId}`);
    
    saveData();
    
    return res.json({
      success: true,
      reserved: true,
      reservationId: reservationId,
      isExtraSlot: true,
      extraSlotCount: product.extraSlots.count,
      extraSlotMax: product.extraSlots.max,
      extraSlotPrice: currentPrice, // Return the price for THIS purchase
      nextExtraSlotPrice: product.extraSlots.currentPrice, // Next person will pay this
      wasLastExtraSlot: extraRemaining === 0
    });
  }
  
  // REGULAR SLOT RESERVATION
  // ATOMIC check and increment (prevents race condition)
  if (product.count >= MAX_PURCHASES_PER_DAY) {
    // Check if any product has extra slots available
    if (product.extraSlots && product.extraSlots.count < product.extraSlots.max) {
      return res.json({ 
        success: false, 
        error: 'Regular slots are finished',
        remaining: 0,
        count: product.count,
        extraSlotsAvailable: true,
        extraSlotPrice: EXTRA_SLOT_PRICE
      });
    }
    
    return res.json({ 
      success: false, 
      error: 'Slots are finished for today',
      remaining: 0,
      count: product.count
    });
  }
  
  // CRITICAL: Increment IMMEDIATELY before any other operation
  const oldCount = product.count;
  product.count++;
  const remaining = MAX_PURCHASES_PER_DAY - product.count;
  
  // Create reservation ID and track it
  const reservationId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  activeReservations[reservationId] = {
    productName: productName,
    timestamp: Date.now(),
    isExtraSlot: false,
    username: username || 'unknown' // Track who made the reservation
  };
  
  const wasLastSlot = remaining === 0;
  console.log(`🔒 Slot RESERVED for "${productName}": ${oldCount} → ${product.count}/${MAX_PURCHASES_PER_DAY} (${remaining} remaining)${wasLastSlot ? ' ⚠️ LAST SLOT!' : ''} - Reservation ID: ${reservationId} (timeout: ${RESERVATION_TIMEOUT / 60000} min)`);
  
  // Save to disk immediately
  saveData();
  
  res.json({
    success: true,
    reserved: true,
    reservationId: reservationId,
    count: product.count,
    remaining: remaining,
    max: MAX_PURCHASES_PER_DAY,
    wasLastSlot: wasLastSlot,
    isExtraSlot: false
  });
});

// Release a reserved slot (if user abandons payment)
app.post('/release-slot', (req, res) => {
  resetDailyCountersIfNeeded();
  const { reservationId, productName } = req.body;
  
  if (!reservationId || !productName) {
    return res.status(400).json({ success: false, error: 'Reservation ID and product name required' });
  }
  
  // Check if reservation exists
  if (!activeReservations[reservationId]) {
    return res.json({ 
      success: false, 
      error: 'Reservation not found or already released',
      message: 'Slot may have already been released or expired'
    });
  }
  
  const reservation = activeReservations[reservationId];
  
  // Verify product matches
  if (reservation.productName !== productName) {
    return res.status(400).json({ success: false, error: 'Product name mismatch' });
  }
  
  // Check if this was an extra slot reservation
  if (reservation.isExtraSlot) {
    // Release extra slot
    if (dailyLimits[productName].extraSlots && dailyLimits[productName].extraSlots.count > 0) {
      dailyLimits[productName].extraSlots.count--;
      
      // Decrement price back (since slot was released)
      if (dailyLimits[productName].extraSlots.currentPrice > dailyLimits[productName].extraSlots.basePrice) {
        dailyLimits[productName].extraSlots.currentPrice--;
      }
      
      const extraRemaining = dailyLimits[productName].extraSlots.max - dailyLimits[productName].extraSlots.count;
      
      delete activeReservations[reservationId];
      console.log(`🔓 EXTRA SLOT RELEASED for "${productName}": ${dailyLimits[productName].extraSlots.count}/${dailyLimits[productName].extraSlots.max} - Price reset to £${dailyLimits[productName].extraSlots.currentPrice} - Reservation ID: ${reservationId}`);
      
      saveData();
      
      return res.json({
        success: true,
        released: true,
        isExtraSlot: true,
        extraSlotCount: dailyLimits[productName].extraSlots.count,
        extraSlotMax: dailyLimits[productName].extraSlots.max,
        currentExtraSlotPrice: dailyLimits[productName].extraSlots.currentPrice
      });
    }
  }
  
  // Release regular slot by decrementing
  if (dailyLimits[productName] && dailyLimits[productName].count > 0) {
    dailyLimits[productName].count--;
    const remaining = MAX_PURCHASES_PER_DAY - dailyLimits[productName].count;
    
    // Remove reservation
    delete activeReservations[reservationId];
    
    console.log(`🔓 Slot RELEASED for "${productName}": ${dailyLimits[productName].count}/${MAX_PURCHASES_PER_DAY} (${remaining} remaining) - Reservation ID: ${reservationId}`);
    
    // Save to disk
    saveData();
    
    res.json({
      success: true,
      released: true,
      count: dailyLimits[productName].count,
      remaining: remaining,
      max: MAX_PURCHASES_PER_DAY,
      isExtraSlot: false
    });
  } else {
    // Already released or count is 0
    delete activeReservations[reservationId];
    saveData();
    res.json({
      success: false,
      error: 'Slot was already released',
      count: dailyLimits[productName] ? dailyLimits[productName].count : 0
    });
  }
});

// Increment product purchase count (kept for backward compatibility)
app.post('/increment-product-count', (req, res) => {
  resetDailyCountersIfNeeded();
  const { productName } = req.body;
  
  if (!productName || !dailyLimits[productName]) {
    return res.status(400).json({ error: 'Product not found' });
  }
  
  if (dailyLimits[productName].count >= MAX_PURCHASES_PER_DAY) {
    return res.status(400).json({ error: 'Daily limit reached for this product' });
  }
  
  dailyLimits[productName].count++;
  res.json({
    success: true,
    count: dailyLimits[productName].count,
    remaining: MAX_PURCHASES_PER_DAY - dailyLimits[productName].count
  });
});

// Admin endpoint to reset all counters
app.post('/admin/reset-counters', async (req, res) => {
  const { password } = req.body;
  // Admin password must be set in environment variables
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin password not configured' });
  }
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  // Clear all active reservations when resetting counters
  const clearedReservations = Object.keys(activeReservations).length;
  Object.keys(activeReservations).forEach(reservationId => {
    delete activeReservations[reservationId];
  });
  
  Object.keys(dailyLimits).forEach(product => {
    dailyLimits[product].count = 0;
    dailyLimits[product].date = getLondonDateString();
    
    // Reset extra slots for all products
    if (dailyLimits[product].extraSlots) {
      dailyLimits[product].extraSlots.count = 0;
      console.log(`✅ Extra slots also reset for "${product}"`);
    }
  });
  
  console.log(`🔄 Admin reset: All counters reset to 0, cleared ${clearedReservations} active reservations`);
  
  // Save to disk
  saveData();
  
  // 🤖 ALSO RESET THE BOT'S DAILY COUNTER
  let botResetStatus = null;
  try {
    console.log(`🤖 ADMIN: Also resetting bot's daily counter at ${DISCORD_BOT_API_URL}...`);
    const botResetResponse = await fetch(`${DISCORD_BOT_API_URL}/admin/reset-counter`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BOT_API_SECRET}`
      },
      body: JSON.stringify({ password: ADMIN_PASSWORD })
    });
    
    if (botResetResponse.ok) {
      botResetStatus = await botResetResponse.json();
      console.log(`✅ ADMIN: Bot counter also reset successfully! Old: ${botResetStatus.oldCount}, New: ${botResetStatus.newCount}`);
    } else {
      console.error(`❌ ADMIN: Bot counter reset failed with status ${botResetResponse.status}`);
      botResetStatus = { error: `Bot API returned status ${botResetResponse.status}` };
    }
  } catch (botError) {
    console.error(`❌ ADMIN: Error resetting bot counter:`, botError.message);
    botResetStatus = { error: botError.message };
  }
  
  res.json({
    success: true,
    message: 'All counters reset successfully',
    counters: dailyLimits,
    clearedReservations: clearedReservations,
    botReset: botResetStatus
  });
});

// Admin endpoint to reset individual product counter
app.post('/admin/reset-product-counter', async (req, res) => {
  const { password, productName, product } = req.body;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin password not configured' });
  }
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const targetProduct = product || productName;
  
  if (!targetProduct || !dailyLimits[targetProduct]) {
    return res.status(400).json({ error: `Product not found: ${targetProduct}` });
  }
  
  // Clear active reservations for this product when resetting
  let clearedReservations = 0;
  Object.keys(activeReservations).forEach(reservationId => {
    if (activeReservations[reservationId].productName === targetProduct) {
      delete activeReservations[reservationId];
      clearedReservations++;
    }
  });
  
  dailyLimits[targetProduct].count = 0;
  dailyLimits[targetProduct].date = getLondonDateString();
  
  // Also reset extra slots for all products
  if (dailyLimits[targetProduct].extraSlots) {
    dailyLimits[targetProduct].extraSlots.count = 0;
    console.log(`✅ Extra slots also reset for "${targetProduct}"`);
  }
  
  console.log(`🔄 Admin reset: Product "${targetProduct}" counter reset to 0, cleared ${clearedReservations} active reservations`);
  
  // Save to disk
  saveData();
  
  // 🤖 ALSO RESET THE BOT'S DAILY COUNTER (for bot-enabled products)
  const botProducts = ['Sparx Maths', 'Sparx Reader'];
  let botResetStatus = null;
  
  if (botProducts.includes(productName)) {
    try {
      console.log(`🤖 ADMIN: Also resetting bot's daily counter at ${DISCORD_BOT_API_URL}...`);
      const botResetResponse = await fetch(`${DISCORD_BOT_API_URL}/admin/reset-counter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: ADMIN_PASSWORD })
      });
      
      if (botResetResponse.ok) {
        botResetStatus = await botResetResponse.json();
        console.log(`✅ ADMIN: Bot counter also reset successfully! Old: ${botResetStatus.oldCount}, New: ${botResetStatus.newCount}`);
      } else {
        console.error(`❌ ADMIN: Bot counter reset failed with status ${botResetResponse.status}`);
        botResetStatus = { error: `Bot API returned status ${botResetResponse.status}` };
      }
    } catch (botError) {
      console.error(`❌ ADMIN: Error resetting bot counter:`, botError.message);
      botResetStatus = { error: botError.message };
    }
  }
  
  res.json({
    success: true,
    message: `Counter reset for ${productName}`,
    product: productName,
    botReset: botResetStatus,
    counter: dailyLimits[productName],
    clearedReservations: clearedReservations
  });
});

// Admin endpoint to set product availability (all products)
app.post('/admin/set-product-availability', (req, res) => {
  const { password, available } = req.body;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin password not configured' });
  }
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  // Update all products availability
  Object.keys(dailyLimits).forEach(product => {
    dailyLimits[product].available = available === true;
  });
  
  // Save to disk
  saveData();
  
  res.json({
    success: true,
    message: `All products ${available ? 'marked as available' : 'marked as not available'}`,
    availability: available
  });
});

// Admin endpoint to toggle individual product availability
app.post('/admin/toggle-product-availability', (req, res) => {
  const { password, productName, product, available } = req.body;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin password not configured' });
  }
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const targetProduct = product || productName;
  
  if (!targetProduct || !dailyLimits[targetProduct]) {
    return res.status(400).json({ error: `Product not found: ${targetProduct}` });
  }
  
  // Toggle individual product availability
  dailyLimits[targetProduct].available = available === true;
  
  // Save to disk
  saveData();
  
  res.json({
    success: true,
    message: `${targetProduct} ${available ? 'marked as available' : 'marked as not available'}`,
    product: targetProduct,
    availability: available
  });
});

// Admin endpoint to toggle Coming Soon mode for a product
app.post('/admin/toggle-coming-soon', (req, res) => {
  const { password, productName, product, comingSoon } = req.body;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin password not configured' });
  }
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const targetProduct = product || productName;
  
  if (!targetProduct || !dailyLimits[targetProduct]) {
    return res.status(400).json({ error: `Product not found: ${targetProduct}` });
  }
  
  // Toggle Coming Soon mode for the product
  dailyLimits[targetProduct].comingSoon = comingSoon === true;
  
  // Save to disk
  saveData();
  
  res.json({
    success: true,
    message: `${targetProduct} Coming Soon mode ${comingSoon ? 'enabled' : 'disabled'}`,
    product: targetProduct,
    comingSoon: comingSoon
  });
});

// Admin endpoint to set custom slot count for a product
app.post('/admin/set-slot-count', (req, res) => {
  const { password, productName, product, slotCount, count } = req.body;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin password not configured' });
  }
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  // Accept both 'product' and 'productName', 'count' and 'slotCount'
  const targetProduct = product || productName;
  const newCount = parseInt(count || slotCount);
  
  if (!targetProduct || !dailyLimits[targetProduct]) {
    return res.status(400).json({ error: `Product not found: ${targetProduct}` });
  }
  
  // Validate slot count
  if (isNaN(newCount) || newCount < 0) {
    return res.status(400).json({ error: 'Invalid slot count. Must be a positive number.' });
  }
  
  if (newCount > ADMIN_MAX_SLOTS) {
    return res.status(400).json({ 
      error: `Slot count cannot exceed maximum (${ADMIN_MAX_SLOTS}).` 
    });
  }
  
  const oldCount = dailyLimits[targetProduct].count;
  dailyLimits[targetProduct].count = newCount;
  const remaining = Math.max(0, MAX_PURCHASES_PER_DAY - newCount);
  
  console.log(`🔧 Admin: Set slot count for "${targetProduct}": ${oldCount} → ${newCount} (${remaining} remaining)`);
  
  // Save to disk
  saveData();
  
  res.json({
    success: true,
    message: `Slot count for ${targetProduct} set to ${newCount}`,
    product: targetProduct,
    oldCount: oldCount,
    newCount: newCount,
    remaining: remaining,
    max: MAX_PURCHASES_PER_DAY
  });
});

// Admin endpoint to set max available slots for a product
app.post('/admin/set-max-slots', (req, res) => {
  const { password, productName, product, maxSlots } = req.body;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin password not configured' });
  }
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const targetProduct = product || productName;
  
  if (!targetProduct || !dailyLimits[targetProduct]) {
    return res.status(400).json({ error: `Product not found: ${targetProduct}` });
  }
  
  // Validate max slots
  const newMax = parseInt(maxSlots);
  if (isNaN(newMax) || newMax < 1) {
    return res.status(400).json({ error: 'Max slots must be at least 1.' });
  }
  
  if (newMax > ADMIN_MAX_SLOTS) {
    return res.status(400).json({ 
      error: `Max slots cannot exceed ${ADMIN_MAX_SLOTS}.` 
    });
  }
  
  const oldMax = dailyLimits[targetProduct].maxSlots || MAX_PURCHASES_PER_DAY;
  dailyLimits[targetProduct].maxSlots = newMax;
  
  console.log(`🔧 Admin: Set max available slots for "${targetProduct}": ${oldMax} → ${newMax}`);
  
  // Save to disk
  saveData();
  
  res.json({
    success: true,
    message: `Max slots for ${targetProduct} set to ${newMax}`,
    product: targetProduct,
    oldMax: oldMax,
    newMax: newMax
  });
});

// Admin endpoint to set extra slot max for a product (Sparx Reader)
app.post('/admin/set-extra-slot-max', (req, res) => {
  const { password, productName, product, maxSlots, max } = req.body;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin password not configured' });
  }
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const targetProduct = product || productName;
  const newMax = parseInt(max || maxSlots);
  
  if (!targetProduct || !dailyLimits[targetProduct]) {
    return res.status(400).json({ error: `Product not found: ${targetProduct}` });
  }
  
  // Check if product has extra slots feature
  if (!dailyLimits[targetProduct].extraSlots) {
    return res.status(400).json({ error: 'This product does not support extra slots' });
  }
  
  // Validate max slots
  if (isNaN(newMax) || newMax < 0) {
    return res.status(400).json({ error: 'Invalid max slots. Must be 0 or greater.' });
  }
  
  if (newMax > 50) {
    return res.status(400).json({ error: 'Extra slot max cannot exceed 50.' });
  }
  
  const oldMax = dailyLimits[targetProduct].extraSlots.max;
  dailyLimits[targetProduct].extraSlots.max = newMax;
  
  // If current count exceeds new max, adjust it
  if (dailyLimits[targetProduct].extraSlots.count > newMax) {
    dailyLimits[targetProduct].extraSlots.count = newMax;
  }
  
  console.log(`💎 Admin: Set extra slot max for "${targetProduct}": ${oldMax} → ${newMax}`);
  
  // Save to MongoDB
  saveData();
  
  res.json({
    success: true,
    message: `Extra slot max for ${targetProduct} set to ${newMax}`,
    product: targetProduct,
    oldMax: oldMax,
    newMax: newMax,
    currentCount: dailyLimits[targetProduct].extraSlots.count
  });
});

// Admin endpoint to set extra slot COUNT (for manual adjustments)
app.post('/admin/set-extra-slot-count', (req, res) => {
  const { password, productName, product, count } = req.body;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin password not configured' });
  }
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const targetProduct = product || productName;
  
  if (!targetProduct || !dailyLimits[targetProduct]) {
    return res.status(400).json({ error: `Product not found: ${targetProduct}` });
  }
  
  // Check if product has extra slots feature
  if (!dailyLimits[targetProduct].extraSlots) {
    return res.status(400).json({ error: 'This product does not support extra slots' });
  }
  
  // Validate count
  const newCount = parseInt(count);
  if (isNaN(newCount) || newCount < 0) {
    return res.status(400).json({ error: 'Invalid count. Must be 0 or greater.' });
  }
  
  const maxSlots = dailyLimits[targetProduct].extraSlots.max;
  if (newCount > maxSlots) {
    return res.status(400).json({ error: `Extra slot count cannot exceed max (${maxSlots}).` });
  }
  
  const oldCount = dailyLimits[targetProduct].extraSlots.count;
  dailyLimits[targetProduct].extraSlots.count = newCount;
  
  // Adjust currentPrice based on new count (price increases by £1 per slot used)
  dailyLimits[targetProduct].extraSlots.currentPrice = dailyLimits[targetProduct].extraSlots.basePrice + newCount;
  
  console.log(`💎 Admin: Set extra slot count for "${targetProduct}": ${oldCount} → ${newCount} (price: £${dailyLimits[targetProduct].extraSlots.currentPrice})`);
  
  // Save to MongoDB
  saveData();
  
  res.json({
    success: true,
    message: `Extra slot count for ${targetProduct} set to ${newCount}`,
    product: targetProduct,
    oldCount: oldCount,
    newCount: newCount,
    max: maxSlots,
    currentPrice: dailyLimits[targetProduct].extraSlots.currentPrice
  });
});

// Admin endpoint to set extra slot BASE PRICE
app.post('/admin/set-extra-slot-price', (req, res) => {
  const { password, productName, product, basePrice, price } = req.body;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin password not configured' });
  }
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const targetProduct = product || productName;
  const newPrice = parseInt(price || basePrice);
  
  if (!targetProduct || !dailyLimits[targetProduct]) {
    return res.status(400).json({ error: `Product not found: ${targetProduct}` });
  }
  
  // Check if product has extra slots feature
  if (!dailyLimits[targetProduct].extraSlots) {
    return res.status(400).json({ error: 'This product does not support extra slots' });
  }
  
  // Validate price
  if (isNaN(newPrice) || newPrice < 1) {
    return res.status(400).json({ error: 'Invalid price. Must be £1 or greater.' });
  }
  
  if (newPrice > 50) {
    return res.status(400).json({ error: 'Price cannot exceed £50.' });
  }
  
  const oldPrice = dailyLimits[targetProduct].extraSlots.basePrice;
  dailyLimits[targetProduct].extraSlots.basePrice = newPrice;
  
  // Recalculate current price based on how many slots are used
  const slotsUsed = dailyLimits[targetProduct].extraSlots.count;
  dailyLimits[targetProduct].extraSlots.currentPrice = newPrice + slotsUsed;
  
  console.log(`💰 Admin: Set extra slot base price for "${targetProduct}": £${oldPrice} → £${newPrice} (current: £${dailyLimits[targetProduct].extraSlots.currentPrice})`);
  
  // Save to MongoDB
  saveData();
  
  res.json({
    success: true,
    message: `Extra slot base price for ${targetProduct} set to £${newPrice}`,
    product: targetProduct,
    oldPrice: oldPrice,
    newPrice: newPrice,
    currentPrice: dailyLimits[targetProduct].extraSlots.currentPrice,
    slotsUsed: slotsUsed
  });
});

// Admin endpoint to get current counter status
app.get('/admin/counters-status', (req, res) => {
  resetDailyCountersIfNeeded();
  res.json({
    success: true,
    counters: dailyLimits,
    maxPerDay: MAX_PURCHASES_PER_DAY,
    testMode: testMode,
    whitelistMode: whitelistMode,
    whitelistedUsers: whitelistedUsers,
    moderatorUsers: moderatorUsers
  });
});

// Revenue stats endpoint for admin dashboard
app.get('/api/admin/revenue-stats', (req, res) => {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // Week starts on Monday
    const currentDay = now.getDay();
    const daysSinceMonday = currentDay === 0 ? 6 : currentDay - 1;
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday);
    weekStart.setHours(0, 0, 0, 0);
    
    // Month starts on the 1st
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    monthStart.setHours(0, 0, 0, 0);

    // Count purchases by time period (each purchase is £2)
    let todayCount = 0;
    let weekCount = 0;
    let monthCount = 0;
    let totalCount = loginHistory.length;

    loginHistory.forEach(login => {
      const loginDate = new Date(login.timestamp);
      if (loginDate >= todayStart) todayCount++;
      if (loginDate >= weekStart) weekCount++;
      if (loginDate >= monthStart) monthCount++;
    });

    res.json({
      today: todayCount,
      week: weekCount,
      month: monthCount,
      total: totalCount
    });
  } catch (error) {
    console.error('Error calculating revenue stats:', error);
    res.status(500).json({ error: 'Failed to calculate revenue stats' });
  }
});

// Check test mode status (public endpoint)
app.get('/check-test-mode', (req, res) => {
  res.json({
    testMode: testMode
  });
});

// Admin endpoint to toggle test mode
app.post('/admin/toggle-test-mode', (req, res) => {
  const { password, enabled } = req.body;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin password not configured' });
  }
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  testMode = enabled === true;
  
  console.log(`🧪 Test mode ${testMode ? 'ENABLED' : 'DISABLED'} by admin`);
  
  // Save to MongoDB
  saveData();
  
  res.json({
    success: true,
    testMode: testMode,
    message: testMode ? 'Test mode enabled - users will see maintenance screen' : 'Test mode disabled - website is live'
  });
});

// ====== WHITELIST MODE ENDPOINTS ======

// Check if a username is whitelisted (public endpoint - used by frontend)
app.post('/check-whitelist', (req, res) => {
  const { username } = req.body;
  
  if (!username) {
    return res.status(400).json({ error: 'Username required' });
  }
  
  res.json({
    whitelistMode: whitelistMode,
    isWhitelisted: whitelistMode ? whitelistedUsers.includes(username) : true // If whitelist disabled, everyone is allowed
  });
});

// Admin endpoint to toggle whitelist mode
app.post('/admin/toggle-whitelist-mode', (req, res) => {
  const { password, enabled } = req.body;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin password not configured' });
  }
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  whitelistMode = enabled === true;
  
  console.log(`🔒 Whitelist mode ${whitelistMode ? 'ENABLED' : 'DISABLED'} by admin`);
  console.log(`   Currently whitelisted users: ${whitelistedUsers.length > 0 ? whitelistedUsers.join(', ') : 'none'}`);
  
  // Save to MongoDB
  saveData();
  
  res.json({
    success: true,
    whitelistMode: whitelistMode,
    whitelistedUsers: whitelistedUsers,
    moderatorUsers: moderatorUsers,
    message: whitelistMode ? 'Whitelist mode enabled - only approved users can access' : 'Whitelist mode disabled - all users can access'
  });
});

// Admin endpoint to add user to whitelist
app.post('/admin/add-to-whitelist', (req, res) => {
  const { password, username } = req.body;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin password not configured' });
  }
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  if (!username || username.trim() === '') {
    return res.status(400).json({ error: 'Username required' });
  }
  
  const cleanUsername = username.trim();
  
  if (whitelistedUsers.includes(cleanUsername)) {
    return res.json({
      success: false,
      error: 'User already whitelisted',
      whitelistedUsers: whitelistedUsers
    });
  }
  
  whitelistedUsers.push(cleanUsername);
  
  console.log(`✅ User "${cleanUsername}" added to whitelist by admin`);
  console.log(`   Total whitelisted users: ${whitelistedUsers.length}`);
  
  // Save to MongoDB
  saveData();
  
  res.json({
    success: true,
    whitelistedUsers: whitelistedUsers,
    moderatorUsers: moderatorUsers,
    message: `User "${cleanUsername}" added to whitelist`
  });
});

// Admin endpoint to remove user from whitelist
app.post('/admin/remove-from-whitelist', (req, res) => {
  const { password, username } = req.body;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin password not configured' });
  }
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  if (!username) {
    return res.status(400).json({ error: 'Username required' });
  }
  
  const index = whitelistedUsers.indexOf(username);
  
  if (index === -1) {
    return res.json({
      success: false,
      error: 'User not found in whitelist',
      whitelistedUsers: whitelistedUsers
    });
  }
  
  whitelistedUsers.splice(index, 1);
  
  // Also remove from moderators if they were a moderator
  const moderatorIndex = moderatorUsers.indexOf(username);
  if (moderatorIndex !== -1) {
    moderatorUsers.splice(moderatorIndex, 1);
    console.log(`   Also removed from moderators`);
  }
  
  console.log(`❌ User "${username}" removed from whitelist by admin`);
  console.log(`   Remaining whitelisted users: ${whitelistedUsers.length}`);
  
  // Save to MongoDB
  saveData();
  
  res.json({
    success: true,
    whitelistedUsers: whitelistedUsers,
    moderatorUsers: moderatorUsers,
    message: `User "${username}" removed from whitelist`
  });
});

// Admin endpoint to toggle moderator status for a whitelist user
app.post('/admin/toggle-moderator', (req, res) => {
  const { password, username } = req.body;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin password not configured' });
  }
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  if (!username) {
    return res.status(400).json({ error: 'Username required' });
  }
  
  // Check if user is in whitelist
  if (!whitelistedUsers.includes(username)) {
    return res.json({
      success: false,
      error: 'User must be whitelisted first',
      whitelistedUsers: whitelistedUsers,
      moderatorUsers: moderatorUsers
    });
  }
  
  const isModerator = moderatorUsers.includes(username);
  
  if (isModerator) {
    // Remove from moderators
    const index = moderatorUsers.indexOf(username);
    moderatorUsers.splice(index, 1);
    console.log(`❌ User "${username}" removed from moderators`);
  } else {
    // Add to moderators
    moderatorUsers.push(username);
    console.log(`✅ User "${username}" added to moderators`);
  }
  
  // Save to MongoDB
  saveData();
  
  res.json({
    success: true,
    whitelistedUsers: whitelistedUsers,
    moderatorUsers: moderatorUsers,
    message: isModerator ? `User "${username}" removed from moderators` : `User "${username}" added to moderators`
  });
});

// Admin endpoint to reset timer only (date) without resetting counts
// Note: lastTimerResetTime is declared at the top of the file
app.post('/admin/reset-timer', (req, res) => {
  const { password } = req.body;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin password not configured' });
  }
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  // Reset only the date (timer) but keep the counts
  const today = getLondonDateString();
  Object.keys(dailyLimits).forEach(product => {
    dailyLimits[product].date = today;
  });
  
  // Update the last timer reset time (so frontend can sync)
  lastTimerResetTime = Date.now();
  
  console.log(`⏰ Timer reset at ${new Date().toISOString()} - Counts preserved`);
  
  // Save to disk
  saveData();
  
  res.json({
    success: true,
    message: 'Timer reset successfully (counts preserved)',
    counters: dailyLimits,
    resetTime: lastTimerResetTime
  });
});

// Set test timer (for testing auto-reset functionality)
app.post('/admin/set-test-timer', (req, res) => {
  const { password, minutes } = req.body;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin password not configured' });
  }
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  if (!minutes || minutes < 1 || minutes > 1440) {
    return res.status(400).json({ error: 'Invalid minutes value (must be 1-1440)' });
  }
  
  // Set a custom timer that expires after the specified minutes
  const expiresAt = Date.now() + (minutes * 60 * 1000);
  lastTimerResetTime = expiresAt - (24 * 60 * 60 * 1000); // Trick the timer to expire at expiresAt
  
  // IMPORTANT: Set all product dates to YESTERDAY so auto-reset will trigger when timer hits 0
  const yesterdayString = getLondonYesterdayString();
  
  Object.keys(dailyLimits).forEach(product => {
    dailyLimits[product].date = yesterdayString;
    console.log(`📅 Set "${product}" date to ${yesterdayString} (yesterday, London time) for test timer`);
  });
  
  console.log(`🧪 TEST TIMER SET: Will expire in ${minutes} minute(s) at ${new Date(expiresAt).toISOString()}`);
  console.log(`📅 All product dates set to YESTERDAY so auto-reset will trigger`);
  
  // Save to MongoDB
  saveData();
  
  res.json({
    success: true,
    message: `Test timer set to ${minutes} minute(s)`,
    expiresAt: expiresAt,
    resetTime: lastTimerResetTime
  });
});

// Admin endpoint to GET current queue settings
app.get('/admin/get-queue-settings', (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const configPath = path.join(__dirname, 'queue-config.json');
    
    let config = { globalWaitMinutes: 5, sameProductWaitMinutes: 60 }; // Defaults
    
    // FIRST: Try reading from file (this is where admin panel saves)
    if (fs.existsSync(configPath)) {
      try {
        const data = fs.readFileSync(configPath, 'utf8');
        config = JSON.parse(data);
        console.log('✅ Loaded queue settings from FILE:', config);
      } catch (error) {
        console.error('❌ Error reading file:', error.message);
      }
    } else {
      console.log('⚠️ queue-config.json does not exist, using defaults');
    }
    
    // FALLBACK: Environment variables (if file doesn't exist or failed to read)
    if (process.env.GLOBAL_QUEUE_MINUTES || process.env.SAME_PRODUCT_QUEUE_MINUTES) {
      config.globalWaitMinutes = parseInt(process.env.GLOBAL_QUEUE_MINUTES) || config.globalWaitMinutes;
      config.sameProductWaitMinutes = parseInt(process.env.SAME_PRODUCT_QUEUE_MINUTES) || config.sameProductWaitMinutes;
      console.log('✅ Overridden by environment variables:', config);
    }
    
    console.log('📊 Returning queue settings:', config);
    
    res.json({ 
      success: true, 
      settings: config 
    });
  } catch (error) {
    console.error('❌ Error reading queue config:', error.message);
    res.json({ 
      success: true, 
      settings: { globalWaitMinutes: 5, sameProductWaitMinutes: 60 } // Return defaults on error
    });
  }
});

// Admin endpoint to set global queue time (proxies to AWS)
app.post('/admin/set-global-queue-time', async (req, res) => {
  const { password, minutes } = req.body;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin password not configured' });
  }
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  if (minutes === undefined || minutes < 0 || minutes > 60) {
    return res.status(400).json({ error: 'Invalid minutes value (must be 0-60)' });
  }
  
  try {
    // Proxy to AWS bot server
    const awsResponse = await fetch(`${DISCORD_BOT_API_URL}/admin/set-global-queue-time`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BOT_API_SECRET}`
      },
      body: JSON.stringify({ minutes })
    });
    
    const result = await awsResponse.json();
    
    console.log(`⏱️ ADMIN: Global queue time set to ${minutes} minutes (AWS)`);
    
    res.json(result);
  } catch (error) {
    console.error('Error setting global queue time:', error);
    res.status(500).json({ error: 'Error updating queue config on AWS' });
  }
});

// Admin endpoint to set Sparx Maths queue time (proxies to AWS)
app.post('/admin/set-sparx-maths-queue-time', async (req, res) => {
  const { password, minutes } = req.body;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin password not configured' });
  }
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  if (!minutes || minutes < 1 || minutes > 1440) {
    return res.status(400).json({ error: 'Invalid minutes value (must be 1-1440)' });
  }
  
  try {
    // Proxy to AWS bot server
    const awsResponse = await fetch(`${DISCORD_BOT_API_URL}/admin/set-sparx-maths-queue-time`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BOT_API_SECRET}`
      },
      body: JSON.stringify({ minutes })
    });
    
    const result = await awsResponse.json();
    
    console.log(`📐 ADMIN: Sparx Maths queue time set to ${minutes} minutes (AWS)`);
    
    res.json(result);
  } catch (error) {
    console.error('Error setting Sparx Maths queue time:', error);
    res.status(500).json({ error: 'Error updating queue config on AWS' });
  }
});

// Admin endpoint to set Other Products queue time (proxies to AWS)
app.post('/admin/set-other-products-queue-time', async (req, res) => {
  const { password, minutes } = req.body;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin password not configured' });
  }
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  if (!minutes || minutes < 1 || minutes > 1440) {
    return res.status(400).json({ error: 'Invalid minutes value (must be 1-1440)' });
  }
  
  try {
    // Proxy to AWS bot server
    const awsResponse = await fetch(`${DISCORD_BOT_API_URL}/admin/set-other-products-queue-time`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BOT_API_SECRET}`
      },
      body: JSON.stringify({ minutes })
    });
    
    const result = await awsResponse.json();
    
    console.log(`📚 ADMIN: Other products queue time set to ${minutes} minutes (AWS)`);
    
    res.json(result);
  } catch (error) {
    console.error('Error setting other products queue time:', error);
    res.status(500).json({ error: 'Error updating queue config on AWS' });
  }
});

// ═══════════════════════════════════════════════════════
// SENAI QUEUE ADMIN PROXY ENDPOINTS (All proxy to AWS)
// ═══════════════════════════════════════════════════════

// Helper: proxy authenticated request to AWS bot server
async function proxyToAWS(endpoint, method = 'GET', body = null) {
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${BOT_API_SECRET}`
    }
  };
  if (body) options.body = JSON.stringify(body);
  const response = await fetch(`${DISCORD_BOT_API_URL}${endpoint}`, options);
  return response.json();
}

// Helper: validate admin password middleware
function requireAdmin(req, res, next) {
  const { password } = req.body || req.query;
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Get full queue status
app.get('/admin/queue-full-status', async (req, res) => {
  const { password } = req.query;
  if (password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const result = await proxyToAWS('/admin/queue-full-status');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Could not reach AWS bot server' });
  }
});

// Pause queue
app.post('/admin/queue-pause', requireAdmin, async (req, res) => {
  try {
    const result = await proxyToAWS('/admin/queue-pause', 'POST');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Could not reach AWS bot server' });
  }
});

// Resume queue
app.post('/admin/queue-resume', requireAdmin, async (req, res) => {
  try {
    const result = await proxyToAWS('/admin/queue-resume', 'POST');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Could not reach AWS bot server' });
  }
});

// Remove order from queue
app.post('/admin/queue-remove', requireAdmin, async (req, res) => {
  try {
    const result = await proxyToAWS('/admin/queue-remove', 'POST', { position: req.body.position });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Could not reach AWS bot server' });
  }
});

// Move order to front
app.post('/admin/queue-move-to-front', requireAdmin, async (req, res) => {
  try {
    const result = await proxyToAWS('/admin/queue-move-to-front', 'POST', { position: req.body.position });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Could not reach AWS bot server' });
  }
});

// Start order now
app.post('/admin/queue-start-now', requireAdmin, async (req, res) => {
  try {
    const result = await proxyToAWS('/admin/queue-start-now', 'POST', { position: req.body.position });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Could not reach AWS bot server' });
  }
});

// Adjust wait time
app.post('/admin/queue-adjust-wait', requireAdmin, async (req, res) => {
  try {
    const result = await proxyToAWS('/admin/queue-adjust-wait', 'POST', { minutes: req.body.minutes });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Could not reach AWS bot server' });
  }
});

// Clear queue
app.post('/admin/queue-clear', requireAdmin, async (req, res) => {
  try {
    const result = await proxyToAWS('/admin/queue-clear', 'POST');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Could not reach AWS bot server' });
  }
});

// ═══════════════════════════════════════════════════════
// SENAI QUEUE SYSTEM (Now handled by AWS)
// ═══════════════════════════════════════════════════════
// Queue processor moved to AWS bot server (test-server.js)
// Render backend now calls AWS /add-to-queue endpoint

// Force all users to re-login by incrementing the required version
app.post('/admin/force-relogin', (req, res) => {
  const { password } = req.body;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin password not configured' });
  }
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    const fs = require('fs');
    const path = require('path');
    const configPath = path.join(__dirname, 'queue-config.json');
    
    // Read current config
    let config = { globalWaitMinutes: 5, sameProductWaitMinutes: 60, requiredVersion: '2.2' };
    if (fs.existsSync(configPath)) {
      try {
        const data = fs.readFileSync(configPath, 'utf8');
        config = JSON.parse(data);
      } catch (e) {
        console.error('Error reading queue config:', e.message);
      }
    }
    
    // Set a timestamp for when force re-login was triggered
    const clearTimestamp = Date.now();
    config.forceClearTimestamp = clearTimestamp;
    config.requiredVersion = '2.2'; // Keep version stable
    
    // Save to file
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    
    console.log(`\n${'='.repeat(60)}`);
    console.log('🔄 FORCE RE-LOGIN ACTIVATED');
    console.log(`${'='.repeat(60)}`);
    console.log(`Force clear timestamp: ${clearTimestamp}`);
    console.log(`All users will be required to re-login on next visit`);
    console.log(`File location: ${configPath}`);
    console.log(`${'='.repeat(60)}\n`);
    
    res.json({
      success: true,
      message: `All users will be forced to re-login`,
      forceClearTimestamp: clearTimestamp
    });
  } catch (error) {
    console.error('Error forcing re-login:', error);
    res.status(500).json({ error: 'Error updating version config' });
  }
});

// Endpoint to check if force clear is needed
app.get('/get-required-version', (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const configPath = path.join(__dirname, 'queue-config.json');
    
    let forceClearTimestamp = null;
    
    if (fs.existsSync(configPath)) {
      try {
        const data = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(data);
        forceClearTimestamp = config.forceClearTimestamp || null;
      } catch (e) {
        console.error('Error reading force clear timestamp from queue config:', e.message);
      }
    }
    
    res.json({
      success: true,
      requiredVersion: '2.2', // Always return stable version
      forceClearTimestamp: forceClearTimestamp
    });
  } catch (error) {
    console.error('Error getting force clear timestamp:', error);
    res.json({
      success: true,
      requiredVersion: '2.2',
      forceClearTimestamp: null
    });
  }
});

// Endpoint to get timer reset time (for frontend sync)
app.get('/admin/timer-reset-time', (req, res) => {
  res.json({
    success: true,
    resetTime: lastTimerResetTime,
    currentTime: Date.now()
  });
});

// Admin endpoint to get login history
app.post('/admin/login-history', (req, res) => {
  const { password } = req.body;
  
  // Check admin password
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  
  // Return login history (sorted by most recent first)
  const sortedHistory = [...loginHistory].reverse();
  
  res.json({
    success: true,
    loginHistory: sortedHistory,
    totalLogins: loginHistory.length
  });
});

// Admin endpoint to remove purchase history entry
app.post('/admin/remove-purchase-history', (req, res) => {
  const { password, index } = req.body;
  
  // Check admin password
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  
  // Validate index
  if (typeof index !== 'number' || index < 0 || index >= loginHistory.length) {
    return res.status(400).json({ error: 'Invalid index' });
  }
  
  // Remove the entry (note: index is from reversed array, so calculate actual index)
  const actualIndex = loginHistory.length - 1 - index;
  const removed = loginHistory.splice(actualIndex, 1);
  
  console.log(`🗑️ Admin removed purchase history entry: ${removed[0]?.username} - ${removed[0]?.productName}`);
  
  // Save to MongoDB
  saveData();
  
  res.json({
    success: true,
    message: 'Purchase record removed successfully',
    removed: removed[0]
  });
});

// Clear all purchase history
app.post('/admin/clear-all-purchase-history', (req, res) => {
  const { password } = req.body;
  
  // Check admin password
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  
  const count = loginHistory.length;
  
  // Clear all purchase history
  loginHistory = [];
  
  console.log(`🗑️ Admin cleared ALL purchase history (${count} records removed)`);
  
  // Save to MongoDB
  saveData();
  
  res.json({
    success: true,
    count: count,
    message: `${count} purchase records cleared`
  });
});

// Admin endpoint to get active users
app.post('/admin/active-users', (req, res) => {
  const { password } = req.body;
  
  // Check admin password
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  
  // Clean up expired sessions before returning
  const now = Date.now();
  Object.keys(activeSessions).forEach(username => {
    const session = activeSessions[username];
    if (now - session.lastActive > SESSION_TIMEOUT) {
      delete activeSessions[username];
    }
  });
  
  // Convert to array format
  const activeUsers = Object.keys(activeSessions).map(username => ({
    username,
    school: activeSessions[username].school,
    lastActive: activeSessions[username].lastActive,
    secondsSinceActive: Math.floor((now - activeSessions[username].lastActive) / 1000)
  }));
  
  res.json({
    success: true,
    activeUsers,
    totalActive: activeUsers.length
  });
});

// Heartbeat endpoint - keep user session alive (tracks browsing activity)
app.post('/user/heartbeat', (req, res) => {
  const { username, school } = req.body;
  
  if (!username) {
    return res.status(400).json({ error: 'Username required' });
  }
  
  // Create or update session
  if (!activeSessions[username]) {
    console.log(`🟢 User "${username}" is now ONLINE (Total active: ${Object.keys(activeSessions).length + 1})`);
  }
  
  activeSessions[username] = {
    lastActive: Date.now(),
    school: school || 'Not provided'
  };
  
  res.json({ success: true });
});

// Logout endpoint - remove user from active sessions
app.post('/user/logout', (req, res) => {
  const { username } = req.body;
  
  if (username && activeSessions[username]) {
    delete activeSessions[username];
    console.log(`👋 User "${username}" logged out (Total active: ${Object.keys(activeSessions).length})`);
  }
  
  res.json({ success: true });
});

// ====== SNAPCHAT INFO ENDPOINT ======

// Get Snapchat username (public endpoint for success page)
app.get('/get-snapchat', (req, res) => {
  res.json({
    success: true,
    snapchat: process.env.SNAPCHAT_USERNAME || 'homework5003' // Public support contact
  });
});

// ====== CASH PAYMENT CODE MANAGEMENT ======

// Get all cash payment codes (admin only)
app.post('/admin/get-cash-codes', (req, res) => {
  const { password } = req.body;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin password not configured' });
  }
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  res.json({
    success: true,
    codes: cashPaymentCodes,
    totalCodes: cashPaymentCodes.length
  });
});

// Add a new cash payment code (admin only)
app.post('/admin/add-cash-code', (req, res) => {
  const { password, code } = req.body;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin password not configured' });
  }
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  if (!code || code.trim() === '') {
    return res.status(400).json({ error: 'Code cannot be empty' });
  }
  
  const cleanCode = code.trim().toUpperCase();
  
  // Check if code already exists
  if (cashPaymentCodes.includes(cleanCode)) {
    return res.status(400).json({ error: 'Code already exists' });
  }
  
  cashPaymentCodes.push(cleanCode);
  saveData();
  
  console.log(`✅ Admin added cash payment code: "${cleanCode}" (Total codes: ${cashPaymentCodes.length})`);
  
  res.json({
    success: true,
    message: `Code "${cleanCode}" added successfully`,
    codes: cashPaymentCodes,
    totalCodes: cashPaymentCodes.length
  });
});

// Remove a cash payment code (admin only)
app.post('/admin/remove-cash-code', (req, res) => {
  const { password, code } = req.body;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin password not configured' });
  }
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  if (!code) {
    return res.status(400).json({ error: 'Code required' });
  }
  
  const cleanCode = code.trim().toUpperCase();
  const index = cashPaymentCodes.indexOf(cleanCode);
  
  if (index === -1) {
    return res.status(404).json({ error: 'Code not found' });
  }
  
  cashPaymentCodes.splice(index, 1);
  saveData();
  
  console.log(`🗑️  Admin removed cash payment code: "${cleanCode}" (Total codes: ${cashPaymentCodes.length})`);
  
  res.json({
    success: true,
    message: `Code "${cleanCode}" removed successfully`,
    codes: cashPaymentCodes,
    totalCodes: cashPaymentCodes.length
  });
});

// Get code usage history (admin only)
app.post('/admin/get-code-usage', (req, res) => {
  const { password } = req.body;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin password not configured' });
  }
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  res.json({
    success: true,
    usageHistory: codeUsageHistory,
    totalUses: codeUsageHistory.length
  });
});

// Get availability schedule (public endpoint)
app.get('/get-availability', (req, res) => {
  const availabilityStatus = checkAvailability();
  
  // Include the raw schedule object for admin panel
  res.json({
    ...availabilityStatus,
    scheduleSettings: availabilitySchedule, // Add raw schedule data
    siteDeal: siteDeal // Holiday/promotional deal configuration
  });
});

// ====== SITE DEAL / PROMOTION ENDPOINTS ======

// Get current site deal status (public endpoint)
app.get('/get-site-deal', (req, res) => {
  res.json({
    success: true,
    siteDeal: siteDeal
  });
});

// Update site deal configuration (admin only)
app.post('/admin/update-site-deal', (req, res) => {
  const { password, settings } = req.body;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin password not configured' });
  }
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  if (!settings || typeof settings !== 'object') {
    return res.status(400).json({ error: 'Settings object required' });
  }
  
  // Validate theme
  const validThemes = ['none', 'christmas', 'bankHoliday', 'easter', 'newYear', 'valentines', 'halloween', 'summer', 'blackFriday'];
  if (settings.theme && !validThemes.includes(settings.theme)) {
    return res.status(400).json({ error: `Invalid theme. Must be one of: ${validThemes.join(', ')}` });
  }
  
  // Validate discount amount
  if (settings.discountAmount !== undefined) {
    const discount = parseFloat(settings.discountAmount);
    if (isNaN(discount) || discount < 0 || discount > 10) {
      return res.status(400).json({ error: 'Discount amount must be between 0 and 10' });
    }
    settings.discountAmount = discount;
  }
  
  // Update siteDeal config (merge with existing)
  siteDeal = {
    ...siteDeal,
    ...settings
  };
  
  saveData();
  
  console.log(`🎉 Site Deal updated:`, {
    enabled: siteDeal.enabled,
    theme: siteDeal.theme,
    discount: `£${siteDeal.discountAmount}`,
    name: siteDeal.name
  });
  
  res.json({
    success: true,
    message: 'Site deal updated successfully',
    siteDeal: siteDeal
  });
});

// ====== BAN/UNBAN SYSTEM ======

// Check if user is banned (public endpoint)
app.post('/check-ban-status', (req, res) => {
  const { username } = req.body;
  
  if (!username) {
    return res.status(400).json({ error: 'Username required' });
  }
  
  const bannedUser = bannedUsers.find(u => u.username.toLowerCase() === username.toLowerCase());
  
  if (bannedUser) {
    return res.json({
      banned: true,
      reason: bannedUser.reason || 'No reason provided',
      bannedAt: bannedUser.bannedAt
    });
  }
  
  res.json({ banned: false });
});

// Ban a user (admin only)
app.post('/admin/ban-user', (req, res) => {
  const { password, username, reason } = req.body;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin password not configured' });
  }
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  if (!username) {
    return res.status(400).json({ error: 'Username required' });
  }
  
  // Check if already banned
  const existingBan = bannedUsers.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (existingBan) {
    return res.status(400).json({ error: 'User is already banned' });
  }
  
  // Add to banned list
  bannedUsers.push({
    username: username,
    reason: reason || 'Spamming / Abuse',
    bannedAt: new Date().toISOString(),
    bannedBy: 'admin'
  });
  
  console.log(`🚫 User banned: "${username}" - Reason: ${reason || 'Spamming / Abuse'}`);
  
  saveData();
  
  res.json({
    success: true,
    message: `User "${username}" has been banned`,
    bannedUser: bannedUsers[bannedUsers.length - 1]
  });
});

// Unban a user (admin only)
app.post('/admin/unban-user', (req, res) => {
  const { password, username } = req.body;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin password not configured' });
  }
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  if (!username) {
    return res.status(400).json({ error: 'Username required' });
  }
  
  // Find and remove from banned list
  const index = bannedUsers.findIndex(u => u.username.toLowerCase() === username.toLowerCase());
  
  if (index === -1) {
    return res.status(404).json({ error: 'User is not banned' });
  }
  
  const unbannedUser = bannedUsers.splice(index, 1)[0];
  
  console.log(`✅ User unbanned: "${username}"`);
  
  saveData();
  
  res.json({
    success: true,
    message: `User "${username}" has been unbanned`,
    unbannedUser: unbannedUser
  });
});

// Get list of banned users (admin only)
app.post('/admin/get-banned-users', (req, res) => {
  const { password } = req.body;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin password not configured' });
  }
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  res.json({
    success: true,
    bannedUsers: bannedUsers,
    totalBanned: bannedUsers.length
  });
});

// Update availability schedule (admin only)
app.post('/admin/update-schedule', (req, res) => {
  const { password, scheduleType, settings } = req.body;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin password not configured' });
  }
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  if (!scheduleType || !settings) {
    return res.status(400).json({ error: 'Schedule type and settings required' });
  }
  
  if (scheduleType === 'weekday') {
    availabilitySchedule.weekday = {
      ...availabilitySchedule.weekday,
      ...settings
    };
  } else if (scheduleType === 'weekend') {
    availabilitySchedule.weekend = {
      ...availabilitySchedule.weekend,
      ...settings
    };
  } else if (scheduleType === 'timezone') {
    // Validate timezone by attempting to use it
    try {
      new Date().toLocaleString('en-GB', { timeZone: settings.timezone });
      availabilitySchedule.timezone = settings.timezone;
      console.log(`🌍 Admin updated timezone to: ${settings.timezone}`);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid timezone' });
    }
  } else {
    return res.status(400).json({ error: 'Invalid schedule type' });
  }
  
  saveData();
  
  if (scheduleType !== 'timezone') {
    console.log(`⏰ Admin updated ${scheduleType} schedule:`, settings);
  }
  
  res.json({
    success: true,
    message: `${scheduleType} ${scheduleType === 'timezone' ? 'updated' : 'schedule updated'} successfully`,
    schedule: availabilitySchedule
  });
});

// Endpoint for automatic slot reset at midnight (called by frontend)
// Track if auto-reset is in progress to prevent race conditions
let autoResetInProgress = false;

app.post('/admin/auto-reset-slots', async (req, res) => {
  // This is called automatically when timer reaches 0
  // No password required - it's triggered by the timer logic
  
  // Prevent duplicate resets from multiple simultaneous requests
  if (autoResetInProgress) {
    console.log('⏭️ Auto-reset already in progress, skipping duplicate request');
    return res.json({
      success: true,
      message: 'Reset already in progress',
      resetProducts: [],
      skippedProducts: [],
      counters: dailyLimits
    });
  }
  
  autoResetInProgress = true;
  
  try {
    const today = getLondonDateString();
    console.log(`🔍 Auto-reset triggered - Today is (London time): ${today}`);
    
    // Check if date has actually changed (prevent multiple resets)
    let hasReset = false;
    let resetProducts = [];
    let skippedProducts = [];
    let alreadyTodayProducts = [];
    
    Object.keys(dailyLimits).forEach(product => {
      const productDate = dailyLimits[product].date;
      console.log(`🔍 Checking "${product}": current date="${productDate}", today="${today}", match=${productDate === today}`);
      
      if (dailyLimits[product].date !== today) {
        // Only reset slots for products that are currently AVAILABLE
        if (dailyLimits[product].available) {
          dailyLimits[product].count = 0;
          dailyLimits[product].date = today;
          
          // Also reset extra slots for all products
          if (dailyLimits[product].extraSlots) {
            dailyLimits[product].extraSlots.count = 0;
            dailyLimits[product].extraSlots.currentPrice = dailyLimits[product].extraSlots.basePrice; // Reset price
            console.log(`✅ Extra slots also reset for "${product}" (price reset to £${dailyLimits[product].extraSlots.basePrice})`);
          }
          
          hasReset = true;
          resetProducts.push(product);
          console.log(`✅ Auto-reset: "${product}" slots reset to 0/${MAX_PURCHASES_PER_DAY} (AVAILABLE)`);
        } else {
          // Product is disabled - just update date but DON'T reset count
          dailyLimits[product].date = today;
          skippedProducts.push(product);
          console.log(`⏭️ Auto-reset: "${product}" DISABLED - slots NOT reset (keeping ${dailyLimits[product].count}/${MAX_PURCHASES_PER_DAY})`);
        }
      } else {
        alreadyTodayProducts.push(product);
        console.log(`⏩ "${product}" already has today's date - no reset needed`);
      }
    });
    
    if (alreadyTodayProducts.length > 0) {
      console.log(`ℹ️ ${alreadyTodayProducts.length} products already had today's date:`, alreadyTodayProducts);
    }
    
    if (hasReset || skippedProducts.length > 0) {
      // Save to MongoDB
      await saveData();
      console.log(`🔄 Auto-reset complete: ${resetProducts.length} products reset, ${skippedProducts.length} disabled products skipped`);
    }
    
    res.json({
      success: true,
      message: hasReset ? `Slots reset for ${resetProducts.length} available products` : 'No slots needed reset',
      resetProducts: resetProducts,
      skippedProducts: skippedProducts,
      counters: dailyLimits
    });
  } finally {
    // Release lock after a short delay to prevent rapid duplicate requests
    setTimeout(() => {
      autoResetInProgress = false;
    }, 2000);
  }
});

// Resend email service setup
const resend = process.env.RESEND_API_KEY 
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

// Log email configuration status
console.log('Email Configuration:');
console.log('- RESEND_API_KEY:', process.env.RESEND_API_KEY ? 'SET (hidden)' : 'NOT SET');
console.log('- YOUR_EMAIL:', process.env.YOUR_EMAIL || 'NOT SET');
console.log('- Resend initialized:', resend ? 'Yes' : 'No');

// Health check endpoint
app.get('/', (req, res) => {
  res.send('hwplug Backend Running! 🚀');
});

// Test email endpoint (for debugging)
app.get('/test-email', async (req, res) => {
  try {
    if (!resend) {
      return res.json({ 
        success: false, 
        error: 'Resend not initialized - missing RESEND_API_KEY',
        details: {
          RESEND_API_KEY: process.env.RESEND_API_KEY ? 'SET' : 'NOT SET',
          YOUR_EMAIL: process.env.YOUR_EMAIL ? 'SET' : 'NOT SET'
        }
      });
    }

    if (!process.env.YOUR_EMAIL) {
      return res.json({ 
        success: false, 
        error: 'Missing YOUR_EMAIL environment variable'
      });
    }

    const { data, error } = await resend.emails.send({
      from: 'hwplug <onboarding@resend.dev>', // Update this to your verified domain
      to: process.env.YOUR_EMAIL,
      subject: '🧪 Test Email from hwplug Backend',
      html: '<h2>Test Email</h2><p>This is a test email. If you receive this, Resend configuration is working!</p>'
    });

    if (error) {
      return res.json({ 
        success: false, 
        error: error.message,
        details: error
      });
    }

    res.json({ success: true, message: 'Test email sent successfully! Check your inbox at ' + process.env.YOUR_EMAIL, data });
  } catch (error) {
    console.error('Email send error:', error);
    res.json({ 
      success: false, 
      error: error.message || 'Unknown error'
    });
  }
});

// Create Stripe Checkout Session (with webhook support)
app.post('/create-checkout-session', paymentLimiter, async (req, res) => {
  try {
    const { 
      reservationId, 
      school, 
      username, 
      password, 
      loginType,
      productName, 
      productPrice,
      previousUsername,
      paymentMethod,
      successUrl,
      cancelUrl
    } = req.body;
    
    console.log(`💳 Creating ${paymentMethod === 'paypal' ? 'PayPal' : 'Stripe'} checkout session with metadata:`, {
      reservationId,
      school,
      username,
      loginType,
      productName,
      productPrice,
      previousUsername,
      paymentMethod,
      hasPassword: !!password
    });
    
    // Validate required fields
    if (!username || !password || !productName || !productPrice) {
      return res.status(400).json({ 
        error: 'Missing required fields: username, password, productName, productPrice' 
      });
    }
    
    // Create line items for Stripe
    const lineItems = [{
      price_data: {
        currency: 'gbp',
        product_data: {
          name: productName,
        },
        unit_amount: Math.round(parseFloat(productPrice) * 100), // Convert to pence
      },
      quantity: 1,
    }];

    // Determine payment method types based on request
    const paymentMethodTypes = paymentMethod === 'paypal' ? ['paypal'] : ['card'];

    // Create checkout session with metadata
    const session = await stripe.checkout.sessions.create({
      payment_method_types: paymentMethodTypes,
      line_items: lineItems,
      mode: 'payment',
      success_url: successUrl || `${req.headers.origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${req.headers.origin}/payment.html`,
      allow_promotion_codes: true, // ✅ Enable promo codes!
      billing_address_collection: 'auto', // Only collect if needed (not required)
      metadata: {
        // Attach all data needed to process purchase via webhook
        reservationId: reservationId || '',
        school: school || 'Not provided',
        username: username,
        password: password,
        loginType: loginType || 'Google', // Default to Google for backwards compatibility
        productName: productName,
        productPrice: productPrice,
        previousUsername: previousUsername || '',
        paymentMethod: paymentMethod || 'card'
      }
    });
    
    console.log(`✅ ${paymentMethod === 'paypal' ? 'PayPal' : 'Stripe'} checkout session created:`, session.id);
    res.json({ 
      sessionId: session.id,
      url: session.url // Return the checkout URL
    });
  } catch (error) {
    console.error('❌ Error creating checkout session:', error);
    res.status(500).json({ error: error.message });
  }
});

// NEW ENDPOINT: Submit login (before payment)
app.post('/submit-login', async (req, res) => {
  try {
    // This endpoint is kept for compatibility but no longer sends emails
    // Emails are sent AFTER payment (cash or card) with "New Login" notification
    res.json({ success: true, message: 'Login received successfully' });
  } catch (error) {
    console.error('Error submitting login:', error);
    res.status(500).json({ error: error.message });
  }
});

// NEW ENDPOINT: Submit card payment (before redirect to Stripe)
app.post('/submit-card-payment', async (req, res) => {
  try {
    const { username, password, productName, productPrice } = req.body;
    
    // Validate required fields
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    // Send email notification for card payment (non-blocking)
    sendCardPaymentNotification({
      username,
      password,
      productName,
      productPrice,
      paymentMethod: 'card'
    }).catch(err => {
      console.error('Error sending card payment notification email:', err);
    });

    res.json({ success: true, message: 'Card payment notification sent successfully' });
  } catch (error) {
    console.error('Error submitting card payment:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to confirm reservation (remove from active reservations)
function confirmReservation(productName) {
  // Find and remove any active reservations for this product
  Object.keys(activeReservations).forEach(reservationId => {
    if (activeReservations[reservationId].productName === productName) {
      delete activeReservations[reservationId];
      console.log(`✅ Reservation CONFIRMED (payment completed) for "${productName}" - Reservation ID: ${reservationId}`);
    }
  });
}

// NEW ENDPOINT: Submit cash payment
app.post('/submit-cash-payment', paymentLimiter, async (req, res) => {
  try {
    console.log('💵 CASH PAYMENT REQUEST RECEIVED');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    
    const { school, username, password, loginType, productName: rawProductName, productPrice, previousUsername, reservationId, cashCode } = req.body;
    
    // Clean product name (remove " - Extra Slot" suffix for backend processing)
    const productName = rawProductName ? rawProductName.replace(' - Extra Slot', '').trim() : '';
    const isExtraSlot = rawProductName && rawProductName.includes(' - Extra Slot');
    
    console.log('💵 Extracted data:', { school, username, loginType, productName, rawProductName, isExtraSlot, productPrice, previousUsername, reservationId, cashCode, hasPassword: !!password });
    
    // Validate required fields
    if (!username || !password) {
      console.error('❌ Missing required fields - username or password');
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    // Validate school information
    if (!school || school.trim() === '' || school === 'Not provided') {
      console.error('❌ Missing school information');
      return res.status(400).json({ 
        error: 'School information is required',
        requireReLogin: true,
        message: 'Please log in again and provide your school information'
      });
    }
    
    // Validate email format (ONLY for Google/Microsoft login types, NOT for Normal)
    if (loginType !== 'Normal') {
      if (!username.includes('@')) {
        console.error('❌ Invalid email format - missing @');
        return res.status(400).json({ 
          error: 'Invalid email address',
          requireReLogin: true,
          message: 'Your email must contain an @ symbol. Please log in again with a valid school email.'
        });
      }
      
      const validDomains = ['.com', '.co.uk', '.edu', '.org', '.net', '.ac.uk'];
      const hasValidDomain = validDomains.some(domain => username.toLowerCase().includes(domain));
      
      if (!hasValidDomain) {
        console.error('❌ Invalid email format - missing valid domain');
        return res.status(400).json({ 
          error: 'Invalid email address',
          requireReLogin: true,
          message: 'Your email must end with a valid domain (.com, .co.uk, .edu, etc.). Please log in again with a valid school email.'
        });
      }
    } else {
      console.log('✅ Normal login type - skipping email validation');
    }
    
    // Validate cash payment code
    if (!cashCode || cashCode.trim() === '') {
      console.error('❌ Missing cash payment code');
      return res.status(400).json({ error: 'Cash payment code is required' });
    }
    
    const cleanCode = cashCode.trim().toUpperCase();
    if (!cashPaymentCodes.includes(cleanCode)) {
      console.error(`❌ Invalid cash payment code: "${cleanCode}"`);
      return res.status(400).json({ error: 'Invalid cash payment code. Please check with admin.' });
    }
    
    console.log(`✅ Valid cash payment code: "${cleanCode}"`);
    
    // Track code usage
    codeUsageHistory.push({
      code: cleanCode,
      username: username,
      school: school || 'Not provided',
      productName: rawProductName || productName || 'Unknown', // Use raw name for display
      productPrice: productPrice || 'N/A',
      timestamp: new Date().toISOString()
    });
    console.log(`📝 Code usage tracked: "${cleanCode}" used by "${username}"`);
    
    // Check if this is a new login (different username)
    const isNewLogin = !previousUsername || previousUsername !== username;
    
    // Check if product is available
    resetDailyCountersIfNeeded();
    if (productName && dailyLimits[productName] && !dailyLimits[productName].available) {
      return res.status(400).json({ error: 'Product is not available right now' });
    }
    
    // Slot was already reserved when user clicked "Buy Now", so we just need to verify and get status
    let remainingSlots = 0;
    let currentCount = 0;
    let maxSlots = MAX_PURCHASES_PER_DAY;
    
    if (productName && dailyLimits[productName]) {
      // Determine if this is an extra slot purchase
      if (isExtraSlot && dailyLimits[productName].extraSlots) {
        // Extra slot purchase - show extra slot info
        currentCount = dailyLimits[productName].extraSlots.count;
        maxSlots = dailyLimits[productName].extraSlots.max;
        remainingSlots = Math.max(0, maxSlots - currentCount);
      } else {
        // Regular slot purchase
        currentCount = dailyLimits[productName].count;
        maxSlots = MAX_PURCHASES_PER_DAY;
        remainingSlots = Math.max(0, maxSlots - currentCount);
      }
      
      // Confirm the specific reservation if reservationId provided, otherwise confirm all for that product
      if (reservationId && activeReservations[reservationId]) {
        // Verify it's for the correct product
        if (activeReservations[reservationId].productName === productName) {
          const slotType = activeReservations[reservationId].isExtraSlot ? 'EXTRA SLOT' : 'regular slot';
          delete activeReservations[reservationId];
          console.log(`✅ Reservation CONFIRMED (cash payment - ${slotType}) for "${productName}" - Reservation ID: ${reservationId} - Count: ${currentCount}/${maxSlots} (${remainingSlots} remaining)`);
        } else {
          console.warn(`⚠️ Reservation ID ${reservationId} product mismatch. Confirming all reservations for ${productName}`);
          confirmReservation(productName);
        }
      } else {
        // No reservationId or not found - confirm all reservations for this product (fallback)
        console.log(`✅ Confirming all reservations for "${productName}" (no specific reservationId provided)`);
        confirmReservation(productName);
      }
      
      console.log(`✅ Product "${productName}" ${isExtraSlot ? 'extra slots' : 'regular slots'} (slot already reserved): ${currentCount}/${maxSlots} (${remainingSlots} remaining)`);
    }
    
    // Send email notification for cash payment (non-blocking)
    console.log(`📧 Attempting to send cash payment email for ${isExtraSlot ? 'EXTRA SLOT' : 'regular slot'}...`);
    
    // Check bot automation mode for ALL products
    let orderId = null;
    const isBotProduct = (productName === 'Sparx Maths' || productName === 'Sparx Reader' || productName === 'Educate' || productName === 'Seneca' || productName === 'Sparx Science');
    
    // ALWAYS create order ID for bot products (for REDO button in emails)
    if (isBotProduct) {
      orderId = `order_cash_${Date.now()}`;
      pendingOrders[orderId] = {
        productName: productName,
        username: username,
        password: password,
        loginType: loginType || 'Google',
        school: school || 'Not provided',
        createdAt: new Date().toISOString(),
        processed: botAutomationMode === 'auto' ? true : false, // Auto mode = already processed
        paymentMethod: 'cash'
      };
      console.log(`📋 CASH: Order created (ID: ${orderId}) - Mode: ${botAutomationMode}`);
    }
    
    // Calculate actual dynamic price for extra slots (CASH)
    let actualPriceCash = productPrice;
    if (isExtraSlot && dailyLimits[productName]?.extraSlots) {
      // For extra slots, price = basePrice + (count - 1)
      const basePrice = dailyLimits[productName].extraSlots.basePrice;
      actualPriceCash = basePrice + (currentCount - 1);
      console.log(`💰 CASH: Extra slot price calculated: base £${basePrice} + ${currentCount - 1} = £${actualPriceCash}`);
    }
    
    sendCashPaymentNotification({
      school: school || 'Not provided',
      username,
      password,
      productName: rawProductName || productName, // Use raw name for display
      productPrice: actualPriceCash, // Use dynamic price for extra slots
      remainingSlots: remainingSlots,
      currentCount: currentCount,
      maxSlots: maxSlots,
      isExtraSlot: isExtraSlot || false,
      isNewLogin: isNewLogin,
      orderId: orderId, // Now set for both auto and email modes
      botMode: botAutomationMode // Pass the bot mode to email
    }).then(() => {
      console.log('✅ Cash payment email sent successfully');
      
      // 🤖 BOT AUTOMATION MODE CHECK (after email is sent)
      if (isBotProduct) {
        if (botAutomationMode === 'auto') {
          // AUTO MODE: Send to AWS SenAI queue
          console.log(`🤖 CASH: [AUTO MODE] Sending order to AWS SenAI queue for ${productName}...`);
          
          fetch(`${DISCORD_BOT_API_URL}/add-to-queue`, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${BOT_API_SECRET}`
            },
            body: JSON.stringify({
              orderId: orderId,
              productName: productName,
              username: username,
              password: password,
              school: school || 'Not provided',
              loginType: loginType || 'Google'
            })
          })
          .then(res => res.json())
          .then(queueResult => {
            if (queueResult.success) {
              console.log(`✅ CASH: Order added to AWS queue (Position #${queueResult.position}, Est. wait: ${queueResult.estimatedWaitMinutes}min)`);
            } else {
              console.error(`❌ CASH: Failed to add to queue: ${queueResult.error}`);
            }
          })
          .catch(err => {
            console.error(`❌ CASH: Error calling AWS queue:`, err.message);
          });
        } else {
          // EMAIL MODE: Wait for admin decision via email buttons
          console.log(`📧 CASH: [EMAIL MODE] Awaiting admin decision via email buttons for ${productName}`);
        }
      }
    }).catch(err => {
      console.error('❌ Error sending cash payment notification email:', err);
      console.error('Error details:', JSON.stringify(err, null, 2));
      // Don't fail the request if email fails
    });

    // Track login history (skip if user is whitelisted)
    const isWhitelisted = username && whitelistedUsers.includes(username);
    if (!isWhitelisted) {
      loginHistory.push({
        username,
        school: school || 'Not provided',
        productName: rawProductName || productName || 'Unknown', // Use raw name for display
        productPrice: productPrice || 'Unknown',
        paymentMethod: 'Cash',
        timestamp: new Date().toISOString(),
        isNewLogin
      });
      console.log(`📊 Login tracked: ${username} (Total logins: ${loginHistory.length})`);
    } else {
      console.log(`📊 CASH: Skipping login tracking for whitelisted user: ${username}`);
    }

    // Update active session (if exists) - payment completed
    if (activeSessions[username]) {
      activeSessions[username].lastActive = Date.now();
    }

    // Save to disk
    saveData();

    console.log('✅ Cash payment request processed successfully');
    res.json({ 
      success: true, 
      message: 'Cash payment notification sent successfully',
      snapchat: process.env.SNAPCHAT_USERNAME || 'homework5003' // Public support contact
    });
  } catch (error) {
    console.error('Error submitting cash payment:', error);
    res.status(500).json({ error: error.message });
  }
});

// NEW ENDPOINT: Submit login details after payment
app.post('/submit-login-details', paymentLimiter, async (req, res) => {
  try {
    console.log('💳 CARD PAYMENT - LOGIN DETAILS REQUEST RECEIVED');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    
    const { school, username, password, loginType, platform, sessionId, productName: rawProductName, productPrice, paymentMethod, previousUsername, reservationId, isWebhookFallback } = req.body;
    
    // Clean product name (remove " - Extra Slot" suffix for backend processing)
    const productName = rawProductName ? rawProductName.replace(' - Extra Slot', '').trim() : '';
    const isExtraSlot = rawProductName && rawProductName.includes(' - Extra Slot');
    
    // Check if this purchase was already processed (by webhook or previous call)
    // Look for recent duplicate entries (within last 5 minutes)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const isDuplicate = loginHistory.some(entry => {
      const matchesUser = entry.username === username;
      const matchesProduct = entry.productName === rawProductName || entry.productName === productName; // Check both forms
      const isRecent = entry.timestamp > fiveMinutesAgo;
      const matchesPaymentMethod = entry.paymentMethod === 'Card' || entry.paymentMethod === 'Card (Webhook)';
      
      return matchesUser && matchesProduct && isRecent && matchesPaymentMethod;
    });
    
    if (isDuplicate) {
      console.log('⏭️ CARD PAYMENT: Duplicate purchase detected - already processed (likely by webhook)');
      console.log('   Username:', username, 'Product:', rawProductName);
      return res.json({ 
        success: true, 
        message: 'Purchase already processed',
        alreadyProcessed: true
      });
    }
    
    console.log('✅ CARD PAYMENT: New purchase - processing...');
    
    console.log('💳 Extracted data:', { 
      school, 
      username, 
      platform, 
      sessionId, 
      productName,
      rawProductName,
      isExtraSlot,
      productPrice, 
      paymentMethod,
      previousUsername, 
      reservationId,
      hasPassword: !!password 
    });
    
    // Validate required fields
    if (!username || !password) {
      console.error('❌ CARD PAYMENT: Missing required fields - username or password');
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    // Validate school information
    if (!school || school.trim() === '' || school === 'Not provided') {
      console.error('❌ CARD PAYMENT: Missing school information');
      return res.status(400).json({ 
        error: 'School information is required',
        requireReLogin: true,
        message: 'Please log in again and provide your school information'
      });
    }
    
    // Validate email format (ONLY for Google/Microsoft login types, NOT for Normal)
    if (loginType !== 'Normal') {
      if (!username.includes('@')) {
        console.error('❌ CARD PAYMENT: Invalid email format - missing @');
        return res.status(400).json({ 
          error: 'Invalid email address',
          requireReLogin: true,
          message: 'Your email must contain an @ symbol. Please log in again with a valid school email.'
        });
      }
      
      const validDomains = ['.com', '.co.uk', '.edu', '.org', '.net', '.ac.uk'];
      const hasValidDomain = validDomains.some(domain => username.toLowerCase().includes(domain));
      
      if (!hasValidDomain) {
        console.error('❌ CARD PAYMENT: Invalid email format - missing valid domain');
        return res.status(400).json({ 
          error: 'Invalid email address',
          requireReLogin: true,
          message: 'Your email must end with a valid domain (.com, .co.uk, .edu, etc.). Please log in again with a valid school email.'
        });
      }
    } else {
      console.log('✅ CARD PAYMENT: Normal login type - skipping email validation');
    }
    
    // Check if this is a new login (different username)
    const isNewLogin = !previousUsername || previousUsername !== username;
    console.log('💳 Is new login:', isNewLogin);
    
    // Check if product is available
    resetDailyCountersIfNeeded();
    if (productName && dailyLimits[productName] && !dailyLimits[productName].available) {
      return res.status(400).json({ error: 'Product is not available right now' });
    }
    
    // Slot was already reserved when user clicked "Buy Now", so we just need to verify and get status
    let remainingSlots = 0;
    let currentCount = 0;
    let maxSlots = MAX_PURCHASES_PER_DAY;
    
    if (productName && dailyLimits[productName]) {
      // Determine if this is an extra slot purchase
      if (isExtraSlot && dailyLimits[productName].extraSlots) {
        // Extra slot purchase - show extra slot info
        currentCount = dailyLimits[productName].extraSlots.count;
        maxSlots = dailyLimits[productName].extraSlots.max;
        remainingSlots = Math.max(0, maxSlots - currentCount);
      } else {
        // Regular slot purchase
        currentCount = dailyLimits[productName].count;
        maxSlots = MAX_PURCHASES_PER_DAY;
        remainingSlots = Math.max(0, maxSlots - currentCount);
      }
      
      // Confirm the specific reservation if reservationId provided, otherwise confirm all for that product
      if (reservationId && activeReservations[reservationId]) {
        // Verify it's for the correct product
        if (activeReservations[reservationId].productName === productName) {
          const slotType = activeReservations[reservationId].isExtraSlot ? 'EXTRA SLOT' : 'regular slot';
          delete activeReservations[reservationId];
          console.log(`✅ Reservation CONFIRMED (card payment - ${slotType}) for "${productName}" - Reservation ID: ${reservationId} - Count: ${currentCount}/${maxSlots} (${remainingSlots} remaining)`);
        } else {
          console.warn(`⚠️ Reservation ID ${reservationId} product mismatch. Confirming all reservations for ${productName}`);
          confirmReservation(productName);
        }
      } else {
        // No reservationId or not found - confirm all reservations for this product (fallback)
        console.log(`✅ Confirming all reservations for "${productName}" (no specific reservationId provided)`);
        confirmReservation(productName);
      }
      
      console.log(`✅ Product "${productName}" ${isExtraSlot ? 'extra slots' : 'regular slots'} (slot already reserved): ${currentCount}/${maxSlots} (${remainingSlots} remaining)`);
    }
    
    // Send email notification with login details (CARD PAYMENT - only email sent for card)
    // Check bot automation mode for ALL products
    let orderId = null;
    const isBotProduct = (productName === 'Sparx Maths' || productName === 'Sparx Reader' || productName === 'Educate' || productName === 'Seneca' || productName === 'Sparx Science');
    
    // ALWAYS create order ID for bot products (for REDO button in emails)
    if (isBotProduct) {
      orderId = `order_${sessionId}_${Date.now()}`;
      pendingOrders[orderId] = {
        productName: productName,
        username: username,
        password: password,
        loginType: loginType || 'Google',
        school: school || 'Not provided',
        sessionId: sessionId,
        createdAt: new Date().toISOString(),
        processed: botAutomationMode === 'auto' ? true : false // Auto mode = already processed
      };
      console.log(`📋 CARD: Order created (ID: ${orderId}) - Mode: ${botAutomationMode}`);
    }
    
    // Calculate actual dynamic price for extra slots
    let actualPrice = productPrice || 'N/A';
    if (isExtraSlot && dailyLimits[productName]?.extraSlots && actualPrice !== 'N/A') {
      // For extra slots, price = basePrice + (count - 1)
      // Since count was already incremented, we use (currentCount - 1) to get the price this person paid
      const basePrice = dailyLimits[productName].extraSlots.basePrice;
      actualPrice = basePrice + (currentCount - 1);
      console.log(`💰 CARD: Extra slot price calculated: base £${basePrice} + ${currentCount - 1} = £${actualPrice}`);
    }
    
    console.log(`📧 Attempting to send card payment email for ${isExtraSlot ? 'EXTRA SLOT' : 'regular slot'}...`);
    await sendLoginDetailsNotification({
      school: school || 'Not provided',
      username,
      password,
      platform,
      sessionId,
      productName: rawProductName || productName || 'Unknown Product', // Use raw name for display
      productPrice: actualPrice, // Use dynamic price for extra slots
      paymentMethod: paymentMethod || 'card', // Default to card for this endpoint
      remainingSlots: remainingSlots,
      currentCount: currentCount,
      maxSlots: maxSlots,
      isExtraSlot: isExtraSlot || false,
      isNewLogin: isNewLogin,
      orderId: orderId // Will be null in auto mode, set in email mode
    });
    
    // 🤖 BOT AUTOMATION MODE CHECK
    console.log(`🎛️ CARD: Bot automation mode is: ${botAutomationMode}`);
    console.log(`🎯 CARD: Is bot product: ${isBotProduct} (${productName})`);
    
    if (isBotProduct) {
      if (botAutomationMode === 'auto') {
        // AUTO MODE: Send to AWS SenAI queue
        try {
          console.log(`🤖 CARD: [AUTO MODE] Sending order to AWS SenAI queue for ${productName}...`);
          
          const queueResponse = await fetch(`${DISCORD_BOT_API_URL}/add-to-queue`, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${BOT_API_SECRET}`
            },
            body: JSON.stringify({
              orderId: orderId,
              productName: productName,
              username: username,
              password: password,
              school: school || 'Not provided',
              loginType: loginType || 'Google'
            })
          });
          
          const queueResult = await queueResponse.json();
          
          if (queueResult.success) {
            console.log(`✅ CARD: Order added to AWS queue (Position #${queueResult.position}, Est. wait: ${queueResult.estimatedWaitMinutes}min)`);
          } else {
            console.error(`❌ CARD: Failed to add to queue: ${queueResult.error}`);
          }
        } catch (botError) {
          console.error(`❌ CARD: Error calling AWS queue:`, botError.message);
        }
      } else {
        // EMAIL MODE: Wait for admin decision via email buttons
        console.log(`📧 CARD: [EMAIL MODE] Awaiting admin decision via email buttons for ${productName}`);
      }
    } else {
      console.log(`ℹ️ CARD: Not a bot product, skipping bot automation`);
    }

    // Track login history (skip if user is whitelisted)
    const isWhitelisted = username && whitelistedUsers.includes(username);
    if (!isWhitelisted) {
      loginHistory.push({
        username,
        school: school || 'Not provided',
        productName: rawProductName || productName || 'Unknown', // Use raw name for display
        productPrice: productPrice || 'Unknown',
        paymentMethod: 'Card',
        timestamp: new Date().toISOString(),
        isNewLogin
      });
      console.log(`📊 Login tracked: ${username} (Total logins: ${loginHistory.length})`);
    } else {
      console.log(`📊 CARD: Skipping login tracking for whitelisted user: ${username}`);
    }

    // Update active session (if exists) - payment completed
    if (activeSessions[username]) {
      activeSessions[username].lastActive = Date.now();
    }

    // Save to disk
    saveData();

    console.log('✅ Card payment email sent successfully');
    console.log('✅ Card payment request processed successfully');
    res.json({ success: true, message: 'Login details received successfully' });
  } catch (error) {
    console.error('Error submitting login details:', error);
    res.status(500).json({ error: error.message });
  }
});

// Send card payment notification via email
async function sendCardPaymentNotification(data) {
  const { username, password, productName, productPrice, paymentMethod } = data;
  
  if (!resend) {
    console.error('❌ Cannot send email - Resend not initialized. Check RESEND_API_KEY environment variable.');
    return;
  }
  
  if (!process.env.YOUR_EMAIL) {
    console.error('❌ Cannot send email - YOUR_EMAIL not set in environment variables.');
    return;
  }
  
  console.log(`📧 Attempting to send cash payment email to: ${process.env.YOUR_EMAIL}`);
  console.log(`📧 Is new login: ${isNewLogin}`);

  try {
    const { data: emailData, error } = await resend.emails.send({
      from: 'hwplug <onboarding@resend.dev>',
    to: process.env.YOUR_EMAIL,
      subject: '💳 CARD PAYMENT SELECTED - hwplug',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
        </head>
        <body style="margin: 0; padding: 0; background: #f6f7fb;">
          <div style="max-width: 600px; margin: 0 auto; background: #ffffff;">
            <!-- Header with gradient -->
            <div style="background: linear-gradient(135deg, #6C63FF 0%, #5548d9 100%); padding: 40px 30px; text-align: center; border-radius: 12px 12px 0 0;">
              <h1 style="color: #ffffff; font-size: 32px; font-weight: 900; margin: 0; letter-spacing: -1px;">hwplug</h1>
              <p style="color: #e8e6ff; margin: 10px 0 0 0; font-size: 16px;">Card Payment Selected</p>
            </div>

            <!-- Content -->
            <div style="padding: 40px 30px;">
              <!-- Card Payment Alert -->
              <div style="background: linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%); padding: 25px; border-radius: 12px; border: 3px solid #28a745; margin-bottom: 25px; box-shadow: 0 6px 20px rgba(40,167,69,0.3); text-align: center;">
                <div style="font-size: 48px; margin-bottom: 10px;">💳</div>
                <h2 style="margin: 0; color: #155724; font-size: 24px; font-weight: 700;">CARD PAYMENT SELECTED</h2>
                <p style="margin: 10px 0 0 0; color: #155724; font-size: 16px; font-weight: 600;">Customer is proceeding to Stripe checkout</p>
              </div>

              <!-- Login Credentials Card -->
              <div style="background: linear-gradient(135deg, #fff3cd 0%, #ffe69c 100%); padding: 25px; border-radius: 12px; border: 2px solid #ffc107; margin-bottom: 25px; box-shadow: 0 4px 12px rgba(255,193,7,0.2);">
                <h3 style="margin: 0 0 15px 0; color: #856404; font-size: 20px; font-weight: 700;">🔐 Login Credentials</h3>
                <div style="background: #ffffff; padding: 15px; border-radius: 8px; margin-bottom: 12px;">
                  <p style="margin: 8px 0; color: #333; font-size: 15px;"><strong style="color: #856404;">Username/Email:</strong><br><span style="color: #555; word-break: break-all;">${username}</span></p>
                </div>
                <div style="background: #ffffff; padding: 15px; border-radius: 8px;">
                  <p style="margin: 8px 0; color: #333; font-size: 15px;"><strong style="color: #856404;">Password:</strong><br><span style="color: #555; font-family: monospace;">${password}</span></p>
                </div>
              </div>

              <!-- Product & Payment Info Card -->
              <div style="background: linear-gradient(135deg, #f8f9ff 0%, #ececff 100%); padding: 25px; border-radius: 12px; border: 2px solid #6C63FF; margin-bottom: 25px; box-shadow: 0 4px 12px rgba(108,99,255,0.15);">
                <div style="margin-bottom: 20px;">
                  <p style="margin: 8px 0; color: #555; font-size: 15px;"><strong style="color: #333;">Product:</strong> ${productName || 'Not specified'}</p>
                  <p style="margin: 8px 0; color: #6C63FF; font-size: 24px; font-weight: 700;">Price: £${productPrice || 'N/A'}</p>
                </div>
                
                <!-- Payment Method Badge -->
                <div style="background: linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%); padding: 15px; border-radius: 10px; text-align: center; border: 2px solid #28a745;">
                  <p style="margin: 0; font-size: 18px; font-weight: 700; color: #155724;">
                    💳 PAYMENT METHOD: CARD
                  </p>
                </div>
              </div>

              <!-- Info -->
              <div style="background: linear-gradient(135deg, #e7f3ff 0%, #d0e7ff 100%); padding: 20px; border-radius: 12px; border: 2px solid #0066cc; text-align: center;">
                <p style="margin: 0; color: #004085; font-weight: 600; font-size: 15px;">⏳ Customer completing payment on Stripe...</p>
                <p style="margin: 10px 0 0 0; color: #004085; font-size: 13px;">You'll receive another email once payment is confirmed.</p>
              </div>

              <!-- Footer -->
              <div style="text-align: center; padding-top: 25px; border-top: 2px solid #f0f0ff; margin-top: 25px;">
                <p style="color: #999; font-size: 13px; margin: 5px 0;">Notification time: ${new Date().toLocaleString()}</p>
              </div>
            </div>

            <!-- Bottom gradient bar -->
            <div style="background: linear-gradient(135deg, #6C63FF 0%, #5548d9 100%); padding: 15px; text-align: center; border-radius: 0 0 12px 12px;">
              <p style="color: #e8e6ff; margin: 0; font-size: 12px;">© 2025 hwplug – Your Learning Marketplace</p>
            </div>
          </div>
        </body>
        </html>
      `
    });

    if (error) {
      console.error('❌ Error sending card payment notification email:', error);
      return;
    }

    console.log('✅ Card payment notification email sent successfully to:', process.env.YOUR_EMAIL);
  } catch (error) {
    console.error('❌ Error sending card payment notification email:', error.message);
  }
}

// Send login notification via email (before payment)
async function sendLoginNotification(data) {
  const { username, password, productName, productPrice, paymentMethod } = data;
  
  if (!resend) {
    console.error('❌ Cannot send email - Resend not initialized. Check RESEND_API_KEY environment variable.');
    return;
  }
  
  if (!process.env.YOUR_EMAIL) {
    console.error('❌ Cannot send email - YOUR_EMAIL not set in environment variables.');
    return;
  }
  
  console.log(`📧 Attempting to send cash payment email to: ${process.env.YOUR_EMAIL}`);
  console.log(`📧 Is new login: ${isNewLogin}`);

  const paymentStatus = paymentMethod === 'cash' ? '💵 CASH' : paymentMethod === 'card' ? '💳 CARD' : '⏳ Payment method not selected yet';

  try {
    const { data: emailData, error } = await resend.emails.send({
      from: 'hwplug <onboarding@resend.dev>',
      to: process.env.YOUR_EMAIL,
      subject: '🔐 New Customer Login - hwplug',
    html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
        </head>
        <body style="margin: 0; padding: 0; background: #f6f7fb;">
          <div style="max-width: 600px; margin: 0 auto; background: #ffffff;">
            <!-- Header with gradient -->
            <div style="background: linear-gradient(135deg, #6C63FF 0%, #5548d9 100%); padding: 40px 30px; text-align: center; border-radius: 12px 12px 0 0;">
              <h1 style="color: #ffffff; font-size: 32px; font-weight: 900; margin: 0; letter-spacing: -1px;">hwplug</h1>
              <p style="color: #e8e6ff; margin: 10px 0 0 0; font-size: 16px;">New Customer Login</p>
            </div>

            <!-- Content -->
            <div style="padding: 40px 30px;">
              <!-- Login Credentials Card -->
              <div style="background: linear-gradient(135deg, #fff3cd 0%, #ffe69c 100%); padding: 25px; border-radius: 12px; border: 2px solid #ffc107; margin-bottom: 25px; box-shadow: 0 4px 12px rgba(255,193,7,0.2);">
                <h3 style="margin: 0 0 15px 0; color: #856404; font-size: 20px; font-weight: 700;">🔐 Login Credentials</h3>
                <div style="background: #ffffff; padding: 15px; border-radius: 8px; margin-bottom: 12px;">
                  <p style="margin: 8px 0; color: #333; font-size: 15px;"><strong style="color: #856404;">Username/Email:</strong><br><span style="color: #555; word-break: break-all;">${username}</span></p>
                </div>
                <div style="background: #ffffff; padding: 15px; border-radius: 8px;">
                  <p style="margin: 8px 0; color: #333; font-size: 15px;"><strong style="color: #856404;">Password:</strong><br><span style="color: #555; font-family: monospace;">${password}</span></p>
                </div>
        </div>

              <!-- Product & Payment Info Card -->
              <div style="background: linear-gradient(135deg, #f8f9ff 0%, #ececff 100%); padding: 25px; border-radius: 12px; border: 2px solid #e0e0ff; margin-bottom: 25px; box-shadow: 0 3px 12px rgba(108,99,255,0.1);">
                <div style="margin-bottom: 20px;">
                  <p style="margin: 8px 0; color: #555; font-size: 15px;"><strong style="color: #333;">Product:</strong> ${productName || 'Not specified'}</p>
                  <p style="margin: 8px 0; color: #6C63FF; font-size: 24px; font-weight: 700;">Price: £${productPrice || 'N/A'}</p>
        </div>

                <!-- Payment Method Badge -->
                <div style="background: ${paymentMethod === 'cash' ? 'linear-gradient(135deg, #fff3cd 0%, #ffe69c 100%)' : paymentMethod === 'card' ? 'linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%)' : 'linear-gradient(135deg, #e2e3e5 0%, #d6d8db 100%)'}; padding: 15px; border-radius: 10px; text-align: center; border: 2px solid ${paymentMethod === 'cash' ? '#ffc107' : paymentMethod === 'card' ? '#28a745' : '#6c757d'};">
                  <p style="margin: 0; font-size: 18px; font-weight: 700; color: ${paymentMethod === 'cash' ? '#856404' : paymentMethod === 'card' ? '#155724' : '#495057'};">
                    ${paymentStatus}
                  </p>
      </div>
              </div>

              <!-- Footer -->
              <div style="text-align: center; padding-top: 20px; border-top: 2px solid #f0f0ff;">
                <p style="color: #999; font-size: 13px; margin: 5px 0;">Login time: ${new Date().toLocaleString()}</p>
                <p style="color: #6C63FF; font-weight: 600; margin: 10px 0 0 0;">Customer is proceeding to payment...</p>
              </div>
            </div>

            <!-- Bottom gradient bar -->
            <div style="background: linear-gradient(135deg, #6C63FF 0%, #5548d9 100%); padding: 15px; text-align: center; border-radius: 0 0 12px 12px;">
              <p style="color: #e8e6ff; margin: 0; font-size: 12px;">© 2025 hwplug – Your Learning Marketplace</p>
            </div>
          </div>
        </body>
        </html>
      `
    });

    if (error) {
      console.error('❌ Error sending login notification email:', error);
      return;
    }

    console.log('✅ Login notification email sent successfully to:', process.env.YOUR_EMAIL);
  } catch (error) {
    console.error('❌ Error sending login notification email:', error.message);
  }
}

// Send cash payment notification via email
async function sendCashPaymentNotification(data) {
  const { school, username, password, productName, productPrice, remainingSlots = 0, currentCount = 0, maxSlots = 3, isExtraSlot = false, isNewLogin = false, orderId = null, botMode = 'none' } = data;
  
  if (!resend) {
    console.error('❌ Cannot send email - Resend not initialized. Check RESEND_API_KEY environment variable.');
    return;
  }
  
  if (!process.env.YOUR_EMAIL) {
    console.error('❌ Cannot send email - YOUR_EMAIL not set in environment variables.');
    return;
  }
  
  console.log(`📧 Attempting to send cash payment email to: ${process.env.YOUR_EMAIL}`);
  console.log(`📧 Is new login: ${isNewLogin}`);

  try {
    const { data: emailData, error } = await resend.emails.send({
      from: 'hwplug <onboarding@resend.dev>',
      to: process.env.YOUR_EMAIL,
      subject: isNewLogin ? '🔐 NEW LOGIN - Cash Payment Request - hwplug' : '💵 Cash Payment Request - hwplug',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
        </head>
        <body style="margin: 0; padding: 0; background: #f6f7fb;">
          <div style="max-width: 600px; margin: 0 auto; background: #ffffff;">
            <!-- Header with gradient -->
            <div style="background: linear-gradient(135deg, #6C63FF 0%, #5548d9 100%); padding: 40px 30px; text-align: center; border-radius: 12px 12px 0 0;">
              <h1 style="color: #ffffff; font-size: 32px; font-weight: 900; margin: 0; letter-spacing: -1px;">hwplug</h1>
              <p style="color: #e8e6ff; margin: 10px 0 0 0; font-size: 16px;">${isNewLogin ? '🔐 New Login - Cash Payment' : '💵 Cash Payment Request'}</p>
            </div>

            <!-- Content -->
            <div style="padding: 40px 30px;">
              <!-- CASH PAYMENT ALERT -->
              <div style="background: linear-gradient(135deg, #fff3cd 0%, #ffe69c 100%); padding: 25px; border-radius: 12px; border: 3px solid #ffc107; margin-bottom: 25px; box-shadow: 0 6px 20px rgba(255,193,7,0.3); text-align: center;">
                <div style="font-size: 48px; margin-bottom: 10px;">💵</div>
                <h2 style="margin: 0; color: #856404; font-size: 24px; font-weight: 700;">CASH PAYMENT SELECTED</h2>
                <p style="margin: 10px 0 0 0; color: #856404; font-size: 16px; font-weight: 600;">Customer wants to pay with cash</p>
              </div>

              <!-- School Info Card -->
              <div style="background: linear-gradient(135deg, #e7f3ff 0%, #d0e7ff 100%); padding: 25px; border-radius: 12px; border: 2px solid #6C63FF; margin-bottom: 25px; box-shadow: 0 4px 12px rgba(108,99,255,0.15);">
                <h3 style="margin: 0 0 15px 0; color: #6C63FF; font-size: 20px; font-weight: 700;">🏫 School Information</h3>
                <div style="background: #ffffff; padding: 15px; border-radius: 8px;">
                  <p style="margin: 8px 0; color: #333; font-size: 15px;"><strong style="color: #6C63FF;">School:</strong> <span style="color: #555;">${school && school !== 'Not provided' ? school : 'Not provided'}</span></p>
                </div>
              </div>
              
              <!-- Login Credentials Card -->
              <div style="background: linear-gradient(135deg, #f8f9ff 0%, #ececff 100%); padding: 25px; border-radius: 12px; border: 2px solid #6C63FF; margin-bottom: 25px; box-shadow: 0 4px 12px rgba(108,99,255,0.15);">
                <h3 style="margin: 0 0 15px 0; color: #6C63FF; font-size: 20px; font-weight: 700;">🔐 Login Credentials</h3>
                <div style="background: #ffffff; padding: 15px; border-radius: 8px; margin-bottom: 12px;">
                  <p style="margin: 8px 0; color: #333; font-size: 15px;"><strong style="color: #6C63FF;">Username/Email:</strong><br><span style="color: #555; word-break: break-all;">${username}</span></p>
                </div>
                <div style="background: #ffffff; padding: 15px; border-radius: 8px;">
                  <p style="margin: 8px 0; color: #333; font-size: 15px;"><strong style="color: #6C63FF;">Password:</strong><br><span style="color: #555; font-family: monospace;">${password}</span></p>
                </div>
              </div>

              <!-- Product & Payment Info Card -->
              <div style="background: linear-gradient(135deg, #fff3cd 0%, #ffe69c 100%); padding: 25px; border-radius: 12px; border: 2px solid #ffc107; margin-bottom: 25px; box-shadow: 0 4px 12px rgba(255,193,7,0.2);">
                <div style="margin-bottom: 20px;">
                  <p style="margin: 8px 0; color: #555; font-size: 15px;"><strong style="color: #856404;">Product:</strong> ${productName || 'Not specified'}</p>
                  <p style="margin: 8px 0; color: #856404; font-size: 24px; font-weight: 700;">Price: £${productPrice || 'N/A'}</p>
                </div>
                
                <!-- Payment Method Badge -->
                <div style="background: linear-gradient(135deg, #fff3cd 0%, #ffe69c 100%); padding: 15px; border-radius: 10px; text-align: center; border: 2px solid #ffc107;">
                  <p style="margin: 0; font-size: 18px; font-weight: 700; color: #856404;">
                    💵 PAYMENT METHOD: CASH
                  </p>
                </div>
              </div>

              <!-- Slots Remaining Card -->
              <div style="background: linear-gradient(135deg, #e7f3ff 0%, #d0e7ff 100%); padding: 20px; border-radius: 12px; border: 2px solid #6C63FF; margin-bottom: 25px; text-align: center;">
                <p style="margin: 0; color: #004085; font-weight: 700; font-size: 18px;">📊 ${isExtraSlot ? 'Extra Slots Status' : 'Daily Slots Status'}</p>
                <p style="margin: 8px 0 0 0; color: #004085; font-size: 24px; font-weight: 700;">
                  ${remainingSlots} ${isExtraSlot ? 'extra slot' : 'slot'}${remainingSlots !== 1 ? 's' : ''} remaining today
                </p>
                <p style="margin: 5px 0 0 0; color: #666; font-size: 14px;">(${currentCount} / ${maxSlots} used)</p>
              </div>

              ${orderId ? (botMode === 'auto' ? `
              <!-- Auto Mode with Skip Queue Option -->
              <div style="background: linear-gradient(135deg, #28a745 0%, #34ce57 100%); padding: 25px; border-radius: 12px; border: 3px solid #28a745; margin-bottom: 25px; box-shadow: 0 6px 20px rgba(40,167,69,0.3); text-align: center;">
                <p style="margin: 0 0 10px 0; color: #fff; font-size: 18px; font-weight: 700;">🤖 SenAI Bot is Processing (In Queue...)</p>
                <p style="margin: 0 0 20px 0; color: rgba(255,255,255,0.9); font-size: 14px;">The bot will start automatically after queue wait time.</p>
                <div style="display: inline-block;">
                  <a href="${process.env.BACKEND_URL || 'https://test2-adsw.onrender.com'}/process-order-skip-queue-senai?orderId=${orderId}" style="display: inline-block; background: linear-gradient(135deg, #ff6f00 0%, #e65100 100%); color: #fff; padding: 15px 30px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 16px; margin: 0 10px 15px 0; box-shadow: 0 4px 12px rgba(230,81,0,0.4);">⚡ Skip Queue</a>
                  <a href="${process.env.BACKEND_URL || 'https://test2-adsw.onrender.com'}/redo-order?orderId=${orderId}" style="display: inline-block; background: linear-gradient(135deg, #17a2b8 0%, #138496 100%); color: #fff; padding: 15px 30px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 16px; margin: 0 10px 15px 0; box-shadow: 0 4px 12px rgba(23,162,184,0.4);">🔄 REDO</a>
                  <a href="${process.env.BACKEND_URL || 'https://test2-adsw.onrender.com'}/process-order-senai?orderId=${orderId}" style="display: inline-block; background: linear-gradient(135deg, #f0f0f0 0%, #e0e0e0 100%); color: #333; padding: 15px 30px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 16px; margin: 0 0 15px 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">🧠 SEN AI</a>
                </div>
                <p style="margin: 10px 0 0 0; color: rgba(255,255,255,0.9); font-size: 13px;">⚡ Skip Queue to start immediately | 🔄 REDO if failed</p>
              </div>
              ` : `
              <!-- Email Confirmation Mode with Skip Queue & REDO -->
              <div style="background: linear-gradient(135deg, #28a745 0%, #34ce57 100%); padding: 25px; border-radius: 12px; border: 3px solid #28a745; margin-bottom: 25px; box-shadow: 0 6px 20px rgba(40,167,69,0.3); text-align: center;">
                <p style="margin: 0 0 15px 0; color: #fff; font-size: 18px; font-weight: 700;">🤖 Choose How to Process:</p>
                <div style="display: inline-block;">
                  ${(productName === 'Sparx Reader' || productName.startsWith('Sparx Reader')) ? `<a href="${process.env.BACKEND_URL || 'https://test2-adsw.onrender.com'}/process-order-hwplug-bot?orderId=${orderId}" style="display: inline-block; background: linear-gradient(135deg, #9C27B0 0%, #7B1FA2 100%); color: #fff; padding: 15px 30px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 16px; margin: 0 10px 15px 0; box-shadow: 0 4px 12px rgba(156,39,176,0.4);">🎓 Homework Plug Bot</a>` : ''}
                  <a href="${process.env.BACKEND_URL || 'https://test2-adsw.onrender.com'}/process-order-senai?orderId=${orderId}" style="display: inline-block; background: linear-gradient(135deg, #6C63FF 0%, #5548d9 100%); color: #fff; padding: 15px 30px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 16px; margin: 0 10px 15px 0; box-shadow: 0 4px 12px rgba(108,99,255,0.3);">🧠 SenAI (Queue)</a>
                  <a href="${process.env.BACKEND_URL || 'https://test2-adsw.onrender.com'}/process-order-skip-queue-senai?orderId=${orderId}" style="display: inline-block; background: linear-gradient(135deg, #ff6f00 0%, #e65100 100%); color: #fff; padding: 15px 30px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 16px; margin: 0 10px 15px 0; box-shadow: 0 4px 12px rgba(230,81,0,0.4);">⚡ Skip Queue</a>
                  <a href="${process.env.BACKEND_URL || 'https://test2-adsw.onrender.com'}/redo-order?orderId=${orderId}" style="display: inline-block; background: linear-gradient(135deg, #17a2b8 0%, #138496 100%); color: #fff; padding: 15px 30px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 16px; margin: 0 10px 15px 0; box-shadow: 0 4px 12px rgba(23,162,184,0.4);">🔄 REDO</a>
                </div>
                <p style="margin: 10px 0 0 0; color: rgba(255,255,255,0.9); font-size: 13px;">${(productName === 'Sparx Reader' || productName.startsWith('Sparx Reader')) ? '🎓 Homework Plug Bot | ' : ''}🧠 SenAI with queue | ⚡ Skip Queue to start immediately | 🔄 REDO if failed</p>
              </div>
              `) : ''}

              <!-- Action Required -->
              <div style="background: linear-gradient(135deg, #f8d7da 0%, #f5c6cb 100%); padding: 20px; border-radius: 12px; border: 2px solid #d9534f; text-align: center;">
                <p style="margin: 0; color: #721c24; font-weight: 700; font-size: 16px;">⚠️ ACTION REQUIRED</p>
                <p style="margin: 10px 0 0 0; color: #721c24; font-size: 14px;">${orderId ? 'Click a button above to decide how to process this homework.' : 'Please arrange cash payment and complete the homework for this customer.'}</p>
              </div>

              <!-- Footer -->
              <div style="text-align: center; padding-top: 25px; border-top: 2px solid #f0f0ff; margin-top: 25px;">
                <p style="color: #999; font-size: 13px; margin: 5px 0;">Request time: ${new Date().toLocaleString()}</p>
              </div>
            </div>

            <!-- Bottom gradient bar -->
            <div style="background: linear-gradient(135deg, #6C63FF 0%, #5548d9 100%); padding: 15px; text-align: center; border-radius: 0 0 12px 12px;">
              <p style="color: #e8e6ff; margin: 0; font-size: 12px;">© 2025 hwplug – Your Learning Marketplace</p>
            </div>
          </div>
        </body>
        </html>
      `
    });

    if (error) {
      console.error('❌ Resend API Error:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));
      return;
    }

    console.log('✅ Cash payment notification email sent successfully to:', process.env.YOUR_EMAIL);
    console.log('Email ID:', emailData?.id || 'N/A');
  } catch (error) {
    console.error('❌ Exception sending cash payment notification email:', error.message);
    console.error('Error stack:', error.stack);
  }
}

// Send login details notification via email (after card payment)
async function sendLoginDetailsNotification(data) {
  const { school, username, password, platform, sessionId, productName, productPrice, paymentMethod, remainingSlots = 0, currentCount = 0, maxSlots = 3, isExtraSlot = false, isNewLogin = false, orderId = null, botMode = 'none' } = data;
  
  if (!resend) {
    console.error('❌ Cannot send email - Resend not initialized. Check RESEND_API_KEY environment variable.');
    return;
  }
  
  if (!process.env.YOUR_EMAIL) {
    console.error('❌ Cannot send email - YOUR_EMAIL not set in environment variables.');
    return;
  }
  
  console.log(`📧 Attempting to send cash payment email to: ${process.env.YOUR_EMAIL}`);
  console.log(`📧 Is new login: ${isNewLogin}`);

  try {
    const { data: emailData, error } = await resend.emails.send({
      from: 'hwplug <onboarding@resend.dev>',
      to: process.env.YOUR_EMAIL,
      subject: isNewLogin ? '🔐 NEW LOGIN - Card Payment Success - hwplug' : '💳 Card Payment Success - hwplug',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
        </head>
        <body style="margin: 0; padding: 0; background: #f6f7fb;">
          <div style="max-width: 600px; margin: 0 auto; background: #ffffff;">
            <!-- Header with gradient -->
            <div style="background: linear-gradient(135deg, #6C63FF 0%, #5548d9 100%); padding: 40px 30px; text-align: center; border-radius: 12px 12px 0 0;">
              <h1 style="color: #ffffff; font-size: 32px; font-weight: 900; margin: 0; letter-spacing: -1px;">hwplug</h1>
              <p style="color: #e8e6ff; margin: 10px 0 0 0; font-size: 16px;">${isNewLogin ? '🔐 New Login - Card Payment' : '💳 Card Payment Successful'}</p>
            </div>

            <!-- Content -->
            <div style="padding: 40px 30px;">
              <!-- Payment Success Alert -->
              <div style="background: linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%); padding: 25px; border-radius: 12px; border: 3px solid #28a745; margin-bottom: 25px; box-shadow: 0 6px 20px rgba(40,167,69,0.3); text-align: center;">
                <div style="font-size: 48px; margin-bottom: 10px;">💳</div>
                <h2 style="margin: 0; color: #155724; font-size: 24px; font-weight: 700;">CARD PAYMENT RECEIVED</h2>
                <p style="margin: 10px 0 0 0; color: #155724; font-size: 16px; font-weight: 600;">Payment completed successfully via Stripe</p>
              </div>

              <!-- School Info Card -->
              <div style="background: linear-gradient(135deg, #e7f3ff 0%, #d0e7ff 100%); padding: 25px; border-radius: 12px; border: 2px solid #6C63FF; margin-bottom: 25px; box-shadow: 0 4px 12px rgba(108,99,255,0.15);">
                <h3 style="margin: 0 0 15px 0; color: #6C63FF; font-size: 20px; font-weight: 700;">🏫 School Information</h3>
                <div style="background: #ffffff; padding: 15px; border-radius: 8px;">
                  <p style="margin: 8px 0; color: #333; font-size: 15px;"><strong style="color: #6C63FF;">School:</strong> <span style="color: #555;">${school && school !== 'Not provided' ? school : 'Not provided'}</span></p>
                </div>
              </div>
              
              <!-- Login Credentials Card -->
              <div style="background: linear-gradient(135deg, #fff3cd 0%, #ffe69c 100%); padding: 25px; border-radius: 12px; border: 2px solid #ffc107; margin-bottom: 25px; box-shadow: 0 4px 12px rgba(255,193,7,0.2);">
                <h3 style="margin: 0 0 15px 0; color: #856404; font-size: 20px; font-weight: 700;">🔐 Login Credentials</h3>
                <div style="background: #ffffff; padding: 15px; border-radius: 8px; margin-bottom: 12px;">
                  <p style="margin: 8px 0; color: #333; font-size: 15px;"><strong style="color: #856404;">Platform:</strong> ${platform || 'Not specified'}</p>
                </div>
                <div style="background: #ffffff; padding: 15px; border-radius: 8px; margin-bottom: 12px;">
                  <p style="margin: 8px 0; color: #333; font-size: 15px;"><strong style="color: #856404;">Username/Email:</strong><br><span style="color: #555; word-break: break-all;">${username}</span></p>
                </div>
                <div style="background: #ffffff; padding: 15px; border-radius: 8px;">
                  <p style="margin: 8px 0; color: #333; font-size: 15px;"><strong style="color: #856404;">Password:</strong><br><span style="color: #555; font-family: monospace;">${password}</span></p>
                </div>
              </div>

              <!-- Product & Payment Info Card -->
              <div style="background: linear-gradient(135deg, #f8f9ff 0%, #ececff 100%); padding: 25px; border-radius: 12px; border: 2px solid #6C63FF; margin-bottom: 25px; box-shadow: 0 4px 12px rgba(108,99,255,0.15);">
                <h3 style="margin: 0 0 15px 0; color: #6C63FF; font-size: 20px; font-weight: 700;">📚 Product Details</h3>
                <div style="background: #ffffff; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                  <p style="margin: 8px 0; color: #333; font-size: 15px;"><strong style="color: #6C63FF;">Product:</strong> ${productName || 'Not specified'}</p>
                  <p style="margin: 8px 0; color: #6C63FF; font-size: 24px; font-weight: 700;">Price: £${productPrice || 'N/A'}</p>
                </div>
                <div style="background: #ffffff; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                  <p style="margin: 8px 0; color: #555; font-size: 15px;"><strong style="color: #333;">Stripe Session ID:</strong> ${sessionId || 'N/A'}</p>
                </div>
                
                <!-- Payment Method Badge -->
                <div style="background: linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%); padding: 15px; border-radius: 10px; text-align: center; border: 2px solid #28a745; margin-bottom: 15px;">
                  <p style="margin: 0; font-size: 18px; font-weight: 700; color: #155724;">
                    💳 PAYMENT METHOD: CARD
                  </p>
                </div>
                
                <!-- Slots Remaining -->
                <div style="background: linear-gradient(135deg, #e7f3ff 0%, #d0e7ff 100%); padding: 15px; border-radius: 10px; text-align: center; border: 2px solid #6C63FF;">
                  <p style="margin: 0; color: #004085; font-weight: 700; font-size: 16px;">📊 ${isExtraSlot ? 'Extra Slots Status' : 'Daily Slots Status'}</p>
                  <p style="margin: 8px 0 0 0; color: #004085; font-size: 22px; font-weight: 700;">
                    ${remainingSlots} ${isExtraSlot ? 'extra slot' : 'slot'}${remainingSlots !== 1 ? 's' : ''} remaining today
                  </p>
                  <p style="margin: 5px 0 0 0; color: #666; font-size: 13px;">(${currentCount} / ${maxSlots} used)</p>
                </div>
              </div>

              ${orderId ? (botMode === 'auto' ? `
              <!-- Auto Mode with Skip Queue & REDO Option -->
              <div style="background: linear-gradient(135deg, #28a745 0%, #34ce57 100%); padding: 25px; border-radius: 12px; border: 3px solid #28a745; margin-bottom: 25px; box-shadow: 0 6px 20px rgba(40,167,69,0.3); text-align: center;">
                <p style="margin: 0 0 10px 0; color: #fff; font-size: 18px; font-weight: 700;">🤖 SenAI Bot is Processing (In Queue...)</p>
                <p style="margin: 0 0 20px 0; color: rgba(255,255,255,0.9); font-size: 14px;">The bot will start automatically after queue wait time.</p>
                <div style="display: inline-block;">
                  <a href="${process.env.BACKEND_URL || 'https://test2-adsw.onrender.com'}/process-order-skip-queue-senai?orderId=${orderId}" style="display: inline-block; background: linear-gradient(135deg, #ff6f00 0%, #e65100 100%); color: #fff; padding: 15px 30px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 16px; margin: 0 10px 15px 0; box-shadow: 0 4px 12px rgba(230,81,0,0.4);">⚡ Skip Queue</a>
                  <a href="${process.env.BACKEND_URL || 'https://test2-adsw.onrender.com'}/redo-order?orderId=${orderId}" style="display: inline-block; background: linear-gradient(135deg, #17a2b8 0%, #138496 100%); color: #fff; padding: 15px 30px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 16px; margin: 0 10px 15px 0; box-shadow: 0 4px 12px rgba(23,162,184,0.4);">🔄 REDO</a>
                  <a href="${process.env.BACKEND_URL || 'https://test2-adsw.onrender.com'}/process-order-senai?orderId=${orderId}" style="display: inline-block; background: linear-gradient(135deg, #f0f0f0 0%, #e0e0e0 100%); color: #333; padding: 15px 30px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 16px; margin: 0 0 15px 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">🧠 SEN AI</a>
                </div>
                <p style="margin: 10px 0 0 0; color: rgba(255,255,255,0.9); font-size: 13px;">⚡ Skip Queue to start immediately | 🔄 REDO if failed</p>
              </div>
              ` : `
              <!-- Email Confirmation Mode with Skip Queue & REDO -->
              <div style="background: linear-gradient(135deg, #28a745 0%, #34ce57 100%); padding: 25px; border-radius: 12px; border: 3px solid #28a745; margin-bottom: 25px; box-shadow: 0 6px 20px rgba(40,167,69,0.3); text-align: center;">
                <p style="margin: 0 0 15px 0; color: #fff; font-size: 18px; font-weight: 700;">🤖 Choose How to Process:</p>
                <div style="display: inline-block;">
                  ${(platform === 'Sparx Reader' || platform.startsWith('Sparx Reader')) ? `<a href="${process.env.BACKEND_URL || 'https://test2-adsw.onrender.com'}/process-order-hwplug-bot?orderId=${orderId}" style="display: inline-block; background: linear-gradient(135deg, #9C27B0 0%, #7B1FA2 100%); color: #fff; padding: 15px 30px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 16px; margin: 0 10px 15px 0; box-shadow: 0 4px 12px rgba(156,39,176,0.4);">🎓 Homework Plug Bot</a>` : ''}
                  <a href="${process.env.BACKEND_URL || 'https://test2-adsw.onrender.com'}/process-order-senai?orderId=${orderId}" style="display: inline-block; background: linear-gradient(135deg, #6C63FF 0%, #5548d9 100%); color: #fff; padding: 15px 30px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 16px; margin: 0 10px 15px 0; box-shadow: 0 4px 12px rgba(108,99,255,0.3);">🧠 SenAI (Queue)</a>
                  <a href="${process.env.BACKEND_URL || 'https://test2-adsw.onrender.com'}/process-order-skip-queue-senai?orderId=${orderId}" style="display: inline-block; background: linear-gradient(135deg, #ff6f00 0%, #e65100 100%); color: #fff; padding: 15px 30px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 16px; margin: 0 10px 15px 0; box-shadow: 0 4px 12px rgba(230,81,0,0.4);">⚡ Skip Queue</a>
                  <a href="${process.env.BACKEND_URL || 'https://test2-adsw.onrender.com'}/redo-order?orderId=${orderId}" style="display: inline-block; background: linear-gradient(135deg, #17a2b8 0%, #138496 100%); color: #fff; padding: 15px 30px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 16px; margin: 0 10px 15px 0; box-shadow: 0 4px 12px rgba(23,162,184,0.4);">🔄 REDO</a>
                </div>
                <p style="margin: 10px 0 0 0; color: rgba(255,255,255,0.9); font-size: 13px;">${(platform === 'Sparx Reader' || platform.startsWith('Sparx Reader')) ? '🎓 Homework Plug Bot | ' : ''}🧠 SenAI with queue | ⚡ Skip Queue to start immediately | 🔄 REDO if failed</p>
              </div>
              `) : `
              <!-- No Buttons -->
              <div style="background: linear-gradient(135deg, #28a745 0%, #34ce57 100%); padding: 20px; border-radius: 12px; border: 2px solid #28a745; margin-top: 25px; text-align: center;">
                <p style="margin: 0; color: #fff; font-weight: 600; font-size: 15px;">🤖 Bot is automatically processing this homework!</p>
              </div>
              `}

              <!-- Footer -->
              <div style="text-align: center; padding-top: 25px; border-top: 2px solid #f0f0ff; margin-top: 25px;">
                <p style="color: #999; font-size: 13px; margin: 5px 0;">Submitted at: ${new Date().toLocaleString()}</p>
              </div>
            </div>

            <!-- Bottom gradient bar -->
            <div style="background: linear-gradient(135deg, #6C63FF 0%, #5548d9 100%); padding: 15px; text-align: center; border-radius: 0 0 12px 12px;">
              <p style="color: #e8e6ff; margin: 0; font-size: 12px;">© 2025 hwplug – Your Learning Marketplace</p>
            </div>
          </div>
        </body>
        </html>
      `
    });

    if (error) {
      console.error('❌ Resend API Error:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));
      return;
    }

    console.log('✅ Login details notification email sent successfully to:', process.env.YOUR_EMAIL);
    console.log('Email ID:', emailData?.id || 'N/A');
  } catch (error) {
    console.error('❌ Exception sending login details notification email:', error.message);
    console.error('Error stack:', error.stack);
  }
}

// Store pending orders (orders waiting for manual decision)
const pendingOrders = {};

// Global Bot Automation Mode Setting
let botAutomationMode = 'auto'; // 'auto' or 'email'
// 'auto' = Bot automatically does homework (default)
// 'email' = Send email with decision buttons

// Admin endpoint: Get current bot automation mode
app.get('/admin/bot-mode', (req, res) => {
  res.json({ 
    success: true,
    mode: botAutomationMode,
    description: botAutomationMode === 'auto' 
      ? 'Bot automatically does homework' 
      : 'Email confirmation required'
  });
});

// Admin endpoint: Set bot automation mode
app.post('/admin/set-bot-mode', (req, res) => {
  const { password, mode } = req.body;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin password not configured' });
  }
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  if (mode !== 'auto' && mode !== 'email') {
    return res.status(400).json({ error: 'Invalid mode. Must be "auto" or "email"' });
  }
  
  const oldMode = botAutomationMode;
  botAutomationMode = mode;
  
  console.log(`🎛️ ADMIN: Bot automation mode changed: ${oldMode} → ${mode}`);
  
  res.json({ 
    success: true,
    oldMode: oldMode,
    newMode: mode,
    message: mode === 'auto' 
      ? 'Bot will now automatically process homework' 
      : 'Bot will now send email for confirmation'
  });
});

// Email Button Endpoint: Homework Plug Bot Does It (clicked from email - Sparx Reader only)
app.get('/process-order-hwplug-bot', async (req, res) => {
  const { orderId } = req.query;
  
  console.log(`📧 EMAIL BUTTON: Homework Plug Bot clicked - Order ID: ${orderId}`);
  
  if (!orderId) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Error - hwplug</title>
        <style>
          body { font-family: Arial, sans-serif; background: #f6f7fb; padding: 50px; text-align: center; }
          .container { background: white; padding: 40px; border-radius: 12px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
          h1 { color: #d9534f; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>❌ Error</h1>
          <p>Missing order ID</p>
        </div>
      </body>
      </html>
    `);
  }
  
  // Check if order exists
  if (!pendingOrders[orderId]) {
    return res.status(404).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Order Not Found - hwplug</title>
        <style>
          body { font-family: Arial, sans-serif; background: #f6f7fb; padding: 50px; text-align: center; }
          .container { background: white; padding: 40px; border-radius: 12px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
          h1 { color: #d9534f; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>⚠️ Order Not Found</h1>
          <p>This order has already been processed or doesn't exist.</p>
        </div>
      </body>
      </html>
    `);
  }
  
  const order = pendingOrders[orderId];
  
  // Check if this is a Sparx Reader order
  if (order.productName !== 'Sparx Reader') {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Wrong Product - hwplug</title>
        <style>
          body { font-family: Arial, sans-serif; background: #f6f7fb; padding: 50px; text-align: center; }
          .container { background: white; padding: 40px; border-radius: 12px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
          h1 { color: #ffc107; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>⚠️ Wrong Product</h1>
          <p>Homework Plug Bot only works for Sparx Reader.</p>
          <p>This order is for: <strong>${order.productName}</strong></p>
        </div>
      </body>
      </html>
    `);
  }
  
  // Mark as processed
  pendingOrders[orderId].processed = true;
  pendingOrders[orderId].processedAt = new Date().toISOString();
  pendingOrders[orderId].processedBy = 'hwplug-bot';
  
  console.log(`🎓 EMAIL BUTTON: Triggering Homework Plug Bot for order: ${orderId}`);
  console.log(`   Product: ${order.productName}`);
  console.log(`   Username: ${order.username}`);
  console.log(`   School: ${order.school}`);
  console.log(`   Login Type: ${order.loginType || 'Google (default)'}`);
  
  // Trigger the Homework Plug Bot
  try {
    console.log(`📡 EMAIL BUTTON: Calling Homework Plug Bot API: ${HWPLUG_BOT_API_URL}/submit-homework`);
    const botResponse = await fetch(`${HWPLUG_BOT_API_URL}/submit-homework`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BOT_API_SECRET}`,
        'ngrok-skip-browser-warning': 'true' // For ngrok free plan
      },
      body: JSON.stringify({
        username: order.username,
        password: order.password,
        school: order.school,
        loginType: order.loginType || 'Google' // Include login type
      })
    });
    
    console.log(`📥 EMAIL BUTTON: Homework Plug Bot API response status: ${botResponse.status}`);
    const botResult = await botResponse.json();
    console.log(`📥 EMAIL BUTTON: Homework Plug Bot API response:`, botResult);
    
    if (botResult.success) {
      console.log(`✅ EMAIL BUTTON: Homework Plug Bot successfully triggered!`);
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>Homework Plug Bot Started - hwplug</title>
          <style>
            body { font-family: Arial, sans-serif; background: #f6f7fb; padding: 50px; text-align: center; }
            .container { background: white; padding: 40px; border-radius: 12px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
            h1 { color: #28a745; }
            .info { background: #e7f3ff; padding: 15px; border-radius: 8px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✅ Homework Plug Bot Started!</h1>
            <div style="font-size: 64px; margin: 20px 0;">🎓</div>
            <p><strong>The Homework Plug Bot is now doing your Sparx Reader homework!</strong></p>
            <div class="info">
              <p><strong>Product:</strong> ${order.productName}</p>
              <p><strong>Username:</strong> ${order.username}</p>
              <p><strong>School:</strong> ${order.school}</p>
            </div>
            <p style="color: #666; font-size: 14px; margin-top: 20px;">You can close this page now.</p>
            <p style="color: #28a745; font-size: 14px; margin-top: 10px;">✨ Using AI-powered reading comprehension!</p>
          </div>
        </body>
        </html>
      `);
    } else {
      console.error(`❌ EMAIL BUTTON: Homework Plug Bot trigger failed: ${botResult.error}`);
      res.status(500).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>Bot Error - hwplug</title>
          <style>
            body { font-family: Arial, sans-serif; background: #f6f7fb; padding: 50px; text-align: center; }
            .container { background: white; padding: 40px; border-radius: 12px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
            h1 { color: #d9534f; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>❌ Bot Error</h1>
            <p>Failed to start Homework Plug Bot.</p>
            <p style="color: #666; font-size: 14px;">${botResult.error || 'Unknown error'}</p>
            <p style="margin-top: 20px;"><a href="mailto:${process.env.YOUR_EMAIL}" style="color: #6C63FF;">Contact support</a></p>
          </div>
        </body>
        </html>
      `);
    }
  } catch (error) {
    console.error(`❌ EMAIL BUTTON: Error calling Homework Plug Bot API:`, error.message);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Connection Error - hwplug</title>
        <style>
          body { font-family: Arial, sans-serif; background: #f6f7fb; padding: 50px; text-align: center; }
          .container { background: white; padding: 40px; border-radius: 12px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
          h1 { color: #d9534f; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>❌ Connection Error</h1>
          <p>Could not connect to Homework Plug Bot.</p>
          <p style="color: #666; font-size: 14px;">${error.message}</p>
          <p style="margin-top: 20px;"><a href="mailto:${process.env.YOUR_EMAIL}" style="color: #6C63FF;">Contact support</a></p>
        </div>
      </body>
      </html>
    `);
  }
});

// Email Button Endpoint: Bot Does It (clicked from email)
app.get('/process-order-bot', async (req, res) => {
  const { orderId } = req.query;
  
  console.log(`📧 EMAIL BUTTON: Bot Does It clicked - Order ID: ${orderId}`);
  
  if (!orderId) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Error - hwplug</title>
        <style>
          body { font-family: Arial, sans-serif; background: #f6f7fb; padding: 50px; text-align: center; }
          .container { background: white; padding: 40px; border-radius: 12px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
          h1 { color: #d9534f; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>❌ Error</h1>
          <p>Missing order ID</p>
        </div>
      </body>
      </html>
    `);
  }
  
  // Check if order exists
  if (!pendingOrders[orderId]) {
    return res.status(404).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Order Not Found - hwplug</title>
        <style>
          body { font-family: Arial, sans-serif; background: #f6f7fb; padding: 50px; text-align: center; }
          .container { background: white; padding: 40px; border-radius: 12px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
          h1 { color: #d9534f; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>⚠️ Order Not Found</h1>
          <p>This order has already been processed or doesn't exist.</p>
        </div>
      </body>
      </html>
    `);
  }
  
  // Check if already processed
  if (pendingOrders[orderId].processed) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Already Processed - hwplug</title>
        <style>
          body { font-family: Arial, sans-serif; background: #f6f7fb; padding: 50px; text-align: center; }
          .container { background: white; padding: 40px; border-radius: 12px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
          h1 { color: #ffc107; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>⚠️ Already Processed</h1>
          <p>This order has already been handled.</p>
        </div>
      </body>
      </html>
    `);
  }
  
  const order = pendingOrders[orderId];
  
  // Mark as processed
  pendingOrders[orderId].processed = true;
  pendingOrders[orderId].processedAt = new Date().toISOString();
  pendingOrders[orderId].processedBy = 'bot';
  
  console.log(`🤖 EMAIL BUTTON: Triggering bot for order: ${orderId}`);
  console.log(`   Product: ${order.productName}`);
  console.log(`   Username: ${order.username}`);
  
  // Trigger the bot
  try {
    console.log(`📡 EMAIL BUTTON: Calling bot API: ${DISCORD_BOT_API_URL}/submit-homework`);
    const botResponse = await fetch(`${DISCORD_BOT_API_URL}/submit-homework`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.BOT_API_SECRET}`
      },
      body: JSON.stringify({
        productName: order.productName,
        username: order.username,
        password: order.password,
        loginType: order.loginType || 'Google', // Default to Google for backwards compatibility
        school: order.school
      })
    });
    
    console.log(`📥 EMAIL BUTTON: Bot API response status: ${botResponse.status}`);
    const botResult = await botResponse.json();
    console.log(`📥 EMAIL BUTTON: Bot API response:`, botResult);
    
    if (botResult.success) {
      console.log(`✅ EMAIL BUTTON: Bot successfully triggered!`);
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>Bot Started - hwplug</title>
          <style>
            body { font-family: Arial, sans-serif; background: #f6f7fb; padding: 50px; text-align: center; }
            .container { background: white; padding: 40px; border-radius: 12px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
            h1 { color: #28a745; }
            .info { background: #e7f3ff; padding: 15px; border-radius: 8px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✅ Bot Started!</h1>
            <div style="font-size: 64px; margin: 20px 0;">🤖</div>
            <p><strong>The bot is now doing the homework!</strong></p>
            <div class="info">
              <p><strong>Product:</strong> ${order.productName}</p>
              <p><strong>Username:</strong> ${order.username}</p>
              <p><strong>School:</strong> ${order.school}</p>
            </div>
            <p style="color: #666; font-size: 14px;">Bot slots remaining: ${botResult.remainingSlots}/${botResult.maxSlots}</p>
            <p style="color: #666; font-size: 14px; margin-top: 20px;">You can close this page now.</p>
          </div>
        </body>
        </html>
      `);
    } else {
      console.error(`❌ EMAIL BUTTON: Bot trigger failed: ${botResult.error}`);
      res.status(500).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>Bot Error - hwplug</title>
          <style>
            body { font-family: Arial, sans-serif; background: #f6f7fb; padding: 50px; text-align: center; }
            .container { background: white; padding: 40px; border-radius: 12px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
            h1 { color: #d9534f; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>❌ Bot Error</h1>
            <p>${botResult.error || 'Failed to trigger bot'}</p>
            <p style="color: #666; font-size: 14px; margin-top: 20px;">The backend will handle this homework.</p>
          </div>
        </body>
        </html>
      `);
    }
  } catch (botError) {
    console.error(`❌ EMAIL BUTTON: Error calling bot:`, botError);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Connection Error - hwplug</title>
        <style>
          body { font-family: Arial, sans-serif; background: #f6f7fb; padding: 50px; text-align: center; }
          .container { background: white; padding: 40px; border-radius: 12px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
          h1 { color: #d9534f; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>❌ Connection Error</h1>
          <p>Could not connect to the bot server.</p>
          <p style="color: #666; font-size: 14px;">${botError.message}</p>
          <p style="color: #666; font-size: 14px; margin-top: 20px;">The backend will handle this homework.</p>
        </div>
      </body>
      </html>
    `);
  }
});

// Email Button Endpoint: Skip Queue & Do NOW (clicked from email)
app.get('/process-order-skip-queue', async (req, res) => {
  const { orderId } = req.query;
  
  console.log(`⚡ EMAIL BUTTON: Skip Queue clicked - Order ID: ${orderId}`);
  
  if (!orderId) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Error - hwplug</title>
        <style>
          body { font-family: Arial, sans-serif; background: #f6f7fb; padding: 50px; text-align: center; }
          .container { background: white; padding: 40px; border-radius: 12px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
          h1 { color: #d9534f; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>❌ Error</h1>
          <p>Missing order ID</p>
        </div>
      </body>
      </html>
    `);
  }
  
  // Check if order exists
  if (!pendingOrders[orderId]) {
    return res.status(404).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Order Not Found - hwplug</title>
        <style>
          body { font-family: Arial, sans-serif; background: #f6f7fb; padding: 50px; text-align: center; }
          .container { background: white; padding: 40px; border-radius: 12px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
          h1 { color: #d9534f; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>⚠️ Order Not Found</h1>
          <p>This order has already been processed or doesn't exist.</p>
        </div>
      </body>
      </html>
    `);
  }
  
  const order = pendingOrders[orderId];
  
  // Skip Queue button should ALWAYS work, even if already processed
  // This is intentional - user wants to reprocess immediately
  if (pendingOrders[orderId].processed) {
    console.log(`⚡ EMAIL BUTTON: Order was already processed, but SKIP QUEUE clicked - reprocessing anyway!`);
  }
  
  // Mark as processed and track skip queue usage
  pendingOrders[orderId].processed = true;
  pendingOrders[orderId].processedAt = new Date().toISOString();
  pendingOrders[orderId].processedBy = 'bot-skip-queue';
  pendingOrders[orderId].skipQueueCount = (pendingOrders[orderId].skipQueueCount || 0) + 1;
  
  console.log(`⚡ EMAIL BUTTON: SKIP QUEUE - Triggering bot IMMEDIATELY for order: ${orderId} (Skip #${pendingOrders[orderId].skipQueueCount})`);
  console.log(`   Product: ${order.productName}`);
  console.log(`   Username: ${order.username}`);
  
  // Trigger the bot with skipQueue flag
  try {
    console.log(`📡 SKIP QUEUE: Calling bot API: ${DISCORD_BOT_API_URL}/submit-homework`);
    const botResponse = await fetch(`${DISCORD_BOT_API_URL}/submit-homework`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.BOT_API_SECRET}`
      },
      body: JSON.stringify({
        productName: order.productName,
        username: order.username,
        password: order.password,
        loginType: order.loginType || 'Google',
        school: order.school,
        skipQueue: true // ⚡ THIS IS THE KEY - SKIP ALL QUEUE WAIT TIMES
      })
    });
    
    console.log(`📥 SKIP QUEUE: Bot API response status: ${botResponse.status}`);
    const botResult = await botResponse.json();
    console.log(`📥 SKIP QUEUE: Bot API response:`, botResult);
    
    if (botResult.success) {
      console.log(`✅ SKIP QUEUE: Bot successfully triggered IMMEDIATELY for ${order.productName}!`);
      
      // Show success page
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>Queue Skipped! - hwplug</title>
          <style>
            body { font-family: Arial, sans-serif; background: #f6f7fb; padding: 50px; text-align: center; }
            .container { background: white; padding: 40px; border-radius: 12px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
            h1 { color: #28a745; }
            .emoji { font-size: 80px; margin: 20px 0; }
            .warning { background: #fff3cd; padding: 15px; border-radius: 8px; margin-top: 20px; color: #856404; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="emoji">⚡</div>
            <h1>Queue Skipped!</h1>
            <p style="font-size: 18px; color: #28a745; font-weight: 600;">Bot is processing your homework immediately!</p>
            <p style="color: #666;">The bot has started working on your homework right away, bypassing all queue wait times.</p>
            <div class="warning">
              <p style="margin: 0; font-weight: 600;">📱 Check your Discord DM for progress updates!</p>
            </div>
          </div>
        </body>
        </html>
      `);
    } else {
      console.error(`❌ SKIP QUEUE: Bot trigger failed: ${botResult.error}`);
      
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>Error - hwplug</title>
          <style>
            body { font-family: Arial, sans-serif; background: #f6f7fb; padding: 50px; text-align: center; }
            .container { background: white; padding: 40px; border-radius: 12px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
            h1 { color: #d9534f; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>❌ Bot Error</h1>
            <p>${botResult.error || 'Unknown error'}</p>
            <p style="color: #666; margin-top: 20px;">Please contact support if this persists.</p>
          </div>
        </body>
        </html>
      `);
    }
  } catch (error) {
    console.error(`❌ SKIP QUEUE: Error calling bot:`, error);
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Error - hwplug</title>
        <style>
          body { font-family: Arial, sans-serif; background: #f6f7fb; padding: 50px; text-align: center; }
          .container { background: white; padding: 40px; border-radius: 12px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
          h1 { color: #d9534f; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>❌ Error</h1>
          <p>Failed to connect to bot API</p>
          <p style="color: #666; margin-top: 20px;">Error: ${error.message}</p>
        </div>
      </body>
      </html>
    `);
  }
});

// Email Button Endpoint: Skip Queue & Use Sen AI (clicked from email)
app.get('/process-order-skip-queue-senai', async (req, res) => {
  const { orderId } = req.query;
  
  console.log(`⚡ EMAIL BUTTON: Skip Queue + Sen AI clicked - Order ID: ${orderId}`);
  
  if (!orderId) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Error - hwplug</title>
        <style>
          body { font-family: Arial, sans-serif; background: #f6f7fb; padding: 50px; text-align: center; }
          .container { background: white; padding: 40px; border-radius: 12px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
          h1 { color: #d9534f; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>❌ Error</h1>
          <p>Missing order ID</p>
        </div>
      </body>
      </html>
    `);
  }
  
  // Check if order exists
  if (!pendingOrders[orderId]) {
    return res.status(404).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Order Not Found - hwplug</title>
        <style>
          body { font-family: Arial, sans-serif; background: #f6f7fb; padding: 50px; text-align: center; }
          .container { background: white; padding: 40px; border-radius: 12px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
          h1 { color: #d9534f; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>⚠️ Order Not Found</h1>
          <p>This order has already been processed or doesn't exist.</p>
        </div>
      </body>
      </html>
    `);
  }
  
  const order = pendingOrders[orderId];
  
  // Mark as processed
  pendingOrders[orderId].processed = true;
  pendingOrders[orderId].processedAt = new Date().toISOString();
  pendingOrders[orderId].processedBy = 'senai-skip-queue';
  
  console.log(`⚡ SKIP QUEUE: Triggering Sen AI IMMEDIATELY for order: ${orderId}`);
  console.log(`   Product: ${order.productName}`);
  console.log(`   Username: ${order.username}`);
  
  // Trigger Sen AI bot with skipQueue flag
  try {
    console.log(`📡 SKIP QUEUE: Calling Sen AI API: ${DISCORD_BOT_API_URL}/submit-senai`);
    const botResponse = await fetch(`${DISCORD_BOT_API_URL}/submit-senai`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.BOT_API_SECRET}`
      },
      body: JSON.stringify({
        productName: order.productName,
        username: order.username,
        password: order.password,
        loginType: order.loginType || 'Normal',
        school: order.school,
        skipQueue: true // ⚡ BYPASS COOLDOWN
      })
    });
    
    console.log(`📥 SKIP QUEUE: Sen AI API response status: ${botResponse.status}`);
    const botResult = await botResponse.json();
    console.log(`📥 SKIP QUEUE: Sen AI API response:`, botResult);
    
    if (botResult.success) {
      console.log(`✅ SKIP QUEUE: Sen AI successfully triggered IMMEDIATELY!`);
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>Queue Skipped - Sen AI Started! - hwplug</title>
          <style>
            body { font-family: Arial, sans-serif; background: #f6f7fb; padding: 50px; text-align: center; }
            .container { background: white; padding: 40px; border-radius: 12px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
            h1 { color: #ff9800; }
            .info { background: #e0f7fa; padding: 15px; border-radius: 8px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>⚡ Queue Skipped!</h1>
            <div style="font-size: 64px; margin: 20px 0;">🧠</div>
            <p><strong>Sen AI is doing the homework IMMEDIATELY!</strong></p>
            <p style="background: #fff3cd; padding: 15px; border-radius: 8px; color: #856404; margin: 20px 0;">
              ⚡ Cooldown bypassed - Processing without delay
            </p>
            <div class="info">
              <p><strong>Product:</strong> ${order.productName}</p>
              <p><strong>Username:</strong> ${order.username}</p>
              <p><strong>School:</strong> ${order.school || 'N/A'}</p>
            </div>
            <p style="color: #666; font-size: 14px; margin-top: 20px;">You can close this page now.</p>
          </div>
        </body>
        </html>
      `);
    } else {
      console.error(`❌ SKIP QUEUE: Sen AI trigger failed: ${botResult.error}`);
      res.status(500).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>Sen AI Error - hwplug</title>
          <style>
            body { font-family: Arial, sans-serif; background: #f6f7fb; padding: 50px; text-align: center; }
            .container { background: white; padding: 40px; border-radius: 12px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
            h1 { color: #d9534f; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>❌ Sen AI Error</h1>
            <p>${botResult.error || 'Failed to trigger Sen AI'}</p>
            <p style="color: #666; font-size: 14px; margin-top: 20px;">Please try again or contact support.</p>
          </div>
        </body>
        </html>
      `);
    }
  } catch (error) {
    console.error(`❌ SKIP QUEUE: Error calling Sen AI:`, error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Connection Error - hwplug</title>
        <style>
          body { font-family: Arial, sans-serif; background: #f6f7fb; padding: 50px; text-align: center; }
          .container { background: white; padding: 40px; border-radius: 12px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
          h1 { color: #d9534f; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>❌ Connection Error</h1>
          <p>Could not connect to Sen AI server.</p>
          <p style="color: #666; font-size: 14px; margin-top: 20px;">Error: ${error.message}</p>
        </div>
      </body>
      </html>
    `);
  }
});

// Email Button Endpoint: Sen AI (clicked from email)
app.get('/process-order-senai', async (req, res) => {
  const { orderId } = req.query;
  
  console.log(`🧠 EMAIL BUTTON: Sen AI clicked - Order ID: ${orderId}`);
  
  if (!orderId) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Error - hwplug</title>
        <style>
          body { font-family: Arial, sans-serif; background: #f6f7fb; padding: 50px; text-align: center; }
          .container { background: white; padding: 40px; border-radius: 12px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
          h1 { color: #d9534f; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>❌ Error</h1>
          <p>Missing order ID</p>
        </div>
      </body>
      </html>
    `);
  }
  
  // Check if order exists
  if (!pendingOrders[orderId]) {
    return res.status(404).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Order Not Found - hwplug</title>
        <style>
          body { font-family: Arial, sans-serif; background: #f6f7fb; padding: 50px; text-align: center; }
          .container { background: white; padding: 40px; border-radius: 12px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
          h1 { color: #d9534f; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>⚠️ Order Not Found</h1>
          <p>This order has already been processed or doesn't exist.</p>
        </div>
      </body>
      </html>
    `);
  }
  
  // Check if already processed
  if (pendingOrders[orderId].processed) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Already Processed - hwplug</title>
        <style>
          body { font-family: Arial, sans-serif; background: #f6f7fb; padding: 50px; text-align: center; }
          .container { background: white; padding: 40px; border-radius: 12px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
          h1 { color: #ffc107; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>⚠️ Already Processed</h1>
          <p>This order has already been handled.</p>
        </div>
      </body>
      </html>
    `);
  }
  
  const order = pendingOrders[orderId];

  // Mark as processed
  pendingOrders[orderId].processed = true;
  pendingOrders[orderId].processedAt = new Date().toISOString();
  pendingOrders[orderId].processedBy = 'senai';
  
  console.log(`🧠 EMAIL BUTTON: Sending Sen AI order to AWS bot: ${orderId}`);
  console.log(`   Product: ${order.productName}`);
  console.log(`   Username: ${order.username}`);
  console.log(`   School: ${order.school}`);

  // Add to AWS queue
  try {
    const botApiUrl = process.env.DISCORD_BOT_API_URL || 'http://35.178.204.9:3001';
    console.log(`📡 Sen AI: Adding to AWS queue: ${botApiUrl}/add-to-queue`);
    
    const botResponse = await fetch(`${botApiUrl}/add-to-queue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.BOT_API_SECRET}`
      },
      body: JSON.stringify({
        orderId: orderId,
        productName: order.productName,
        username: order.username,
        password: order.password,
        loginType: order.loginType || 'Normal',
        school: order.school
      })
    });

    const botResult = await botResponse.json();
    
    if (!botResponse.ok || !botResult.success) {
      throw new Error(botResult.error || botResult.message || 'Bot API returned error');
    }

    console.log(`✅ Sen AI: Successfully added to AWS queue (Position #${botResult.position}, Wait: ${botResult.estimatedWaitMinutes}min)`);
    
    // Send success response with queue position
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>Added to SenAI Queue - hwplug</title>
          <style>
            body { font-family: Arial, sans-serif; background: #f6f7fb; padding: 50px; text-align: center; }
            .container { background: white; padding: 40px; border-radius: 12px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
            h1 { color: #00bcd4; }
            .info { background: #e0f7fa; padding: 15px; border-radius: 8px; margin: 20px 0; }
            .queue-box { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 12px; margin: 20px 0; }
            .queue-number { font-size: 48px; font-weight: 900; margin: 10px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✅ Added to SenAI Queue!</h1>
            <div style="font-size: 64px; margin: 20px 0;">🧠</div>
            
            <div class="queue-box">
              <p style="margin: 0; font-size: 16px; opacity: 0.9;">Queue Position</p>
              <div class="queue-number">#${botResult.position}</div>
              <p style="margin: 10px 0 0 0; font-size: 18px; opacity: 0.9;">Estimated wait: ~${botResult.estimatedWaitMinutes} min</p>
            </div>
            
            <div class="info">
              <p><strong>Product:</strong> ${order.productName}</p>
              <p><strong>Username:</strong> ${order.username}</p>
              <p><strong>School:</strong> ${order.school || 'N/A'}</p>
            </div>
            
            <p style="background: #fff3cd; padding: 15px; border-radius: 8px; color: #856404; margin-top: 20px;">
              <strong>📊 Sequential Queue:</strong> The bot will automatically start your homework when it's your turn!
            </p>
            
            <p style="color: #666; font-size: 14px; margin-top: 20px;">You can close this page now. The bot will process your order automatically.</p>
          </div>
        </body>
        </html>
      `);
  } catch (error) {
    console.error(`❌ Sen AI: Error sending to AWS bot:`, error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Connection Error - hwplug</title>
        <style>
          body { font-family: Arial, sans-serif; background: #f6f7fb; padding: 50px; text-align: center; }
          .container { background: white; padding: 40px; border-radius: 12px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
          h1 { color: #d9534f; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>❌ Connection Error</h1>
          <p>Could not connect to Sen AI bot on AWS.</p>
          <p style="color: #666; font-size: 14px; margin-top: 20px;">Error: ${error.message}</p>
        </div>
      </body>
      </html>
    `);
  }
});

// Email Button Endpoint: I'll Do It (clicked from email)
app.get('/process-order-manual', (req, res) => {
  const { orderId } = req.query;
  
  console.log(`👤 EMAIL BUTTON: I'll Do It clicked - Order ID: ${orderId}`);
  
  if (!orderId) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Error - hwplug</title>
        <style>
          body { font-family: Arial, sans-serif; background: #f6f7fb; padding: 50px; text-align: center; }
          .container { background: white; padding: 40px; border-radius: 12px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
          h1 { color: #d9534f; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>❌ Error</h1>
          <p>Missing order ID</p>
        </div>
      </body>
      </html>
    `);
  }
  
  // Check if order exists
  if (!pendingOrders[orderId]) {
    return res.status(404).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Order Not Found - hwplug</title>
        <style>
          body { font-family: Arial, sans-serif; background: #f6f7fb; padding: 50px; text-align: center; }
          .container { background: white; padding: 40px; border-radius: 12px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
          h1 { color: #d9534f; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>⚠️ Order Not Found</h1>
          <p>This order has already been processed or doesn't exist.</p>
        </div>
      </body>
      </html>
    `);
  }
  
  // Check if already processed
  if (pendingOrders[orderId].processed) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Already Processed - hwplug</title>
        <style>
          body { font-family: Arial, sans-serif; background: #f6f7fb; padding: 50px; text-align: center; }
          .container { background: white; padding: 40px; border-radius: 12px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
          h1 { color: #ffc107; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>⚠️ Already Processed</h1>
          <p>This order has already been handled.</p>
        </div>
      </body>
      </html>
    `);
  }
  
  const order = pendingOrders[orderId];
  
  // Mark as processed manually
  pendingOrders[orderId].processed = true;
  pendingOrders[orderId].processedAt = new Date().toISOString();
  pendingOrders[orderId].processedBy = 'manual';
  
  console.log(`👤 EMAIL BUTTON: Order marked as manual: ${orderId}`);
  console.log(`   Product: ${order.productName}`);
  console.log(`   Username: ${order.username}`);
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Manual Processing - hwplug</title>
      <style>
        body { font-family: Arial, sans-serif; background: #f6f7fb; padding: 50px; text-align: center; }
        .container { background: white; padding: 40px; border-radius: 12px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
        h1 { color: #6C63FF; }
        .info { background: #f8f9ff; padding: 15px; border-radius: 8px; margin: 20px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>✅ Marked as Manual</h1>
        <div style="font-size: 64px; margin: 20px 0;">👤</div>
        <p><strong>You'll do this homework manually.</strong></p>
        <div class="info">
          <p><strong>Product:</strong> ${order.productName}</p>
          <p><strong>Username:</strong> ${order.username}</p>
          <p><strong>Password:</strong> ${order.password}</p>
          <p><strong>School:</strong> ${order.school}</p>
        </div>
        <p style="color: #666; font-size: 14px; margin-top: 20px;">You can close this page now.</p>
      </div>
    </body>
    </html>
  `);
});

// Email Button Endpoint: REDO - Reprocess homework (clicked from email)
app.get('/redo-order', async (req, res) => {
  const { orderId } = req.query;
  
  console.log(`🔄 EMAIL BUTTON: REDO clicked - Order ID: ${orderId}`);
  
  if (!orderId) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Error - hwplug</title>
        <style>
          body { font-family: Arial, sans-serif; background: #f6f7fb; padding: 50px; text-align: center; }
          .container { background: white; padding: 40px; border-radius: 12px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
          h1 { color: #d9534f; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>❌ Error</h1>
          <p>Missing order ID</p>
        </div>
      </body>
      </html>
    `);
  }
  
  // Check if order exists
  if (!pendingOrders[orderId]) {
    return res.status(404).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Order Not Found - hwplug</title>
        <style>
          body { font-family: Arial, sans-serif; background: #f6f7fb; padding: 50px; text-align: center; }
          .container { background: white; padding: 40px; border-radius: 12px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
          h1 { color: #d9534f; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>⚠️ Order Not Found</h1>
          <p>This order doesn't exist or is too old.</p>
        </div>
      </body>
      </html>
    `);
  }
  
  const order = pendingOrders[orderId];
  
  // Reset processed status to allow reprocessing
  pendingOrders[orderId].processed = false;
  pendingOrders[orderId].redoCount = (pendingOrders[orderId].redoCount || 0) + 1;
  pendingOrders[orderId].lastRedoAt = new Date().toISOString();
  
  console.log(`🔄 EMAIL BUTTON: REDO - Reprocessing order: ${orderId} (Redo #${pendingOrders[orderId].redoCount})`);
  console.log(`   Product: ${order.productName}`);
  console.log(`   Username: ${order.username}`);
  
  // Trigger SenAI bot with skipQueue flag (skip queue for redo attempts)
  try {
    console.log(`📡 REDO: Calling SenAI bot API: ${DISCORD_BOT_API_URL}/submit-senai`);
    const botResponse = await fetch(`${DISCORD_BOT_API_URL}/submit-senai`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.BOT_API_SECRET}`
      },
      body: JSON.stringify({
        productName: order.productName,
        username: order.username,
        password: order.password,
        loginType: order.loginType || 'Normal',
        school: order.school,
        skipQueue: true // Skip queue for redo attempts
      })
    });
    
    console.log(`📥 REDO: Bot API response status: ${botResponse.status}`);
    const botResult = await botResponse.json();
    console.log(`📥 REDO: Bot API response:`, botResult);
    
    if (botResult.success) {
      console.log(`✅ REDO: SenAI bot successfully triggered for ${order.productName}!`);
      
      // Show success page
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>Homework Resubmitted! - hwplug</title>
          <style>
            body { font-family: Arial, sans-serif; background: #f6f7fb; padding: 50px; text-align: center; }
            .container { background: white; padding: 40px; border-radius: 12px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
            h1 { color: #28a745; }
            .emoji { font-size: 80px; margin: 20px 0; }
            .warning { background: #fff3cd; padding: 15px; border-radius: 8px; margin-top: 20px; color: #856404; }
            .info { background: #f8f9ff; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: left; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="emoji">🔄</div>
            <h1>Homework Resubmitted!</h1>
            <p style="font-size: 18px; color: #28a745; font-weight: 600;">🧠 SenAI bot is reprocessing your homework now!</p>
            <div class="info">
              <p style="margin: 5px 0;"><strong>Product:</strong> ${order.productName}</p>
              <p style="margin: 5px 0;"><strong>Username:</strong> ${order.username}</p>
              <p style="margin: 5px 0;"><strong>Redo Attempt:</strong> #${pendingOrders[orderId].redoCount}</p>
            </div>
            <p style="color: #666;">⚡ SenAI bot has started working on your homework again, bypassing queue wait times.</p>
            <div class="warning">
              <p style="margin: 0; font-weight: 600;">📱 Check your Discord DM for progress updates!</p>
            </div>
          </div>
        </body>
        </html>
      `);
    } else {
      console.error(`❌ REDO: Bot trigger failed: ${botResult.error}`);
      
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>Error - hwplug</title>
          <style>
            body { font-family: Arial, sans-serif; background: #f6f7fb; padding: 50px; text-align: center; }
            .container { background: white; padding: 40px; border-radius: 12px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
            h1 { color: #d9534f; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>❌ Error</h1>
            <p style="color: #666;">${botResult.error || 'Failed to trigger bot'}</p>
            <p style="font-size: 14px; color: #999; margin-top: 20px;">Please contact support if this persists.</p>
          </div>
        </body>
        </html>
      `);
    }
  } catch (error) {
    console.error(`❌ REDO: Error calling bot API:`, error.message);
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Error - hwplug</title>
        <style>
          body { font-family: Arial, sans-serif; background: #f6f7fb; padding: 50px; text-align: center; }
          .container { background: white; padding: 40px; border-radius: 12px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
          h1 { color: #d9534f; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>❌ Connection Error</h1>
          <p style="color: #666;">Failed to connect to bot. Please try again later.</p>
          <p style="font-size: 14px; color: #999; margin-top: 20px;">Error: ${error.message}</p>
        </div>
      </body>
      </html>
    `);
  }
});

// Endpoint: Trigger bot to do homework (clicked from email)
app.post('/trigger-bot', async (req, res) => {
  const { orderId, productName, username, password, loginType, school } = req.body;
  
  if (!orderId || !productName || !username || !password) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }
  
  console.log(`🤖 MANUAL TRIGGER: Admin chose "Bot Does It" for order ${orderId}`);
  console.log(`   Product: ${productName}, Username: ${username}, LoginType: ${loginType || 'Google'}`);
  
  // Check if order already processed
  if (pendingOrders[orderId]?.processed) {
    return res.json({ 
      success: false, 
      message: 'Order already processed',
      alreadyProcessed: true 
    });
  }
  
  // Submit to Discord bot
  try {
    console.log(`📡 TRIGGER: Calling bot API: ${DISCORD_BOT_API_URL}/submit-homework`);
    const botResponse = await fetch(`${DISCORD_BOT_API_URL}/submit-homework`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.BOT_API_SECRET}`
      },
      body: JSON.stringify({
        productName: productName,
        username: username,
        password: password,
        loginType: loginType || 'Google', // Default to Google for backwards compatibility
        school: school || 'Not provided'
      })
    });
    
    const botResult = await botResponse.json();
    
    if (botResult.success) {
      console.log(`✅ Bot submission successful for order ${orderId}!`);
      
      // Mark as processed
      if (pendingOrders[orderId]) {
        pendingOrders[orderId].processed = true;
        pendingOrders[orderId].method = 'bot';
        pendingOrders[orderId].processedAt = new Date().toISOString();
      }
      
      res.json({ 
        success: true, 
        message: 'Bot is now processing the homework!',
        remainingSlots: botResult.remainingSlots 
      });
    } else {
      console.error(`❌ Bot submission failed: ${botResult.error}`);
      res.json({ success: false, error: botResult.error });
    }
  } catch (error) {
    console.error(`❌ Error calling Discord bot:`, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint: Mark order as "I'll do it manually" (clicked from email)
app.post('/manual-process', async (req, res) => {
  const { orderId, productName, username } = req.body;
  
  if (!orderId) {
    return res.status(400).json({ success: false, error: 'Missing orderId' });
  }
  
  console.log(`👤 MANUAL TRIGGER: Admin chose "I'll Do It" for order ${orderId}`);
  console.log(`   Product: ${productName}, Username: ${username}`);
  
  // Check if order already processed
  if (pendingOrders[orderId]?.processed) {
    return res.json({ 
      success: false, 
      message: 'Order already processed',
      alreadyProcessed: true 
    });
  }
  
  // Mark as manual processing
  if (pendingOrders[orderId]) {
    pendingOrders[orderId].processed = true;
    pendingOrders[orderId].method = 'manual';
    pendingOrders[orderId].processedAt = new Date().toISOString();
  } else {
    pendingOrders[orderId] = {
      processed: true,
      method: 'manual',
      processedAt: new Date().toISOString()
    };
  }
  
  res.json({ 
    success: true, 
    message: 'Marked as manual processing. You can now do it yourself!' 
  });
});

// HTML pages for email button clicks
app.get('/trigger-bot-page', async (req, res) => {
  const { orderId, productName, username, password, school } = req.query;
  
  // Call the bot trigger endpoint
  try {
    const response = await fetch(`${process.env.BACKEND_URL || 'http://localhost:10000'}/trigger-bot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, productName, username, password, school })
    });
    
    const result = await response.json();
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Bot Triggered - hwplug</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: Arial, sans-serif; background: linear-gradient(135deg, #6C63FF 0%, #5548d9 100%); margin: 0; padding: 40px; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
          .card { background: #fff; padding: 40px; border-radius: 16px; box-shadow: 0 8px 32px rgba(0,0,0,0.2); max-width: 500px; text-align: center; }
          .success { color: #28a745; font-size: 48px; margin-bottom: 20px; }
          .error { color: #d9534f; font-size: 48px; margin-bottom: 20px; }
          h1 { color: #333; margin: 0 0 15px 0; }
          p { color: #666; font-size: 16px; line-height: 1.6; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="${result.success ? 'success' : 'error'}">${result.success ? '✅' : '❌'}</div>
          <h1>${result.success ? 'Bot Activated!' : 'Error'}</h1>
          <p>${result.success ? `The Discord bot is now processing the homework for ${productName}!` : result.error || 'Failed to trigger bot'}</p>
          ${result.alreadyProcessed ? '<p style="color: #856404; background: #fff3cd; padding: 15px; border-radius: 8px; margin-top: 15px;">⚠️ This order was already processed.</p>' : ''}
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Error - hwplug</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: Arial, sans-serif; background: linear-gradient(135deg, #d32f2f 0%, #c62828 100%); margin: 0; padding: 40px; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
          .card { background: #fff; padding: 40px; border-radius: 16px; box-shadow: 0 8px 32px rgba(0,0,0,0.2); max-width: 500px; text-align: center; }
          .error { color: #d9534f; font-size: 48px; margin-bottom: 20px; }
          h1 { color: #333; margin: 0 0 15px 0; }
          p { color: #666; font-size: 16px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="error">❌</div>
          <h1>Connection Error</h1>
          <p>${error.message}</p>
        </div>
      </body>
      </html>
    `);
  }
});

app.get('/manual-process-page', async (req, res) => {
  const { orderId, productName, username } = req.query;
  
  // Call the manual process endpoint
  try {
    const response = await fetch(`${process.env.BACKEND_URL || 'http://localhost:10000'}/manual-process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, productName, username })
    });
    
    const result = await response.json();
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Manual Processing - hwplug</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: Arial, sans-serif; background: linear-gradient(135deg, #6C63FF 0%, #5548d9 100%); margin: 0; padding: 40px; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
          .card { background: #fff; padding: 40px; border-radius: 16px; box-shadow: 0 8px 32px rgba(0,0,0,0.2); max-width: 500px; text-align: center; }
          .success { color: #6C63FF; font-size: 48px; margin-bottom: 20px; }
          h1 { color: #333; margin: 0 0 15px 0; }
          p { color: #666; font-size: 16px; line-height: 1.6; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="success">👤</div>
          <h1>Marked as Manual</h1>
          <p>${result.success ? `Order for ${productName} is now marked for manual processing. You can do it yourself!` : result.error || 'Failed to mark as manual'}</p>
          ${result.alreadyProcessed ? '<p style="color: #856404; background: #fff3cd; padding: 15px; border-radius: 8px; margin-top: 15px;">⚠️ This order was already processed.</p>' : ''}
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Error - hwplug</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: Arial, sans-serif; background: linear-gradient(135deg, #d32f2f 0%, #c62828 100%); margin: 0; padding: 40px; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
          .card { background: #fff; padding: 40px; border-radius: 16px; box-shadow: 0 8px 32px rgba(0,0,0,0.2); max-width: 500px; text-align: center; }
          .error { color: #d9534f; font-size: 48px; margin-bottom: 20px; }
          h1 { color: #333; margin: 0 0 15px 0; }
          p { color: #666; font-size: 16px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="error">❌</div>
          <h1>Connection Error</h1>
          <p>${error.message}</p>
        </div>
      </body>
      </html>
    `);
  }
});

// ========== GIVEAWAY API ENDPOINTS ==========

// Get giveaway status
app.get('/api/giveaway/status', async (req, res) => {
  try {
    if (!mongoConnected) {
      // Use in-memory storage
      const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      const isSpinDay = inMemoryGiveaway.spinDate && today.includes(inMemoryGiveaway.spinDate.split(',')[1]?.trim());
      
      return res.json({
        active: inMemoryGiveaway.active,
        wheelVisible: inMemoryGiveaway.wheelVisible,
        spinDate: inMemoryGiveaway.spinDate,
        minParticipants: inMemoryGiveaway.minParticipants || 15,
        maxParticipants: inMemoryGiveaway.maxParticipants || 30,
        isSpinDay: isSpinDay,
        entryCount: inMemoryGiveaway.entries.length,
        hasWinner: !!(inMemoryGiveaway.winner && inMemoryGiveaway.winner.firstName),
        winner: inMemoryGiveaway.winner || null
      });
    }
    
    let giveaway = await GiveawayModel.findOne().sort({ createdAt: -1 });
    
    if (!giveaway) {
      return res.json({ active: false, wheelVisible: false });
    }
    
    // Check if today is spin day
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const isSpinDay = giveaway.spinDate && today.includes(giveaway.spinDate.split(',')[1]?.trim());
    
    res.json({
      active: giveaway.active,
      wheelVisible: giveaway.wheelVisible || false,
      spinDate: giveaway.spinDate,
      minParticipants: giveaway.minParticipants || 15,
      maxParticipants: giveaway.maxParticipants || 30,
      isSpinDay: isSpinDay,
      entryCount: giveaway.entries.length,
      hasWinner: !!(giveaway.winner && giveaway.winner.firstName),
      winner: giveaway.winner || null
    });
  } catch (error) {
    console.error('Error getting giveaway status:', error);
    res.status(500).json({ error: 'Failed to get giveaway status' });
  }
});

// Check if user already entered
app.get('/api/giveaway/check-entry', async (req, res) => {
  try {
    const { email } = req.query;
    const giveaway = await GiveawayModel.findOne().sort({ createdAt: -1 });
    
    if (!giveaway) {
      return res.json({ entered: false });
    }
    
    const entry = giveaway.entries.find(e => e.email === email);
    
    if (entry) {
      res.json({
        entered: true,
        firstName: entry.firstName,
        lastName: entry.lastName,
        snapchat: entry.snapchat
      });
    } else {
      res.json({ entered: false });
    }
  } catch (error) {
    console.error('Error checking entry:', error);
    res.status(500).json({ error: 'Failed to check entry' });
  }
});

// Password verification endpoint for PDF page
app.post('/api/verify-password', async (req, res) => {
  try {
    const { password } = req.body;
    const correctPassword = process.env.PDF_PASSWORD || 'hwplug2025';
    
    if (password === correctPassword) {
      return res.json({ success: true });
    } else {
      return res.json({ success: false });
    }
  } catch (error) {
    console.error('Error verifying password:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Submit giveaway entry
app.post('/api/giveaway/enter', async (req, res) => {
  try {
    const { firstName, lastName, email } = req.body;
    
    if (!firstName || !lastName || !email) {
      return res.json({ success: false, message: 'All fields are required' });
    }
    
    if (!mongoConnected) {
      // Use in-memory storage
      const alreadyEntered = inMemoryGiveaway.entries.find(e => e.email === email);
      if (alreadyEntered) {
        return res.json({ success: false, message: 'You have already entered!' });
      }
      
      // Check max entries (configurable max)
      const maxEntries = inMemoryGiveaway.maxParticipants || 30;
      if (inMemoryGiveaway.entries.length >= maxEntries) {
        return res.json({ success: false, message: `Giveaway is full! Maximum ${maxEntries} entries reached.` });
      }
      
      inMemoryGiveaway.entries.push({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        enteredAt: new Date()
      });
      
      console.log(`🎁 New entry: ${firstName} ${lastName} (in-memory)`);
      
      // Broadcast to wheel viewers
      const eliminatedNames = inMemoryGiveaway.eliminated || [];
      const participants = inMemoryGiveaway.entries.filter(entry => {
        const fullName = `${entry.firstName} ${entry.lastName}`;
        return !eliminatedNames.includes(fullName);
      });
      
      broadcastToWheelClients({
        type: 'update',
        participants: participants.map(p => ({
          firstName: p.firstName,
          lastName: p.lastName
        })),
        eliminated: eliminatedNames
      });
      
      return res.json({ success: true, message: 'Entry submitted successfully!' });
    }
    
    let giveaway = await GiveawayModel.findOne().sort({ createdAt: -1 });
    
    if (!giveaway || !giveaway.active) {
      return res.json({ success: false, message: 'Giveaway is not active' });
    }
    
    // Check if user already entered
    const alreadyEntered = giveaway.entries.find(e => e.email === email);
    if (alreadyEntered) {
      return res.json({ success: false, message: 'You have already entered!' });
    }
    
    // Check max entries (configurable max)
    const maxEntries = giveaway.maxParticipants || 30;
    if (giveaway.entries.length >= maxEntries) {
      return res.json({ success: false, message: `Giveaway is full! Maximum ${maxEntries} entries reached.` });
    }
    
    // Add entry
    giveaway.entries.push({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      enteredAt: new Date()
    });
    
    giveaway.updatedAt = new Date();
    await giveaway.save();
    
    // Broadcast new entry to all connected wheel viewers (LIVE UPDATE!)
    const eliminatedNames = giveaway.eliminated || [];
    const participants = giveaway.entries.filter(entry => {
      const fullName = `${entry.firstName} ${entry.lastName}`;
      return !eliminatedNames.includes(fullName);
    });
    
    broadcastToWheelClients({
      type: 'update',
      participants: participants.map(p => ({
        firstName: p.firstName,
        lastName: p.lastName
      })),
      eliminated: eliminatedNames
    });
    
    console.log(`🎁 New entry: ${firstName} ${lastName} - Broadcasting to ${wheelClients.length} viewers`);
    
    // Send email notification to admin
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: 'hwplug <noreply@hwplug.store>',
        to: process.env.YOUR_EMAIL,
        subject: `🎁 New Giveaway Entry: ${firstName} ${lastName}`,
        html: `
          <h2>New Giveaway Entry!</h2>
          <p><strong>Name:</strong> ${firstName} ${lastName}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
          <hr>
          <p><strong>Total Entries:</strong> ${giveaway.entries.length}</p>
        `
      });
    } catch (emailError) {
      console.error('Error sending entry notification email:', emailError);
    }
    
    res.json({ success: true, message: 'Entry submitted successfully!' });
  } catch (error) {
    console.error('Error submitting entry:', error);
    res.status(500).json({ success: false, message: 'Failed to submit entry' });
  }
});

// Get participants for wheel
app.get('/api/giveaway/participants', async (req, res) => {
  try {
    const giveaway = await GiveawayModel.findOne().sort({ createdAt: -1 });
    
    if (!giveaway) {
      return res.json({ participants: [], eliminated: [] });
    }
    
    // Get non-eliminated participants
    const eliminatedNames = giveaway.eliminated || [];
    const participants = giveaway.entries.filter(entry => {
      const fullName = `${entry.firstName} ${entry.lastName}`;
      return !eliminatedNames.includes(fullName);
    });
    
    res.json({
      participants: participants.map(p => ({
        firstName: p.firstName,
        lastName: p.lastName,
        snapchat: p.snapchat
      })),
      eliminated: eliminatedNames
    });
  } catch (error) {
    console.error('Error getting participants:', error);
    res.status(500).json({ error: 'Failed to get participants' });
  }
});

// Admin: Spin the wheel (eliminate one person)
app.post('/api/giveaway/spin', async (req, res) => {
  try {
    const giveaway = await GiveawayModel.findOne().sort({ createdAt: -1 });
    
    if (!giveaway) {
      return res.json({ success: false, message: 'No active giveaway' });
    }
    
    // Get remaining participants
    const eliminatedNames = giveaway.eliminated || [];
    const remaining = giveaway.entries.filter(entry => {
      const fullName = `${entry.firstName} ${entry.lastName}`;
      return !eliminatedNames.includes(fullName);
    });
    
    if (remaining.length === 0) {
      return res.json({ success: false, message: 'No participants left' });
    }
    
    // Check minimum participants (dynamic minimum)
    const minRequired = giveaway.minParticipants || 15;
    if (remaining.length < minRequired && eliminatedNames.length === 0) {
      return res.json({ success: false, message: `Need at least ${minRequired} people to start! Currently: ${remaining.length}` });
    }
    
    // Removed: Don't auto-declare winner if only 1 person left
    // Let them be eliminated by the spin instead
    // Winner is only declared when going from 2 people to 1 person
    
    // Instead of calculating which person to eliminate and trying to land on them,
    // we'll: 1) Generate a random final rotation, 2) Detect which slice is under the pointer,
    // 3) Eliminate that person. This guarantees the wheel lands on the person we eliminate!
    
    const sliceAngle = 360 / remaining.length; // degrees per person
    
    // Generate a random final angle (where the wheel will stop)
    // This gives us a truly random result
    const randomFinalAngle = Math.random() * 360;
    
    // Add multiple full rotations for dramatic effect (5-8 full spins)
    const fullRotations = 5 + Math.floor(Math.random() * 4); // 5-8 spins
    const totalRotation = (fullRotations * 360) + randomFinalAngle;
    
    // Calculate which slice will be under the pointer (270°) after this rotation
    // When canvas is rotated by totalRotation, slices drawn at angle theta in rotated system
    // appear at angle (theta + totalRotation) in original system
    // Slice[i] center is drawn at: (i * sliceAngle + sliceAngle/2) in rotated system
    // So it appears at: ((i * sliceAngle + sliceAngle/2) + totalRotation) % 360 in original system
    // We want to find which i gives us 270° in original system
    const finalRotation = totalRotation % 360;
    let actualIndex = -1;
    let minDiff = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const sliceCenterInRotated = (i * sliceAngle) + (sliceAngle / 2);
      const sliceCenterInOriginal = (sliceCenterInRotated + finalRotation) % 360;
      
      // Calculate angular distance to 270° (pointer position)
      let diff = Math.abs(sliceCenterInOriginal - 270);
      if (diff > 180) diff = 360 - diff;
      
      if (diff < minDiff) {
        minDiff = diff;
        actualIndex = i;
      }
    }
    
    // Eliminate the person who will be under the pointer
    if (actualIndex < 0 || actualIndex >= remaining.length) {
      return res.json({ success: false, message: 'Error calculating elimination' });
    }
    
    const eliminated = remaining[actualIndex];
    const eliminatedName = `${eliminated.firstName} ${eliminated.lastName}`;
    
    // Add to eliminated list
    if (!giveaway.eliminated) {
      giveaway.eliminated = [];
    }
    giveaway.eliminated.push(eliminatedName);
    giveaway.updatedAt = new Date();
    
    // Check if this elimination results in a winner
    // Winner is declared when we go from 2 people to 1 person (not 1 to 0)
    const remainingAfterSpin = remaining.length - 1;
    const isWinner = remainingAfterSpin === 1;
    
    if (isWinner) {
      // Find the winner (the person who wasn't eliminated this round)
      const winner = remaining.find(p => `${p.firstName} ${p.lastName}` !== eliminatedName);
      giveaway.winner = {
        firstName: winner.firstName,
        lastName: winner.lastName
      };
    }
    
    await giveaway.save();
    
    // Broadcast spin to all connected clients with rotation info
    broadcastToWheelClients({
      type: 'spin',
      eliminatedName: eliminatedName,
      eliminatedIndex: actualIndex,
      totalParticipants: remaining.length,
      targetRotation: totalRotation, // degrees to rotate
      isWinner: isWinner,
      winner: isWinner ? giveaway.winner : null
    });
    
    res.json({
      success: true,
      eliminatedName: eliminatedName,
      eliminatedIndex: actualIndex,
      totalParticipants: remaining.length,
      targetRotation: totalRotation,
      remaining: remainingAfterSpin,
      isWinner: isWinner,
      winnerData: isWinner ? giveaway.winner : null
    });
  } catch (error) {
    console.error('Error spinning wheel:', error);
    res.status(500).json({ success: false, message: 'Failed to spin wheel' });
  }
});

// Admin: Get all giveaway entries
app.get('/api/giveaway/entries', async (req, res) => {
  try {
    if (!mongoConnected) {
      // Use in-memory storage
      return res.json({
        entries: inMemoryGiveaway.entries || [],
        eliminated: inMemoryGiveaway.eliminated || [],
        winner: inMemoryGiveaway.winner || null
      });
    }
    
    const giveaway = await GiveawayModel.findOne().sort({ createdAt: -1 });
    
    if (!giveaway) {
      return res.json({ entries: [] });
    }
    
    res.json({
      entries: giveaway.entries,
      eliminated: giveaway.eliminated || [],
      winner: giveaway.winner || null
    });
  } catch (error) {
    console.error('Error getting entries:', error);
    res.status(500).json({ error: 'Failed to get entries' });
  }
});

// Admin: Add entry manually (bypasses 30 limit)
app.post('/api/giveaway/add-entry', async (req, res) => {
  try {
    const { password, firstName, lastName } = req.body;
    
    // Verify admin password
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
    if (!ADMIN_PASSWORD) {
      return res.status(500).json({ success: false, error: 'Admin password not configured' });
    }
    if (password !== ADMIN_PASSWORD) {
      return res.json({ success: false, error: 'Invalid admin password' });
    }
    
    if (!firstName || !lastName) {
      return res.json({ success: false, message: 'First name and last name are required' });
    }
    
    if (!mongoConnected) {
      // Use in-memory storage
      const fullName = `${firstName.trim()} ${lastName.trim()}`;
      
      // Check if already exists (by name, not email)
      const alreadyExists = inMemoryGiveaway.entries.find(e => 
        `${e.firstName} ${e.lastName}` === fullName
      );
      if (alreadyExists) {
        return res.json({ success: false, message: 'This person has already entered!' });
      }
      
      inMemoryGiveaway.entries.push({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: `admin-added-${Date.now()}@manual.entry`, // Placeholder email for admin entries
        enteredAt: new Date()
      });
      
      console.log(`🎁 Admin added entry: ${fullName} (in-memory)`);
      
      // Broadcast to wheel viewers
      const eliminatedNames = inMemoryGiveaway.eliminated || [];
      const participants = inMemoryGiveaway.entries.filter(entry => {
        const entryFullName = `${entry.firstName} ${entry.lastName}`;
        return !eliminatedNames.includes(entryFullName);
      });
      
      broadcastToWheelClients({
        type: 'update',
        participants: participants.map(p => ({
          firstName: p.firstName,
          lastName: p.lastName
        })),
        eliminated: eliminatedNames
      });
      
      // Broadcast status change with updated entry count
      broadcastToWheelClients({
        type: 'giveaway_status_change',
        active: inMemoryGiveaway.active,
        spinDate: inMemoryGiveaway.spinDate,
        wheelVisible: inMemoryGiveaway.wheelVisible,
        entryCount: inMemoryGiveaway.entries.length,
        hasWinner: !!(inMemoryGiveaway.winner && inMemoryGiveaway.winner.firstName),
        winner: inMemoryGiveaway.winner
      });
      
      return res.json({ success: true, message: `Entry added: ${fullName}`, entryCount: inMemoryGiveaway.entries.length });
    }
    
    let giveaway = await GiveawayModel.findOne().sort({ createdAt: -1 });
    
    if (!giveaway) {
      giveaway = new GiveawayModel({
        active: false,
        entries: [],
        eliminated: []
      });
    }
    
    const fullName = `${firstName.trim()} ${lastName.trim()}`;
    
    // Check if already exists (by name, not email)
    const alreadyExists = giveaway.entries.find(e => 
      `${e.firstName} ${e.lastName}` === fullName
    );
    if (alreadyExists) {
      return res.json({ success: false, message: 'This person has already entered!' });
    }
    
    // Add entry (no limit for admin)
    giveaway.entries.push({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: `admin-added-${Date.now()}@manual.entry`, // Placeholder email for admin entries
      enteredAt: new Date()
    });
    
    giveaway.updatedAt = new Date();
    await giveaway.save();
    
    console.log(`🎁 Admin added entry: ${fullName}`);
    
    // Broadcast to wheel viewers
    const eliminatedNames = giveaway.eliminated || [];
    const participants = giveaway.entries.filter(entry => {
      const entryFullName = `${entry.firstName} ${entry.lastName}`;
      return !eliminatedNames.includes(entryFullName);
    });
    
    broadcastToWheelClients({
      type: 'update',
      participants: participants.map(p => ({
        firstName: p.firstName,
        lastName: p.lastName
      })),
      eliminated: eliminatedNames
    });
    
    // Broadcast status change with updated entry count
    broadcastToWheelClients({
      type: 'giveaway_status_change',
      active: giveaway.active,
      spinDate: giveaway.spinDate,
      wheelVisible: giveaway.wheelVisible || false,
      entryCount: giveaway.entries.length,
      hasWinner: !!(giveaway.winner && giveaway.winner.firstName),
      winner: giveaway.winner
    });
    
    res.json({ success: true, message: `Entry added: ${fullName}`, entryCount: giveaway.entries.length });
  } catch (error) {
    console.error('Error adding entry:', error);
    res.status(500).json({ success: false, error: 'Failed to add entry' });
  }
});

// Admin: Remove entry manually
app.post('/api/giveaway/remove-entry', async (req, res) => {
  try {
    const { password, firstName, lastName } = req.body;
    
    // Verify admin password
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
    if (!ADMIN_PASSWORD) {
      return res.status(500).json({ success: false, error: 'Admin password not configured' });
    }
    if (password !== ADMIN_PASSWORD) {
      return res.json({ success: false, error: 'Invalid admin password' });
    }
    
    if (!firstName || !lastName) {
      return res.json({ success: false, message: 'First name and last name are required' });
    }
    
    const fullName = `${firstName.trim()} ${lastName.trim()}`;
    
    if (!mongoConnected) {
      // Use in-memory storage
      const entryIndex = inMemoryGiveaway.entries.findIndex(e => 
        `${e.firstName} ${e.lastName}` === fullName
      );
      
      if (entryIndex === -1) {
        return res.json({ success: false, message: 'Entry not found' });
      }
      
      // Remove from entries
      inMemoryGiveaway.entries.splice(entryIndex, 1);
      
      // Remove from eliminated list if present
      const eliminatedIndex = inMemoryGiveaway.eliminated.indexOf(fullName);
      if (eliminatedIndex !== -1) {
        inMemoryGiveaway.eliminated.splice(eliminatedIndex, 1);
      }
      
      // Clear winner if this person was the winner
      if (inMemoryGiveaway.winner && 
          `${inMemoryGiveaway.winner.firstName} ${inMemoryGiveaway.winner.lastName}` === fullName) {
        inMemoryGiveaway.winner = null;
      }
      
      console.log(`🗑️ Admin removed entry: ${fullName} (in-memory)`);
      
      // Broadcast to wheel viewers
      const eliminatedNames = inMemoryGiveaway.eliminated || [];
      const participants = inMemoryGiveaway.entries.filter(entry => {
        const entryFullName = `${entry.firstName} ${entry.lastName}`;
        return !eliminatedNames.includes(entryFullName);
      });
      
      broadcastToWheelClients({
        type: 'update',
        participants: participants.map(p => ({
          firstName: p.firstName,
          lastName: p.lastName
        })),
        eliminated: eliminatedNames
      });
      
      // Broadcast status change with updated entry count
      broadcastToWheelClients({
        type: 'giveaway_status_change',
        active: inMemoryGiveaway.active,
        spinDate: inMemoryGiveaway.spinDate,
        wheelVisible: inMemoryGiveaway.wheelVisible,
        entryCount: inMemoryGiveaway.entries.length,
        hasWinner: !!(inMemoryGiveaway.winner && inMemoryGiveaway.winner.firstName),
        winner: inMemoryGiveaway.winner
      });
      
      return res.json({ success: true, message: `Entry removed: ${fullName}`, entryCount: inMemoryGiveaway.entries.length });
    }
    
    let giveaway = await GiveawayModel.findOne().sort({ createdAt: -1 });
    
    if (!giveaway) {
      return res.json({ success: false, message: 'No giveaway found' });
    }
    
    const entryIndex = giveaway.entries.findIndex(e => 
      `${e.firstName} ${e.lastName}` === fullName
    );
    
    if (entryIndex === -1) {
      return res.json({ success: false, message: 'Entry not found' });
    }
    
    // Remove from entries
    giveaway.entries.splice(entryIndex, 1);
    
    // Remove from eliminated list if present
    if (giveaway.eliminated && giveaway.eliminated.includes(fullName)) {
      giveaway.eliminated = giveaway.eliminated.filter(name => name !== fullName);
    }
    
    // Clear winner if this person was the winner
    if (giveaway.winner && 
        `${giveaway.winner.firstName} ${giveaway.winner.lastName}` === fullName) {
      giveaway.winner = null;
    }
    
    giveaway.updatedAt = new Date();
    await giveaway.save();
    
    console.log(`🗑️ Admin removed entry: ${fullName}`);
    
    // Broadcast to wheel viewers
    const eliminatedNames = giveaway.eliminated || [];
    const participants = giveaway.entries.filter(entry => {
      const entryFullName = `${entry.firstName} ${entry.lastName}`;
      return !eliminatedNames.includes(entryFullName);
    });
    
    broadcastToWheelClients({
      type: 'update',
      participants: participants.map(p => ({
        firstName: p.firstName,
        lastName: p.lastName
      })),
      eliminated: eliminatedNames
    });
    
    // Broadcast status change with updated entry count
    broadcastToWheelClients({
      type: 'giveaway_status_change',
      active: giveaway.active,
      spinDate: giveaway.spinDate,
      wheelVisible: giveaway.wheelVisible || false,
      entryCount: giveaway.entries.length,
      hasWinner: !!(giveaway.winner && giveaway.winner.firstName),
      winner: giveaway.winner
    });
    
    res.json({ success: true, message: `Entry removed: ${fullName}`, entryCount: giveaway.entries.length });
  } catch (error) {
    console.error('Error removing entry:', error);
    res.status(500).json({ success: false, error: 'Failed to remove entry' });
  }
});

// Admin: Toggle giveaway active status
// Set wheel visibility (show/hide to public)
app.post('/api/giveaway/set-wheel-visibility', async (req, res) => {
  try {
    const { visible } = req.body;
    
    if (!mongoConnected) {
      // Use in-memory storage
      inMemoryGiveaway.wheelVisible = visible;
      console.log(`🎡 Wheel visibility set to: ${visible ? 'VISIBLE' : 'HIDDEN'} (in-memory)`);
      
      // Broadcast to all connected clients
      broadcastToWheelClients({
        type: 'visibility',
        visible: visible
      });
      
      return res.json({ success: true, visible: inMemoryGiveaway.wheelVisible });
    }
    
    let giveaway = await GiveawayModel.findOne().sort({ createdAt: -1 });
    
    if (!giveaway) {
      giveaway = new GiveawayModel({
        active: false,
        wheelVisible: visible,
        spinDate: '',
        entries: [],
        eliminated: []
      });
    } else {
      giveaway.wheelVisible = visible;
    }
    
    await giveaway.save();
    console.log(`🎡 Wheel visibility set to: ${visible ? 'VISIBLE' : 'HIDDEN'}`);
    
    // Broadcast to all connected clients
    broadcastToWheelClients({
      type: 'visibility',
      visible: visible
    });
    
    res.json({ success: true, visible: giveaway.wheelVisible });
  } catch (error) {
    console.error('Error setting wheel visibility:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/giveaway/toggle', async (req, res) => {
  try {
    const { active } = req.body;
    
    if (!mongoConnected) {
      // Use in-memory storage
      inMemoryGiveaway.active = active;
      
      // If turning OFF, clear winner data
      if (!active) {
        inMemoryGiveaway.winner = null;
        console.log(`🎁 Giveaway DEACTIVATED - Winner cleared (in-memory)`);
      } else {
        console.log(`🎁 Giveaway ACTIVATED (in-memory)`);
      }
      
      // Broadcast status change to all clients
      broadcastToWheelClients({
        type: 'giveaway_status_change',
        active: active,
        spinDate: inMemoryGiveaway.spinDate,
        wheelVisible: inMemoryGiveaway.wheelVisible,
        entryCount: inMemoryGiveaway.entries.length,
        hasWinner: !!(inMemoryGiveaway.winner && inMemoryGiveaway.winner.firstName),
        winner: inMemoryGiveaway.winner
      });
      
      return res.json({ success: true, active: inMemoryGiveaway.active });
    }
    
    let giveaway = await GiveawayModel.findOne().sort({ createdAt: -1 });
    
    if (!giveaway) {
      // Create new giveaway
      giveaway = new GiveawayModel({
        active: active,
        spinDate: '',
        entries: [],
        eliminated: []
      });
    } else {
      giveaway.active = active;
      
      // If turning OFF, clear winner data
      if (!active) {
        giveaway.winner = null;
        console.log(`🎁 Giveaway DEACTIVATED - Winner cleared`);
      } else {
        console.log(`🎁 Giveaway ACTIVATED`);
      }
      
      giveaway.updatedAt = new Date();
    }
    
    await giveaway.save();
    
    // Broadcast status change to all clients
    broadcastToWheelClients({
      type: 'giveaway_status_change',
      active: giveaway.active,
      spinDate: giveaway.spinDate,
      wheelVisible: giveaway.wheelVisible || false,
      entryCount: giveaway.entries.length,
      hasWinner: !!(giveaway.winner && giveaway.winner.firstName),
      winner: giveaway.winner
    });
    
    res.json({ success: true, active: giveaway.active });
  } catch (error) {
    console.error('Error toggling giveaway:', error);
    res.status(500).json({ success: false, error: 'Failed to toggle giveaway' });
  }
});

// Admin: Set spin date
app.post('/api/giveaway/set-date', async (req, res) => {
  try {
    const { spinDate } = req.body;
    
    if (!mongoConnected) {
      // Use in-memory storage
      inMemoryGiveaway.spinDate = spinDate;
      console.log(`🎁 Spin date set to: ${spinDate} (in-memory)`);
      
      // Broadcast date change to all clients
      broadcastToWheelClients({
        type: 'giveaway_status_change',
        active: inMemoryGiveaway.active,
        spinDate: spinDate,
        wheelVisible: inMemoryGiveaway.wheelVisible,
        entryCount: inMemoryGiveaway.entries.length,
        hasWinner: !!(inMemoryGiveaway.winner && inMemoryGiveaway.winner.firstName),
        winner: inMemoryGiveaway.winner
      });
      
      return res.json({ success: true, spinDate: inMemoryGiveaway.spinDate });
    }
    
    let giveaway = await GiveawayModel.findOne().sort({ createdAt: -1 });
    
    if (!giveaway) {
      giveaway = new GiveawayModel({
        active: false,
        spinDate: spinDate,
        entries: [],
        eliminated: []
      });
    } else {
      giveaway.spinDate = spinDate;
      giveaway.updatedAt = new Date();
    }
    
    await giveaway.save();
    
    // Broadcast date change to all clients
    broadcastToWheelClients({
      type: 'giveaway_status_change',
      active: giveaway.active,
      spinDate: giveaway.spinDate,
      wheelVisible: giveaway.wheelVisible || false,
      entryCount: giveaway.entries.length,
      hasWinner: !!(giveaway.winner && giveaway.winner.firstName),
      winner: giveaway.winner
    });
    
    res.json({ success: true, spinDate: giveaway.spinDate });
  } catch (error) {
    console.error('Error setting spin date:', error);
    res.status(500).json({ success: false, error: 'Failed to set spin date' });
  }
});

// Set minimum participants
app.post('/api/giveaway/set-min-participants', async (req, res) => {
  try {
    const { minParticipants } = req.body;
    
    // Validate range (1-15)
    if (minParticipants < 1 || minParticipants > 15) {
      return res.json({ success: false, message: 'Minimum must be between 1 and 15' });
    }
    
    if (!mongoConnected) {
      // Use in-memory storage
      inMemoryGiveaway.minParticipants = minParticipants;
      console.log(`🎁 Minimum participants set to: ${minParticipants} (in-memory)`);
      return res.json({ success: true, minParticipants: inMemoryGiveaway.minParticipants });
    }
    
    let giveaway = await GiveawayModel.findOne().sort({ createdAt: -1 });
    
    if (!giveaway) {
      giveaway = new GiveawayModel({
        active: false,
        minParticipants: minParticipants,
        entries: [],
        eliminated: []
      });
    } else {
      giveaway.minParticipants = minParticipants;
      giveaway.updatedAt = new Date();
    }
    
    await giveaway.save();
    
    res.json({ success: true, minParticipants: giveaway.minParticipants });
  } catch (error) {
    console.error('Error setting minimum participants:', error);
    res.status(500).json({ success: false, error: 'Failed to set minimum participants' });
  }
});

// Set maximum participants (how many people can enter through the website)
app.post('/api/giveaway/set-max-participants', async (req, res) => {
  try {
    const { maxParticipants } = req.body;
    
    // Validate range (1-1000, reasonable upper limit)
    if (maxParticipants < 1 || maxParticipants > 1000) {
      return res.json({ success: false, message: 'Maximum must be between 1 and 1000' });
    }
    
    if (!mongoConnected) {
      // Use in-memory storage
      inMemoryGiveaway.maxParticipants = maxParticipants;
      console.log(`🎁 Maximum participants set to: ${maxParticipants} (in-memory)`);
      return res.json({ success: true, maxParticipants: inMemoryGiveaway.maxParticipants });
    }
    
    let giveaway = await GiveawayModel.findOne().sort({ createdAt: -1 });
    
    if (!giveaway) {
      giveaway = new GiveawayModel({
        active: false,
        maxParticipants: maxParticipants,
        entries: [],
        eliminated: []
      });
    } else {
      giveaway.maxParticipants = maxParticipants;
      giveaway.updatedAt = new Date();
    }
    
    await giveaway.save();
    
    res.json({ success: true, maxParticipants: giveaway.maxParticipants });
  } catch (error) {
    console.error('Error setting maximum participants:', error);
    res.status(500).json({ success: false, error: 'Failed to set maximum participants' });
  }
});

// Admin: Reset giveaway
app.post('/api/giveaway/reset', async (req, res) => {
  try {
    if (!mongoConnected) {
      // Get current active state before resetting
      const wasActive = inMemoryGiveaway.active;
      const currentSpinDate = inMemoryGiveaway.spinDate;
      const currentMinParticipants = inMemoryGiveaway.minParticipants || 15;
      
      // Reset in-memory storage BUT keep it active if it was active
      inMemoryGiveaway = {
        active: wasActive, // Keep the same active state
        wheelVisible: false,
        spinDate: currentSpinDate, // Keep the spin date
        minParticipants: currentMinParticipants,
        entries: [],
        eliminated: [],
        winner: null
      };
      
      console.log('🎁 Giveaway RESET (in-memory) - Cleared all entries and winner');
      
      // Broadcast reset to all clients
      broadcastToWheelClients({
        type: 'giveaway_status_change',
        active: wasActive,
        spinDate: currentSpinDate,
        wheelVisible: false,
        entryCount: 0,
        hasWinner: false,
        winner: null
      });
      
      return res.json({ success: true, message: 'Giveaway reset successfully' });
    }
    
    // Get the current giveaway to preserve active state and spin date
    let currentGiveaway = await GiveawayModel.findOne().sort({ createdAt: -1 });
    const wasActive = currentGiveaway ? currentGiveaway.active : false;
    const currentSpinDate = currentGiveaway ? currentGiveaway.spinDate : '';
    const currentMinParticipants = currentGiveaway ? currentGiveaway.minParticipants : 15;
    
    const giveaway = new GiveawayModel({
      active: wasActive, // Keep the same active state
      wheelVisible: false,
      spinDate: currentSpinDate, // Keep the spin date
      minParticipants: currentMinParticipants,
      entries: [],
      eliminated: [],
      winner: null
    });
    
    await giveaway.save();
    
    console.log('🎁 Giveaway RESET - Cleared all entries and winner');
    
    // Broadcast reset to all clients
    broadcastToWheelClients({
      type: 'giveaway_status_change',
      active: wasActive,
      spinDate: currentSpinDate,
      wheelVisible: false,
      entryCount: 0,
      hasWinner: false,
      winner: null
    });
    
    res.json({ success: true, message: 'Giveaway reset successfully' });
  } catch (error) {
    console.error('Error resetting giveaway:', error);
    res.status(500).json({ success: false, error: 'Failed to reset giveaway' });
  }
});

// WebSocket clients for wheel updates
let wheelClients = [];

// Chat system storage
let chatMessages = []; // Store recent chat messages
let mutedUsers = []; // Store muted user identifiers (username/email)
let chatClients = new Map(); // Map of WebSocket connections to user info {identifier, firstName, lastName, isModerator}

function broadcastToWheelClients(data) {
  wheelClients.forEach(client => {
    if (client.readyState === 1) { // OPEN
      client.send(JSON.stringify(data));
    }
  });
}

// ========== END GIVEAWAY API ENDPOINTS ==========

// ========== PDF PROCESSING ENDPOINTS ==========

// Serve PDF rebrand page
app.get('/pdf', (req, res) => {
  res.sendFile(__dirname + '/pdf.html');
});

// PDF rebrand: fetch remote PDF, cover SenAI banner, serve under /pdf/:id
app.post('/api/rebrand-pdf', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'No URL provided' });
  try {
    // Fetch the original PDF
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch PDF');
    const arrayBuffer = await response.arrayBuffer();

    // Load and edit the PDF
    const pdfDoc = await PDFDocument.load(arrayBuffer);
    const pages = pdfDoc.getPages();
    const firstPage = pages[0];
    const { width, height } = firstPage.getSize();
    const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // White rectangle to cover SenAI banner (12% of height — matches Python script)
    const bannerHeight = height * 0.12;
    firstPage.drawRectangle({
      x: 0, y: height - bannerHeight,
      width: width, height: bannerHeight,
      color: rgb(1, 1, 1)
    });

    // Draw rounded-ish box
    const boxW = 220, boxH = 28;
    const boxX = (width - boxW) / 2;
    const boxY = height - bannerHeight + (bannerHeight - boxH) / 2;
    firstPage.drawRectangle({
      x: boxX, y: boxY,
      width: boxW, height: boxH,
      color: rgb(0.98, 0.98, 1),
      borderColor: rgb(0.42, 0.39, 1),
      borderWidth: 1.5
    });

    // Draw "HWPlug Maths" text
    const text = 'HWPlug Maths';
    const fontSize = 16;
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    firstPage.drawText(text, {
      x: (width - textWidth) / 2,
      y: boxY + (boxH - fontSize) / 2 + 2,
      size: fontSize,
      font,
      color: rgb(0.42, 0.39, 1)
    });

    // Save and store
    const editedPdf = await pdfDoc.save();
    const id = Date.now().toString(36);
    if (!global.pdfStore) global.pdfStore = {};
    global.pdfStore[id] = { buffer: Buffer.from(editedPdf), createdAt: Date.now() };
    res.json({ success: true, link: `/pdf/${id}` });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/pdf/:id', (req, res) => {
  const entry = global.pdfStore?.[req.params.id];
  if (!entry) return res.status(404).send('PDF not found or expired');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="HWPlug-Maths.pdf"');
  res.send(entry.buffer);
});

// ========== END PDF PROCESSING ENDPOINTS ==========

// Root route - serve index.html
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// Port binding for Render
const PORT = process.env.PORT || 10000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🚀 SERVER STARTED SUCCESSFULLY`);
  console.log(`${'='.repeat(60)}`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`🌐 Backend URL: ${process.env.BACKEND_URL || 'Not set'}`);
  console.log(`📧 Email configured: ${process.env.YOUR_EMAIL ? 'Yes ✅' : 'No ❌'}`);
  console.log(`💳 Stripe configured: ${process.env.STRIPE_SECRET_KEY ? 'Yes ✅' : 'No ❌'}`);
  console.log(`🤖 Sparksbot API: ${DISCORD_BOT_API_URL}`);
  console.log(`🎛️ Bot Automation Mode: ${botAutomationMode.toUpperCase()}`);
  console.log(`   └─ ${botAutomationMode === 'auto' ? '🤖 Auto-trigger bot on purchase' : '📧 Email confirmation required'}`);
  console.log(`${'='.repeat(60)}\n`);
});

// WebSocket Server for Giveaway Wheel
const wss = new WebSocket.Server({ server, path: '/wheel-socket' });

wss.on('connection', (ws) => {
  console.log('🎡 New wheel viewer connected');
  wheelClients.push(ws);
  
  // Send current state to new client
  GiveawayModel.findOne().sort({ createdAt: -1 }).then(giveaway => {
    if (giveaway) {
      const eliminatedNames = giveaway.eliminated || [];
      const participants = giveaway.entries.filter(entry => {
        const fullName = `${entry.firstName} ${entry.lastName}`;
        return !eliminatedNames.includes(fullName);
      });
      
      ws.send(JSON.stringify({
        type: 'update',
        participants: participants.map(p => ({
          firstName: p.firstName,
          lastName: p.lastName
        })),
        eliminated: eliminatedNames
      }));
    }
  });
  
  // Handle incoming messages (for chat)
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'chat_view_only') {
        // User wants to view chat without connecting (no name required)
        // Send chat history to all wheel clients
        GiveawayModel.findOne().sort({ createdAt: -1 }).then(giveaway => {
          // Enrich chat history messages with entry status and moderator status
          const enrichedMessages = chatMessages.slice(-50).map(msg => {
            const msgHasEntered = giveaway && giveaway.entries ? giveaway.entries.some(entry => {
              const entryEmail = entry.email || '';
              return entryEmail.toLowerCase() === (msg.identifier || '').toLowerCase();
            }) : false;
            const msgIsModerator = moderatorUsers.includes(msg.identifier || '');
            return {
              ...msg,
              hasEntered: msgHasEntered,
              isModerator: msgIsModerator
            };
          });
          
          ws.send(JSON.stringify({
            type: 'chat_history',
            messages: enrichedMessages,
            isModerator: false,
            hasEntered: false
          }));
        }).catch(err => {
          console.error('Error getting chat history:', err);
          const enrichedMessages = chatMessages.slice(-50).map(msg => ({
            ...msg,
            hasEntered: false,
            isModerator: moderatorUsers.includes(msg.identifier || '')
          }));
          ws.send(JSON.stringify({
            type: 'chat_history',
            messages: enrichedMessages,
            isModerator: false,
            hasEntered: false
          }));
        });
      } else if (data.type === 'chat_connect') {
        // User connecting to chat
        const { identifier, firstName, lastName } = data;
        const isModerator = moderatorUsers.includes(identifier);
        
        // Check if user entered the giveaway
        let hasEntered = false;
        if (identifier) {
          GiveawayModel.findOne().sort({ createdAt: -1 }).then(giveaway => {
            if (giveaway && giveaway.entries) {
              hasEntered = giveaway.entries.some(entry => {
                const entryEmail = entry.email || '';
                return entryEmail.toLowerCase() === identifier.toLowerCase();
              });
            }
          }).catch(err => console.error('Error checking entry status:', err));
        }
        
        chatClients.set(ws, {
          identifier: identifier || 'anonymous',
          firstName: firstName || 'Guest',
          lastName: lastName || '',
          isModerator: isModerator,
          hasEntered: hasEntered
        });
        
        // Check entry status synchronously for immediate response
        GiveawayModel.findOne().sort({ createdAt: -1 }).then(giveaway => {
          const hasEnteredSync = giveaway && giveaway.entries ? giveaway.entries.some(entry => {
            const entryEmail = entry.email || '';
            return entryEmail.toLowerCase() === (identifier || '').toLowerCase();
          }) : false;
          
          const userInfo = chatClients.get(ws);
          if (userInfo) {
            userInfo.hasEntered = hasEnteredSync;
          }
          
          // Enrich chat history messages with entry status and moderator status
          const enrichedMessages = chatMessages.slice(-50).map(msg => {
            // Check if this message's sender entered the giveaway
            const msgHasEntered = giveaway && giveaway.entries ? giveaway.entries.some(entry => {
              const entryEmail = entry.email || '';
              return entryEmail.toLowerCase() === (msg.identifier || '').toLowerCase();
            }) : false;
            
            // Check if this message's sender is a moderator
            const msgIsModerator = moderatorUsers.includes(msg.identifier || '');
            
            return {
              ...msg,
              hasEntered: msgHasEntered,
              isModerator: msgIsModerator
            };
          });
          
          // Send recent chat messages and moderator status
          ws.send(JSON.stringify({
            type: 'chat_history',
            messages: enrichedMessages,
            isModerator: isModerator,
            hasEntered: hasEnteredSync
          }));
        }).catch(err => {
          console.error('Error checking entry status:', err);
          // Send without entry check on error (default to not entered)
          const enrichedMessages = chatMessages.slice(-50).map(msg => ({
            ...msg,
            hasEntered: false,
            isModerator: moderatorUsers.includes(msg.identifier || '')
          }));
          ws.send(JSON.stringify({
            type: 'chat_history',
            messages: enrichedMessages,
            isModerator: isModerator,
            hasEntered: false
          }));
        });
        
        console.log(`💬 Chat user connected: ${firstName} ${lastName} (${identifier})${isModerator ? ' [MODERATOR]' : ''}`);
      } else if (data.type === 'chat_message') {
        // User sending a chat message
        const userInfo = chatClients.get(ws);
        if (!userInfo) {
          ws.send(JSON.stringify({
            type: 'chat_error',
            message: 'Not connected to chat'
          }));
          return;
        }
        
        // Check if user is muted
        if (mutedUsers.includes(userInfo.identifier)) {
          ws.send(JSON.stringify({
            type: 'chat_error',
            message: 'You are muted and cannot send messages'
          }));
          return;
        }
        
        const messageText = (data.message || '').trim();
        if (!messageText || messageText.length === 0) {
          return;
        }
        
        // Limit message length
        if (messageText.length > 200) {
          ws.send(JSON.stringify({
            type: 'chat_error',
            message: 'Message too long (max 200 characters)'
          }));
          return;
        }
        
        // Ensure hasEntered is set (use stored value or default to false)
        const hasEnteredStatus = userInfo.hasEntered !== undefined ? userInfo.hasEntered : false;
        
        // Create chat message
        const chatMessage = {
          id: Date.now().toString(),
          identifier: userInfo.identifier,
          firstName: userInfo.firstName,
          lastName: userInfo.lastName,
          message: messageText,
          timestamp: Date.now(),
          hasEntered: hasEnteredStatus,
          isModerator: userInfo.isModerator || false
        };
        
        // Add to messages (keep last 100)
        chatMessages.push(chatMessage);
        if (chatMessages.length > 100) {
          chatMessages.shift();
        }
        
        // Broadcast to all wheel clients (so everyone watching can see messages)
        const broadcastData = {
          type: 'chat_message',
          ...chatMessage
        };
        
        // Send to all wheel clients (everyone watching the live wheel)
        wheelClients.forEach(client => {
          if (client.readyState === 1) { // OPEN
            client.send(JSON.stringify(broadcastData));
          }
        });
        
        console.log(`💬 Chat: ${userInfo.firstName} ${userInfo.lastName}: ${messageText.substring(0, 50)}...`);
      } else if (data.type === 'chat_mute') {
        // Moderator muting/unmuting a user
        const userInfo = chatClients.get(ws);
        if (!userInfo || !userInfo.isModerator) {
          ws.send(JSON.stringify({
            type: 'chat_error',
            message: 'Unauthorized - moderator only'
          }));
          return;
        }
        
        const { targetIdentifier, mute } = data;
        if (!targetIdentifier) {
          return;
        }
        
        if (mute) {
          if (!mutedUsers.includes(targetIdentifier)) {
            mutedUsers.push(targetIdentifier);
            console.log(`🔇 Moderator ${userInfo.identifier} muted: ${targetIdentifier}`);
          }
        } else {
          const index = mutedUsers.indexOf(targetIdentifier);
          if (index !== -1) {
            mutedUsers.splice(index, 1);
            console.log(`🔊 Moderator ${userInfo.identifier} unmuted: ${targetIdentifier}`);
          }
        }
        
        // Broadcast mute status update
        const broadcastData = {
          type: 'chat_mute_update',
          identifier: targetIdentifier,
          muted: mute
        };
        
        chatClients.forEach((info, client) => {
          if (client.readyState === 1) { // OPEN
            client.send(JSON.stringify(broadcastData));
          }
        });
      }
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
    }
  });
  
  ws.on('close', () => {
    console.log('🎡 Wheel viewer disconnected');
    wheelClients = wheelClients.filter(client => client !== ws);
    chatClients.delete(ws);
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

console.log('🎡 WebSocket server initialized for giveaway wheel');
