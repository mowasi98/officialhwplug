# ✅ PropellerAds Setup - COMPLETE!

## What's Been Done

I've fully integrated PropellerAds into your hwplug website with your actual zone ID: **10794718**

---

## Files Updated (All Ready to Go!)

### ✅ Service Worker Added:
- `Hwplug/website/sw.js` - PropellerAds service worker for push notifications

### ✅ All HTML Pages Updated:
1. **index.html** - Service worker registration + pop-under script (Zone: 10794718)
2. **faq.html** - Service worker registration + pop-under script (Zone: 10794718)
3. **about.html** - Service worker registration + pop-under script (Zone: 10794718)
4. **terms.html** - Service worker registration + pop-under script (Zone: 10794718)
5. **privacy.html** - Service worker registration + pop-under script (Zone: 10794718) + updated privacy policy
6. **refund.html** - Service worker registration + pop-under script (Zone: 10794718)
7. **info.html** - Service worker registration + pop-under script (Zone: 10794718)
8. **payment.html** - Service worker registration + pop-under script (Zone: 10794718)
9. **success.html** - Service worker registration + pop-under script (Zone: 10794718)

---

## What Ads Are Active

### 1. ✅ Push Notification Ads (Zone: 10794718)
- **Service Worker**: `sw.js` is registered on all pages
- **How it works**: 
  - Users visit your site
  - Browser asks "Allow notifications from hwplug?"
  - If they click "Allow", they get subscribed
  - You earn money when they receive notifications (even when NOT on your site!)
- **Revenue**: $0.10-0.50 per subscriber + $0.05-0.20 per click

### 2. ✅ Pop-under Ads (Zone: 10794718)
- **Active on**: All pages
- **How it works**:
  - User clicks anywhere on your site
  - New tab opens in background with an ad
  - User doesn't see it until they close your tab
- **Revenue**: $3-8 per 1,000 clicks

### 3. ⏳ Banner Ad (Header - Not Yet Active)
- **Location**: Top of homepage (that blank white space)
- **Status**: Placeholder ready
- **Next step**: Create a banner ad zone in PropellerAds dashboard and add the code

---

## How Ads Will Appear on Your Site

### Homepage View:
```
┌─────────────────────────────────────────────────────┐
│ HEADER                                              │
│ ┌─────────────────────────────────────────────────┐ │
│ │ [Banner Ad Space - Add banner zone code here]  │ │ ← Blank space from screenshot
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ 🕐 Slots Reset In: 14:23:46    [Login] [Logout]    │
│                                                     │
│ 🔌 HWPLUG                                           │
│ Your one-stop shop for learning tools              │
└─────────────────────────────────────────────────────┘

[Product Cards Below]
```

### When User Visits:
1. **Service worker registers** → Enables push notifications
2. **User clicks anything** → Pop-under opens in background
3. **User may see notification prompt** → "Allow notifications?"

---

## Testing Your Setup

### Test Right Now (After Deploying):

1. **Visit your website** (e.g., https://hwplug.com)
2. **Open browser console** (F12)
3. **Look for**: "PropellerAds Service Worker registered"
4. **Click any button** (e.g., "Buy Now")
5. **Check if a new tab opened** in the background
6. **Look for notification prompt** asking to allow notifications

### What You Should See:
- ✅ Service worker registered message in console
- ✅ Pop-under tab opens when you click
- ✅ Notification permission prompt (may appear after a few seconds)

---

## Expected Revenue (With Zone 10794718)

Based on your zone ID being active:

### Push Notifications:
- **100 subscribers**: $10-50/month (recurring!)
- **1,000 subscribers**: $100-500/month
- **5,000 subscribers**: $500-2,500/month

### Pop-unders:
- **100 clicks/day**: $0.30-0.80/day = $9-24/month
- **500 clicks/day**: $1.50-4/day = $45-120/month
- **1,000 clicks/day**: $3-8/day = $90-240/month

### Combined Revenue Estimate:
If you get **1,000 visitors/day**:
- Push subs: ~200 subscribers = $20-100/month
- Pop-unders: ~300 clicks/day = $27-72/month
- **Total: $47-172/month (£36-132/month)**

---

## Important: Add Banner Ad for More Revenue

Right now you have:
- ✅ Push notifications (via service worker)
- ✅ Pop-under ads

To maximize revenue, add a **banner ad** to that blank space:

### Steps:
1. Log into PropellerAds dashboard
2. Go to "Sites & Zones"
3. Click "Add Zone"
4. Select "Banner" or "Native" format
5. Copy the code snippet
6. Paste it in `index.html` at line ~1358 (in the banner ad div)

**Example code they'll give you:**
```html
<script async="async" data-cfasync="false" src="//a.magsrv.com/ad-provider.js"></script>
<script>(adProvider = window.adProvider || []).push({"serve": {}});</script>
```

---

## Deployment Checklist

Before going live:

- ✅ `sw.js` file is in website root folder
- ✅ All HTML files have service worker registration
- ✅ All HTML files have pop-under script with zone 10794718
- ✅ Privacy policy updated to mention PropellerAds
- ⏳ Deploy to your server
- ⏳ Test on live site
- ⏳ Monitor PropellerAds dashboard for stats

---

## Monitoring Your Earnings

### PropellerAds Dashboard:
1. Log in at https://publishers.propellerads.com
2. Go to "Statistics"
3. View:
   - **Impressions** (how many times ads loaded)
   - **Clicks** (how many times users clicked)
   - **Revenue** (how much you earned)
   - **eCPM** (effective cost per 1000 impressions)

### Payment:
- **Minimum**: $5 (you can cash out once you reach $5!)
- **Methods**: PayPal, Payoneer, Wire Transfer
- **Schedule**: Request payout anytime, receive in 7 days

---

## Troubleshooting

### If ads don't show:
1. Check browser console for errors
2. Make sure `sw.js` is accessible at `https://yoursite.com/sw.js`
3. Verify zone 10794718 is active in PropellerAds dashboard
4. Clear browser cache and reload

### If service worker fails:
1. Make sure your site is served over HTTPS (required for service workers)
2. Check that `sw.js` is in the root folder (not in a subdirectory)
3. Verify the file path is `/sw.js` (not `./sw.js` or `website/sw.js`)

---

## What's Next?

### Immediate:
1. Deploy your updated website files to your server
2. Test the ads on your live site
3. Monitor PropellerAds dashboard for impressions/clicks

### Optional (More Revenue):
1. Add banner ad zone to homepage header
2. Add native ads between product cards
3. Add in-page push ads (no permission needed)

### Long-term:
1. Monitor which ad formats perform best
2. Optimize ad placements based on data
3. Test different ad positions for higher CTR

---

## Summary

🎉 **PropellerAds is now fully integrated!**

- ✅ Service worker installed (push notifications)
- ✅ Pop-under ads active (zone 10794718)
- ✅ All pages updated
- ✅ Privacy policy updated
- ⏳ Deploy and start earning!

Your ads will appear in:
1. **That blank white space** at the top (once you add banner zone)
2. **Background tabs** (pop-unders on every click)
3. **Push notifications** (if users allow)

Deploy your site and watch the revenue come in! 💰
