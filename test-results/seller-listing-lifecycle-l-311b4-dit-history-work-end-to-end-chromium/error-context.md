# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: seller-listing-lifecycle.spec.ts >> listing expiration, renewal, vacation mode, timeout notifications, and audit history work end-to-end
- Location: e2e\seller-listing-lifecycle.spec.ts:304:5

# Error details

```
TypeError: request.get is not a function
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic:
    - img
    - generic:
      - generic:
        - img:
          - generic: ₿
      - generic:
        - img
      - generic:
        - img
      - generic:
        - img
      - generic:
        - img:
          - generic: ₿
      - generic:
        - img
      - generic:
        - img
      - generic:
        - img
      - generic:
        - img
      - generic:
        - img
      - generic:
        - img
      - generic:
        - img
      - generic:
        - img
      - generic:
        - img
  - generic [ref=e3]:
    - banner [ref=e4]:
      - generic [ref=e5]:
        - link "Alpha Traders logo 𝔸𝕝𝕡𝕙𝕒 𝕋𝕣𝕒𝕕𝕖𝕣𝕤" [ref=e6] [cursor=pointer]:
          - /url: /en
          - img "Alpha Traders logo" [ref=e7]
          - generic [ref=e8]: 𝔸𝕝𝕡𝕙𝕒 𝕋𝕣𝕒𝕕𝕖𝕣𝕤
        - navigation [ref=e9]:
          - link "Home" [ref=e10] [cursor=pointer]:
            - /url: /en
            - text: Home
          - link "Academy" [ref=e11] [cursor=pointer]:
            - /url: /en/academy
            - text: Academy
          - link "Community" [ref=e12] [cursor=pointer]:
            - /url: /en/community
            - text: Community
          - link "Contact" [ref=e13] [cursor=pointer]:
            - /url: /en/contact
            - text: Contact
          - link "⇄ Alpha Exchange" [ref=e14] [cursor=pointer]:
            - /url: /en/usdt-exchange
            - text: ⇄ Alpha Exchange
        - generic [ref=e15]:
          - button "التبديل إلى العربية" [ref=e16]:
            - img [ref=e17]
            - text: AR
          - generic [ref=e21]: test123
          - link "Profile" [ref=e22] [cursor=pointer]:
            - /url: /en/profile
            - button "Profile" [ref=e23]
          - button "Notifications" [ref=e25]:
            - img [ref=e26]
            - generic [ref=e29]: "1"
          - button "Sign out" [ref=e31]
    - main [ref=e32]:
      - generic [ref=e33]:
        - generic [ref=e35]:
          - paragraph [ref=e36]:
            - img [ref=e37]
            - text: Alpha Exchange
          - heading "Alpha Exchange" [level=1] [ref=e41]
          - paragraph [ref=e42]: A premium marketplace connecting buyers and sellers looking to exchange USDT. Alpha Traders coordinates every transaction through a transparent, professional, and community-driven process while charging a simple 1% service fee.
          - generic [ref=e43]:
            - link "Start a Trade" [ref=e44] [cursor=pointer]:
              - /url: "#marketplace"
              - button "Start a Trade" [ref=e45]
            - link "Learn How It Works" [ref=e46] [cursor=pointer]:
              - /url: "#how-it-works"
              - button "Learn How It Works" [ref=e47]
        - generic [ref=e49]:
          - heading "Approved Sellers Only" [level=3] [ref=e50]
          - paragraph [ref=e51]: Only sellers approved by Alpha Traders are allowed to publish listings. Every seller application is reviewed manually before approval.
        - generic [ref=e52]:
          - heading "Trust & Security" [level=2] [ref=e53]
          - generic [ref=e54]:
            - generic [ref=e55]:
              - generic [ref=e57]:
                - img [ref=e59]
                - heading "Approved Sellers" [level=3] [ref=e62]
              - paragraph [ref=e64]: Only manually approved sellers can publish listings.
            - generic [ref=e65]:
              - generic [ref=e67]:
                - img [ref=e69]
                - heading "Transparent 1% Commission" [level=3] [ref=e72]
              - paragraph [ref=e74]: Alpha Traders charges a simple, transparent 1% commission on completed transactions.
            - generic [ref=e75]:
              - generic [ref=e77]:
                - img [ref=e79]
                - heading "Privacy" [level=3] [ref=e83]
              - paragraph [ref=e85]: User information is handled securely.
            - generic [ref=e86]:
              - generic [ref=e88]:
                - img [ref=e90]
                - heading "Support" [level=3] [ref=e92]
              - paragraph [ref=e94]: Direct WhatsApp support during the trading process.
        - generic [ref=e95]:
          - heading "How It Works" [level=2] [ref=e96]
          - generic [ref=e97]:
            - generic [ref=e98]:
              - generic [ref=e99]:
                - generic [ref=e100]: "1"
                - generic [ref=e101]:
                  - heading "Buyer submits trade request" [level=3] [ref=e102]
                  - paragraph [ref=e103]: The request is recorded as a permanent timeline event immediately.
              - generic [ref=e105]: ↓
            - generic [ref=e106]:
              - generic [ref=e107]:
                - generic [ref=e108]: "2"
                - generic [ref=e109]:
                  - heading "Seller accepts request and creates trade" [level=3] [ref=e110]
                  - paragraph [ref=e111]: Accepting creates a Trade ID and locks in trade details.
              - generic [ref=e113]: ↓
            - generic [ref=e114]:
              - generic [ref=e115]:
                - generic [ref=e116]: "3"
                - generic [ref=e117]:
                  - heading "Buyer marks Payment Sent" [level=3] [ref=e118]
                  - paragraph [ref=e119]: Timeline updates to payment-sent stage for delivery handoff.
              - generic [ref=e121]: ↓
            - generic [ref=e122]:
              - generic [ref=e123]:
                - generic [ref=e124]: "4"
                - generic [ref=e125]:
                  - heading "Seller marks USDT Sent" [level=3] [ref=e126]
                  - paragraph [ref=e127]: USDT-sent step is logged and waits for buyer confirmation.
              - generic [ref=e129]: ↓
            - generic [ref=e131]:
              - generic [ref=e132]: "5"
              - generic [ref=e133]:
                - heading "Buyer confirms completion" [level=3] [ref=e134]
                - paragraph [ref=e135]: Trade auto-locks and review window opens after completion.
        - generic [ref=e136]:
          - heading "Live Marketplace" [level=2] [ref=e137]
          - generic [ref=e140]:
            - combobox [ref=e141]:
              - 'option "Currency: All" [selected]'
              - option "ILS"
            - combobox [ref=e142]:
              - 'option "Payment: All" [selected]'
              - option "Bank transfer"
            - combobox [ref=e143]:
              - 'option "Network: All" [selected]'
              - option "TRC20"
              - option "ERC20"
              - option "BEP20"
              - option "SOL"
            - combobox [ref=e144]:
              - 'option "Sort: Best Trust Score" [selected]'
              - 'option "Sort: Lowest Price"'
              - 'option "Sort: Highest Available USDT"'
              - 'option "Sort: Most Completed Trades"'
              - 'option "Sort: Highest Rating"'
              - 'option "Sort: Fastest Response Time"'
              - 'option "Sort: Newest Listing"'
            - textbox "Min Amount" [ref=e145]
            - textbox "Max Amount" [ref=e146]
            - textbox "Min Price" [ref=e147]
            - textbox "Max Price" [ref=e148]
            - textbox "Min Trust Score" [ref=e149]
            - button "Show Online Sellers Only" [ref=e150]
          - generic [ref=e152]:
            - generic [ref=e154]:
              - generic [ref=e155]:
                - generic [ref=e156]: t
                - generic [ref=e157]:
                  - heading "test123" [level=3] [ref=e158]
                  - paragraph [ref=e159]: Bronze Seller • Online
                  - generic [ref=e163]:
                    - img [ref=e164]
                    - generic [ref=e167]: Approved Seller
              - generic [ref=e168]: Available
            - generic [ref=e169]:
              - paragraph [ref=e170]: "Trust Score: 34.5"
              - paragraph [ref=e171]: "Completed Trades: 0"
              - paragraph [ref=e172]: "Average Rating: 4.20"
              - paragraph [ref=e173]: "Response Time: 5 min"
              - paragraph [ref=e174]: "Last Active: Just now"
              - paragraph [ref=e175]: "USDT Available: 901"
              - paragraph [ref=e176]:
                - text: "Price:"
                - generic [ref=e177]: 3.71 ILS
              - paragraph [ref=e178]: "Payment Methods: Bank transfer"
              - paragraph [ref=e179]: "Networks: TRC20"
              - paragraph [ref=e180]:
                - text: "Min/Max Trade:"
                - generic [ref=e181]: 100 / 901
              - paragraph [ref=e182]: "Updated: 20/07/2026, 15:31:14"
              - generic [ref=e183]:
                - paragraph [ref=e184]: ⭐ 4.20 Rating
                - paragraph [ref=e185]: 0 Successful Trades
                - paragraph [ref=e186]: 0% Success Rate
                - paragraph [ref=e187]: Member Since 2026
              - button "Open seller profile for test123" [ref=e188]: View Seller Profile
        - generic [ref=e189]:
          - heading "Why Alpha Exchange" [level=2] [ref=e190]
          - generic [ref=e191]:
            - generic [ref=e192]:
              - generic [ref=e194]:
                - img [ref=e196]
                - heading "Trusted Community" [level=3] [ref=e199]
              - paragraph [ref=e201]: A serious community built on clear, professional trade coordination.
            - generic [ref=e202]:
              - generic [ref=e204]:
                - img [ref=e206]
                - heading "Transparent 1% Service Fee" [level=3] [ref=e209]
              - paragraph [ref=e211]: A simple, transparent 1% fee for each facilitated marketplace transaction.
            - generic [ref=e212]:
              - generic [ref=e214]:
                - img [ref=e216]
                - heading "Professional Coordination" [level=3] [ref=e222]
              - paragraph [ref=e224]: Alpha Traders coordinates each side through a clear transaction flow.
            - generic [ref=e225]:
              - generic [ref=e227]:
                - img [ref=e229]
                - heading "Fast Communication" [level=3] [ref=e232]
              - paragraph [ref=e234]: Direct and fast communication to keep transaction flow efficient.
            - generic [ref=e235]:
              - generic [ref=e237]:
                - img [ref=e239]
                - heading "Multiple USDT Networks" [level=3] [ref=e244]
              - paragraph [ref=e246]: Support for common USDT networks based on buyer and seller preferences.
            - generic [ref=e247]:
              - generic [ref=e249]:
                - img [ref=e251]
                - heading "Premium Customer Experience" [level=3] [ref=e254]
              - paragraph [ref=e256]: A premium, confidence-first experience with clear process visibility.
        - generic [ref=e257]:
          - generic [ref=e258]:
            - generic [ref=e259]:
              - heading "Become an Approved Seller" [level=3] [ref=e260]
              - paragraph [ref=e261]: Seller access is granted only after manual review and approval.
            - generic [ref=e262]:
              - generic [ref=e263]:
                - generic [ref=e264]:
                  - generic [ref=e265]: Application
                  - generic [ref=e266]: ↓
                  - generic [ref=e267]: Review
                  - generic [ref=e268]: ↓
                  - generic [ref=e269]: Approval
                - paragraph [ref=e270]: "Current Status: Approved"
              - generic [ref=e271]:
                - textbox "Full Name" [ref=e272]: test123
                - textbox "Email" [ref=e273]: test123@guest.local
                - textbox "WhatsApp Number" [ref=e274]: "0000000000"
                - combobox [ref=e275]:
                  - option "TRC20" [selected]
                  - option "ERC20"
                  - option "BEP20"
                  - option "SOL"
                - textbox "Expected Monthly Trading Volume" [ref=e276]
                - textbox "Additional Notes" [ref=e277]
                - button "Apply for Approval" [ref=e278]
          - generic [ref=e279]:
            - generic [ref=e280]:
              - heading "Find an Approved Seller" [level=3] [ref=e281]
              - paragraph [ref=e282]: Tell us how much USDT you need and Alpha Traders will help connect you with an available Approved Seller.
            - generic [ref=e284]:
              - spinbutton [ref=e285]
              - combobox [ref=e286]:
                - option "TRC20" [selected]
                - option "ERC20"
                - option "BEP20"
                - option "SOL"
              - textbox "WhatsApp Number" [ref=e287]
              - textbox "Additional Notes" [ref=e288]
              - button "Find Available Sellers" [ref=e289]
        - generic [ref=e290]:
          - generic [ref=e291]:
            - generic [ref=e293]:
              - paragraph [ref=e294]:
                - img [ref=e295]
                - text: Profile Views
              - heading "238" [level=3] [ref=e300]
            - generic [ref=e302]:
              - paragraph [ref=e303]:
                - img [ref=e304]
                - text: Listing Views
              - heading "532" [level=3] [ref=e307]
            - generic [ref=e309]:
              - paragraph [ref=e310]:
                - img [ref=e311]
                - text: Trade Requests
              - heading "0" [level=3] [ref=e313]
            - generic [ref=e315]:
              - paragraph [ref=e316]:
                - img [ref=e317]
                - text: Completed Trades
              - heading "0" [level=3] [ref=e323]
            - generic [ref=e325]:
              - paragraph [ref=e326]:
                - img [ref=e327]
                - text: Success Rate
              - heading "0.0%" [level=3] [ref=e330]
            - generic [ref=e332]:
              - paragraph [ref=e333]:
                - img [ref=e334]
                - text: Monthly Growth
              - heading "-4.0%" [level=3] [ref=e337]
            - generic [ref=e339]:
              - paragraph [ref=e340]:
                - img [ref=e341]
                - text: Estimated Commission Paid
              - heading "₪0.00" [level=3] [ref=e344]
            - generic [ref=e346]:
              - paragraph [ref=e347]:
                - img [ref=e348]
                - text: Revenue Generated
              - heading "₪0.00" [level=3] [ref=e351]
            - generic [ref=e353]:
              - paragraph [ref=e354]:
                - img [ref=e355]
                - text: Repeat Buyers
              - heading "0" [level=3] [ref=e360]
            - generic [ref=e362]:
              - paragraph [ref=e363]:
                - img [ref=e364]
                - text: Average Trade Size
              - heading "₪0.00" [level=3] [ref=e370]
            - generic [ref=e372]:
              - paragraph [ref=e373]:
                - img [ref=e374]
                - text: Response Time
              - heading "5 min" [level=3] [ref=e377]
            - generic [ref=e379]:
              - paragraph [ref=e380]:
                - img [ref=e381]
                - text: Seller Level
              - heading "Bronze" [level=3] [ref=e383]
          - generic [ref=e385]:
            - generic [ref=e386]:
              - heading "Create Listing" [level=3] [ref=e387]
              - paragraph [ref=e388]: Create a live listing with a maximum of 2 open listings at the same time.
            - generic [ref=e389]:
              - generic [ref=e390]:
                - paragraph [ref=e391]:
                  - text: "Open listing slots:"
                  - generic [ref=e392]: 1/2
                - paragraph [ref=e393]: "Trades in progress: 0 • Pending commissions: 0"
              - generic [ref=e394]:
                - textbox "Available Amount" [ref=e395]
                - textbox "Price" [ref=e396]
                - textbox "Currency (e.g. ILS)" [ref=e397]: ILS
                - combobox [ref=e398]:
                  - option "TRC20" [selected]
                  - option "ERC20"
                  - option "BEP20"
                  - option "SOL"
                - textbox "Payment Methods (comma separated)" [ref=e399]: Bank transfer
                - textbox "Minimum Trade" [ref=e400]: "0"
                - textbox "Maximum Trade" [ref=e401]
                - combobox [ref=e402]:
                  - option "Expires in 1 hour"
                  - option "Expires in 6 hours"
                  - option "Expires in 12 hours"
                  - option "Expires in 24 hours" [selected]
                - textbox "Response Time (e.g. 5 min)" [ref=e403]: 5 min
                - textbox "Photo URLs (comma separated)" [ref=e404]
                - textbox "Optional Notes" [ref=e405]
                - textbox "Seller Description" [ref=e406]
                - button "Create Live Listing" [ref=e408]
          - generic [ref=e409]:
            - generic [ref=e410]:
              - heading "My Listings" [level=3] [ref=e411]
              - paragraph [ref=e412]: Manage all of your approved seller listings.
            - generic [ref=e414]:
              - generic [ref=e415]:
                - paragraph [ref=e416]: "Status: Active"
                - paragraph [ref=e417]: "Available Amount: 901"
                - paragraph [ref=e418]: "Original Amount: 901"
                - paragraph [ref=e419]: "Price: 3.71"
                - paragraph [ref=e420]: "Network: TRC20"
                - paragraph [ref=e421]: "Views: 532"
                - paragraph [ref=e422]: "Purchase Requests: 0"
                - paragraph [ref=e423]: "Created Date: 20/07/2026"
              - generic [ref=e424]:
                - button "Edit" [ref=e425]:
                  - img [ref=e426]
                  - text: Edit
                - button "Pause" [active] [ref=e428]:
                  - img [ref=e429]
                  - text: Pause
                - button "Close Listing" [ref=e431]:
                  - img [ref=e432]
                  - text: Close Listing
                - button "Duplicate Listing" [ref=e435]:
                  - img [ref=e436]
                  - text: Duplicate Listing
          - generic [ref=e439]:
            - generic [ref=e440]:
              - heading "Purchase Requests" [level=3] [ref=e441]
              - paragraph [ref=e442]: Manage incoming buyer purchase requests.
            - generic [ref=e443]:
              - generic [ref=e444]:
                - textbox "Search by trade ID, buyer, listing..." [ref=e445]
                - combobox [ref=e446]:
                  - 'option "Status: All" [selected]'
                  - option "Pending"
                  - option "Accepted"
                  - option "Payment Sent"
                  - option "USDT Sent"
                  - option "Review Open"
                  - option "Declined"
                  - option "Cancelled"
              - generic [ref=e447]:
                - img [ref=e448]
                - paragraph [ref=e450]: No Purchase Requests
                - paragraph [ref=e451]: Incoming buyer requests will appear here.
          - generic [ref=e452]:
            - generic [ref=e453]:
              - heading "Seller Profile" [level=3] [ref=e455]
              - generic [ref=e456]:
                - generic [ref=e457]:
                  - generic [ref=e458]: t
                  - generic [ref=e459]:
                    - paragraph [ref=e460]: test123
                    - generic [ref=e463]:
                      - img [ref=e464]
                      - generic [ref=e467]: Approved Seller
                - paragraph [ref=e468]: "Member Since: 19/07/2026"
                - paragraph [ref=e469]: "Languages: English"
                - paragraph [ref=e470]: "Preferred Networks: TRC20"
                - paragraph [ref=e471]: "Rating: 4.20"
                - paragraph [ref=e472]:
                  - text: "Success Rate:"
                  - generic [ref=e473]: 0.0%
                - paragraph [ref=e474]: "Completed Trades: 0"
                - paragraph [ref=e475]: "Total USDT Volume: 0"
                - paragraph [ref=e476]: "Current Listings: 1"
                - paragraph [ref=e477]: "Average Response Time: 5 min"
                - paragraph [ref=e478]: "Status: Online"
                - paragraph [ref=e479]: "Availability: available"
                - paragraph [ref=e480]: "Last Active: Just now"
                - paragraph [ref=e481]: "Bio: Professional USDT seller on Alpha Exchange."
                - paragraph [ref=e482]: "Trading Experience: Professional trading experience"
                - paragraph [ref=e483]: "Working Hours: Sun-Thu, 09:00-21:00"
                - paragraph [ref=e484]: "Account Status: approved_seller"
                - generic [ref=e486]: No Trades Yet. Complete your first trade to start building trust history.
            - generic [ref=e487]:
              - generic [ref=e488]:
                - heading "Private Beta Center" [level=3] [ref=e489]
                - paragraph [ref=e490]: Founding badges, beta announcements, and product feedback.
              - generic [ref=e491]:
                - generic [ref=e493]:
                  - paragraph [ref=e494]: Announcements
                  - paragraph [ref=e495]: No active announcements.
                - generic [ref=e496]:
                  - generic [ref=e497]:
                    - paragraph [ref=e498]: Submit Beta Feedback
                    - combobox [ref=e499]:
                      - option "Bug"
                      - option "Suggestion" [selected]
                      - option "Confusing UX"
                      - option "Feature Request"
                      - option "Performance"
                      - option "Other"
                    - textbox "Share your feedback..." [ref=e500]
                    - button "Submit Feedback" [ref=e501]
                  - generic [ref=e502]:
                    - paragraph [ref=e503]: My Feedback
                    - paragraph [ref=e504]: No feedback submitted yet.
            - generic [ref=e505]:
              - heading "Settings" [level=3] [ref=e507]
              - generic [ref=e508]:
                - generic [ref=e509]:
                  - textbox "Profile" [ref=e510]: test123
                  - textbox "WhatsApp" [ref=e511]: "0000000000"
                  - textbox "Languages (comma separated)" [ref=e512]: English
                  - combobox [ref=e513]:
                    - 'option "Preferred Network: TRC20" [selected]'
                    - 'option "Preferred Network: ERC20"'
                    - 'option "Preferred Network: BEP20"'
                    - 'option "Preferred Network: SOL"'
                  - textbox "Profile Photo URL" [ref=e514]
                  - textbox "Cover Banner URL" [ref=e515]
                  - textbox "Bio" [ref=e516]
                  - textbox "Trading Experience" [ref=e517]
                  - textbox "Working Hours" [ref=e518]
                  - textbox "Preferred Payment Methods (comma separated)" [ref=e519]: Bank transfer
                  - textbox "Country" [ref=e520]: Israel
                  - textbox "City (optional)" [ref=e521]
                  - combobox [ref=e522]:
                    - 'option "Status: Online" [selected]'
                    - 'option "Status: Offline"'
                  - combobox [ref=e523]:
                    - 'option "Availability: Available" [selected]'
                    - 'option "Availability: Away"'
                    - 'option "Availability: Vacation Mode"'
                  - button "Save Profile" [ref=e524]
                - generic [ref=e525]:
                  - textbox "Current Password" [ref=e526]
                  - textbox "New Password" [ref=e527]
                  - button "Update Password" [ref=e528]
                - generic [ref=e529]:
                  - paragraph [ref=e530]: Notification Preferences
                  - generic [ref=e531]:
                    - generic [ref=e532]: In-app
                    - checkbox "In-app" [checked] [ref=e533]
                  - generic [ref=e534]:
                    - generic [ref=e535]: Email (future-ready)
                    - checkbox "Email (future-ready)" [ref=e536]
                  - generic [ref=e537]:
                    - generic [ref=e538]: SMS (future-ready)
                    - checkbox "SMS (future-ready)" [ref=e539]
                  - button "Save Notification Preferences" [ref=e541]
          - generic [ref=e542]:
            - heading "Private Activity History" [level=3] [ref=e544]
            - paragraph [ref=e546]: No activity entries yet.
          - generic [ref=e548]: Listing renewed and visible to buyers again.
        - generic [ref=e549]:
          - generic [ref=e551]:
            - img [ref=e553]
            - paragraph [ref=e558]: 900+
            - paragraph [ref=e559]: Community Members
          - generic [ref=e561]:
            - img [ref=e563]
            - paragraph [ref=e567]: Growing
            - paragraph [ref=e568]: Trading Community
          - generic [ref=e570]:
            - img [ref=e572]
            - paragraph [ref=e575]: Professional
            - paragraph [ref=e576]: Support
          - generic [ref=e578]:
            - img [ref=e580]
            - paragraph [ref=e583]: Transparent
            - paragraph [ref=e584]: Process
        - generic [ref=e585]:
          - heading "FAQ" [level=2] [ref=e586]
          - generic [ref=e587]:
            - group [ref=e588]:
              - generic "How does Alpha Exchange work?" [ref=e589] [cursor=pointer]:
                - text: How does Alpha Exchange work?
                - img [ref=e590]
            - group [ref=e593]:
              - generic "How is the 1% service fee calculated?" [ref=e594] [cursor=pointer]:
                - text: How is the 1% service fee calculated?
                - img [ref=e595]
            - group [ref=e598]:
              - generic "Which USDT networks are supported?" [ref=e599] [cursor=pointer]:
                - text: Which USDT networks are supported?
                - img [ref=e600]
            - group [ref=e603]:
              - generic "How do I create a listing?" [ref=e604] [cursor=pointer]:
                - text: How do I create a listing?
                - img [ref=e605]
            - group [ref=e608]:
              - generic "How long does a transaction usually take?" [ref=e609] [cursor=pointer]:
                - text: How long does a transaction usually take?
                - img [ref=e610]
        - generic [ref=e615]:
          - heading "Ready to Exchange USDT?" [level=3] [ref=e616]
          - paragraph [ref=e617]: Join the Alpha Traders community and experience a professional marketplace connecting buyers and sellers through Alpha Exchange.
          - generic [ref=e618]:
            - link "Start Trading" [ref=e619] [cursor=pointer]:
              - /url: "#marketplace"
              - button "Start Trading" [ref=e620]
            - link "Contact on WhatsApp" [ref=e621] [cursor=pointer]:
              - /url: https://wa.me/972525967649
              - button "Contact on WhatsApp" [ref=e622]:
                - img [ref=e623]
                - text: Contact on WhatsApp
    - contentinfo [ref=e625]:
      - generic [ref=e626]:
        - generic [ref=e627]:
          - generic [ref=e628]:
            - img "Alpha Traders logo" [ref=e629]
            - heading "𝔸𝕝𝕡𝕙𝕒 𝕋𝕣𝕒𝕕𝕖𝕣𝕤" [level=3] [ref=e630]
          - paragraph [ref=e631]: Free premium Arabic trading education with structured, disciplined learning.
        - generic [ref=e632]:
          - link "Academy" [ref=e633] [cursor=pointer]:
            - /url: /en/academy
          - link "Lessons" [ref=e634] [cursor=pointer]:
            - /url: /en/lessons/trend-and-range-context
          - link "⇄ Alpha Exchange" [ref=e635] [cursor=pointer]:
            - /url: /en/usdt-exchange
        - generic [ref=e636]:
          - paragraph [ref=e637]: 2026 © All rights reserved to 𝔸𝕝𝕡𝕙𝕒 𝕋𝕣𝕒𝕕𝕖𝕣𝕤
          - paragraph [ref=e638]: Built for disciplined learning, not market noise.
          - 'link "WhatsApp: Available now" [ref=e640] [cursor=pointer]':
            - /url: https://wa.me/972525967649
            - img [ref=e641]
            - text: "WhatsApp: Available now"
          - 'link "Instagram: @mark.jozen" [ref=e644] [cursor=pointer]':
            - /url: https://www.instagram.com/mark.jozen/
            - img [ref=e645]
            - text: "Instagram: @mark.jozen"
          - 'link "TikTok: @Mark.Jozen" [ref=e649] [cursor=pointer]':
            - /url: https://www.tiktok.com/@mark.jozen
            - img [ref=e650]
            - text: "TikTok: @Mark.Jozen"
  - button "Open Next.js Dev Tools" [ref=e658] [cursor=pointer]:
    - img [ref=e659]
  - alert [ref=e662]
```

# Test source

```ts
  1   | import { request, test, expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
  2   | import type { AlphaExchangeDb } from "@/types/alpha-exchange";
  3   | 
  4   | const OWNER_EMAIL = "jozenmark834@yahoo.com";
  5   | const OWNER_PASSWORD = "Roflxd123!";
  6   | const SELLER_EMAIL = "test123@guest.local";
  7   | const SELLER_PASSWORD = "test123";
  8   | const TEST_EVIDENCE_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9Wl8cAAAAASUVORK5CYII=";
  9   | const TEST_SUPPORT_HEADERS = {
  10  |   "x-alpha-test-support": "enabled",
  11  | };
  12  | 
  13  | async function readRuntimeDb(request: APIRequestContext) {
> 14  |   const response = await request.get("/api/testing/alpha-exchange-state", { headers: TEST_SUPPORT_HEADERS });
      |                                  ^ TypeError: request.get is not a function
  15  |   expect(response.ok()).toBeTruthy();
  16  |   return (await response.json()) as Record<string, unknown>;
  17  | }
  18  | 
  19  | async function writeRuntimeDb(request: APIRequestContext, db: Record<string, unknown>) {
  20  |   const response = await request.put("/api/testing/alpha-exchange-state", {
  21  |     headers: TEST_SUPPORT_HEADERS,
  22  |     data: db as AlphaExchangeDb,
  23  |   });
  24  |   expect(response.ok()).toBeTruthy();
  25  | }
  26  | 
  27  | async function updateRuntimeDb(request: APIRequestContext, mutator: (db: Record<string, unknown>) => void) {
  28  |   const db = await readRuntimeDb(request);
  29  |   mutator(db);
  30  |   await writeRuntimeDb(request, db);
  31  | }
  32  | 
  33  | async function waitForPersistence() {
  34  |   await new Promise((resolve) => setTimeout(resolve, 450));
  35  | }
  36  | 
  37  | async function login(page: Page, email: string, password: string) {
  38  |   const existingSession = await page.request.get("/api/auth/me");
  39  |   if (existingSession.ok()) {
  40  |     const existingPayload = (await existingSession.json()) as { user?: { id?: string } | null };
  41  |     if (existingPayload.user?.id) {
  42  |       return;
  43  |     }
  44  |   }
  45  |   await page.goto("/en/login");
  46  |   if (!page.url().includes("/login")) {
  47  |     return;
  48  |   }
  49  |   await page.waitForSelector('form[data-hydrated="true"]', { timeout: 15_000 });
  50  |   await page.getByPlaceholder("Email").fill(email);
  51  |   await page.getByPlaceholder("Password").fill(password);
  52  |   await page.locator('form[data-hydrated="true"]').getByRole("button", { name: /login|sign in/i }).click();
  53  |   await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 20_000 });
  54  | }
  55  | 
  56  | async function createSession(browser: Browser, email: string, password: string) {
  57  |   const context = await browser.newContext();
  58  |   const page = await context.newPage();
  59  |   await login(page, email, password);
  60  |   return { context, page };
  61  | }
  62  | 
  63  | async function resetLifecycleFixtures() {
  64  |   const api = await request.newContext({ baseURL: "http://localhost:3000" });
  65  |   const db = await readRuntimeDb(api);
  66  |   const users = Array.isArray(db.users) ? (db.users as Array<Record<string, unknown>>) : [];
  67  |   const seller = users.find((user) => String(user.email ?? "").toLowerCase() === SELLER_EMAIL);
  68  |   const owner = users.find((user) => String(user.email ?? "").toLowerCase() === OWNER_EMAIL);
  69  |   if (!seller || !owner) {
  70  |     throw new Error("Required test accounts are missing from the runtime database.");
  71  |   }
  72  | 
  73  |   const sellerId = String(seller.id);
  74  |   const ownerId = String(owner.id);
  75  |   const relatedUserIds = new Set([sellerId, ownerId]);
  76  |   const relatedListingIds = new Set(
  77  |     (Array.isArray(db.marketplaceListings) ? (db.marketplaceListings as Array<Record<string, unknown>>) : [])
  78  |       .filter((listing) => relatedUserIds.has(String(listing.sellerId ?? "")))
  79  |       .map((listing) => String(listing.id)),
  80  |   );
  81  |   const relatedRequestIds = new Set(
  82  |     (Array.isArray(db.purchaseRequests) ? (db.purchaseRequests as Array<Record<string, unknown>>) : [])
  83  |       .filter((request) => relatedUserIds.has(String(request.sellerId ?? "")) || relatedUserIds.has(String(request.buyerId ?? "")) || relatedListingIds.has(String(request.listingId ?? "")))
  84  |       .map((request) => String(request.id)),
  85  |   );
  86  | 
  87  |   db.marketplaceListings = (Array.isArray(db.marketplaceListings) ? (db.marketplaceListings as Array<Record<string, unknown>>) : []).filter(
  88  |     (listing) => !relatedUserIds.has(String(listing.sellerId ?? "")),
  89  |   );
  90  |   db.purchaseRequests = (Array.isArray(db.purchaseRequests) ? (db.purchaseRequests as Array<Record<string, unknown>>) : []).filter(
  91  |     (request) => !relatedRequestIds.has(String(request.id ?? "")),
  92  |   );
  93  |   db.commissionRecords = (Array.isArray(db.commissionRecords) ? (db.commissionRecords as Array<Record<string, unknown>>) : []).filter(
  94  |     (record) => !relatedRequestIds.has(String(record.purchaseRequestId ?? "")) && !relatedUserIds.has(String(record.sellerId ?? "")),
  95  |   );
  96  |   db.tradeEvidenceFiles = (Array.isArray(db.tradeEvidenceFiles) ? (db.tradeEvidenceFiles as Array<Record<string, unknown>>) : []).filter(
  97  |     (entry) => !relatedRequestIds.has(String(entry.purchaseRequestId ?? "")),
  98  |   );
  99  |   db.notifications = (Array.isArray(db.notifications) ? (db.notifications as Array<Record<string, unknown>>) : []).filter(
  100 |     (entry) => !relatedUserIds.has(String(entry.userId ?? "")),
  101 |   );
  102 |   db.activityLog = (Array.isArray(db.activityLog) ? (db.activityLog as Array<Record<string, unknown>>) : []).filter(
  103 |     (entry) => !relatedUserIds.has(String(entry.userId ?? "")),
  104 |   );
  105 |   db.auditLogs = (Array.isArray(db.auditLogs) ? (db.auditLogs as Array<Record<string, unknown>>) : []).filter(
  106 |     (entry) => !relatedRequestIds.has(String(entry.purchaseRequestId ?? "")) && !relatedListingIds.has(String(entry.listingId ?? "")),
  107 |   );
  108 |   db.users = users.map((user) => {
  109 |     if (String(user.id) !== sellerId) return user;
  110 |     return {
  111 |       ...user,
  112 |       availabilityStatus: "available",
  113 |       onlineStatus: "online",
  114 |       lastActiveAt: new Date().toISOString(),
```