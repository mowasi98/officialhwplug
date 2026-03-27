# PropellerAds Ad Placement Guide

## Visual Guide: Where Ads Will Appear

### Homepage (index.html)

```
┌─────────────────────────────────────────────────────────┐
│  HEADER (Purple Background)                             │
│  ┌───────────────────────────────────────────────────┐  │
│  │  📢 BANNER AD APPEARS HERE (728x90 or responsive) │  │ ← THIS IS THE BLANK SPACE YOU SAW!
│  │  [PropellerAds Banner Zone]                       │  │
│  └───────────────────────────────────────────────────┘  │
│                                                          │
│  🕐 Slots Reset In: 14:23:46        [Login] [Logout]    │
│                                                          │
│  🔌 HWPLUG                                               │
│  Your one-stop shop for learning tools                  │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  ✅ Products are currently AVAILABLE                     │
│  Monday-Friday: 11:00 AM - Midnight                     │
└─────────────────────────────────────────────────────────┘

┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Sparx Reader │  │ Sparx Maths  │  │ Sparx Science│
│ £2           │  │ £2           │  │ Coming Soon  │
│ [Buy Now]    │  │ [Buy Now]    │  │              │
└──────────────┘  └──────────────┘  └──────────────┘

┌──────────────┐  ┌──────────────┐
│ Seneca       │  │ Educate      │
│ £2           │  │ £2           │
│ [Buy Now]    │  │ [Buy Now]    │
└──────────────┘  └──────────────┘

                                    ┌─────────────────┐
                                    │ 💬 In-Page Push │ ← OPTIONAL: Can add here
                                    │ Ad (bottom-right│    (small notification box)
                                    │ corner)         │
                                    └─────────────────┘
```

### Pop-under Behavior (All Pages)

```
USER ACTION:                    WHAT HAPPENS:
┌──────────────┐               
│ User clicks  │  ────────────> 🪟 New tab opens BEHIND current page
│ "Buy Now"    │                   (User doesn't see it yet)
└──────────────┘               
                               
Later when user closes your tab:
                               
┌──────────────┐               
│ User closes  │  ────────────> 👀 User discovers the ad tab
│ hwplug tab   │                   (Pop-under revealed)
└──────────────┘               
```

---

## Ad Formats Breakdown

### 1. Banner Ad (Top of Homepage)
- **File**: `index.html` (line ~1355)
- **Placement**: Header section, in that blank white rectangle
- **Size**: 728x90 desktop, responsive on mobile
- **Trigger**: Loads automatically with page
- **Frequency**: Shows on every page load
- **Revenue**: $1-3 per 1,000 impressions

**Code Location:**
```html
<header>
  <!-- PropellerAds Banner Ad - Top of Page -->
  <div style="text-align: center; margin-bottom: 0.2rem; min-height: 90px;">
    <div id="propeller-banner-ad">
      <!-- Your PropellerAds banner code goes here -->
    </div>
  </div>
```

### 2. Pop-under Ad (All Pages)
- **Files**: All HTML pages (index, faq, about, terms, privacy, etc.)
- **Placement**: Opens in background tab
- **Trigger**: First click anywhere on the page
- **Frequency**: 1 per user per 24 hours (PropellerAds manages this)
- **Revenue**: $3-8 per 1,000 clicks

**Code Location (bottom of every page):**
```html
<!-- PropellerAds Pop-under Script -->
<script>
  (function(d,z,s){
    s.src='https://'+d+'/400/'+z;
    try{
      (document.body||document.documentElement).appendChild(s)
    }catch(e){}
  })('glizauvo.net', 'YOUR_POPUNDER_ZONE_ID', document.createElement('script'))
</script>
```

---

## User Experience

### What Users Will See:

1. **Banner Ad** (Top of homepage):
   - Visible rectangular ad in the header
   - Blends with your design
   - Not intrusive

2. **Pop-under** (All pages):
   - User clicks "Buy Now" or any link
   - New tab opens silently in background
   - User continues on your site normally
   - When they close your tab, they see the ad tab
   - **NOT annoying** - doesn't interrupt their flow

### What Users WON'T See:
- No annoying pop-ups blocking content
- No full-screen interstitials
- No notification permission requests (unless you add push ads)

---

## Revenue Calculation

### Scenario: 100 visitors per day

**Banner Ad:**
- 100 page views × 1 impression each = 100 impressions
- CPM = $2 (average for UK traffic)
- Revenue = (100 / 1000) × $2 = **$0.20/day**

**Pop-under Ad:**
- 100 visitors × 30% click rate = 30 clicks
- CPM = $5 (average for UK traffic)
- Revenue = (30 / 1000) × $5 = **$0.15/day**

**Total per day**: $0.35 = **£0.27/day** = **£8/month**

### Scenario: 1,000 visitors per day

**Banner Ad:**
- 1,000 impressions × $2 CPM = **$2/day**

**Pop-under Ad:**
- 300 clicks × $5 CPM = **$1.50/day**

**Total per day**: $3.50 = **£2.70/day** = **£81/month**

### Scenario: 5,000 visitors per day (realistic if you market well)

**Banner Ad:**
- 5,000 impressions × $2 CPM = **$10/day**

**Pop-under Ad:**
- 1,500 clicks × $5 CPM = **$7.50/day**

**Total per day**: $17.50 = **£13.50/day** = **£405/month**

---

## Important Notes

### About the Blank Spaces (iframes):

The blank white rectangles you see in your screenshots are:
1. **Google AdSense placeholders** that aren't loading (because Google hasn't approved you yet)
2. I've replaced them with **PropellerAds placeholders**
3. Once you add your real PropellerAds zone IDs, actual ads will appear there

### Why Ads Might Not Show Yet:

- You need to sign up and get approved first
- Then create ad zones in PropellerAds dashboard
- Then replace `YOUR_POPUNDER_ZONE_ID` and `YOUR_BANNER_ZONE_ID` with real IDs
- Then ads will start appearing

---

## Next Steps

1. ✅ Code is ready (placeholders added to all pages)
2. 📝 Sign up at PropellerAds.com as Publisher
3. ⏳ Wait for approval (24-48 hours)
4. 🎯 Create ad zones (pop-under + banner)
5. 🔄 Replace placeholders with real zone IDs
6. 💰 Start earning!

---

## Testing After Setup

Once you add your real zone IDs:

1. **Test Banner Ad:**
   - Visit your homepage
   - Look at the header - you should see an ad in that blank space

2. **Test Pop-under:**
   - Visit any page
   - Click any button or link
   - Check if a new tab opened in the background
   - Close your current tab - you should see the ad tab

3. **Check PropellerAds Dashboard:**
   - View impressions and clicks in real-time
   - Monitor earnings
   - Adjust settings if needed

---

Good luck! 🚀
