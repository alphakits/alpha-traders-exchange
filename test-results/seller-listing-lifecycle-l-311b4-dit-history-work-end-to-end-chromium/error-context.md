# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: seller-listing-lifecycle.spec.ts >> listing expiration, renewal, vacation mode, timeout notifications, and audit history work end-to-end
- Location: e2e\seller-listing-lifecycle.spec.ts:293:5

# Error details

```
Error: expect(received).toBeTruthy()

Received: false
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
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
            - generic [ref=e29]: "10"
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
              - paragraph [ref=e170]: "Trust Score: 64.1"
              - paragraph [ref=e171]: "Completed Trades: 2"
              - paragraph [ref=e172]: "Average Rating: 5.00"
              - paragraph [ref=e173]: "Response Time: 5 min"
              - paragraph [ref=e174]: "Last Active: 6 min ago"
              - paragraph [ref=e175]: "USDT Available: 500"
              - paragraph [ref=e176]:
                - text: "Price:"
                - generic [ref=e177]: 3.65 ILS
              - paragraph [ref=e178]: "Payment Methods: Bank transfer"
              - paragraph [ref=e179]: "Networks: TRC20"
              - paragraph [ref=e180]:
                - text: "Min/Max Trade:"
                - generic [ref=e181]: 50 / 500
              - paragraph [ref=e182]: "Updated: 20/07/2026, 15:26:47"
              - generic [ref=e183]:
                - paragraph [ref=e184]: ⭐ 5.00 Rating
                - paragraph [ref=e185]: 2 Successful Trades
                - paragraph [ref=e186]: 100% Success Rate
                - paragraph [ref=e187]: Member Since 2026
              - generic [ref=e189]: 💎 Top Rated
              - button "Open seller profile for test123" [ref=e190]: View Seller Profile
        - generic [ref=e191]:
          - heading "Why Alpha Exchange" [level=2] [ref=e192]
          - generic [ref=e193]:
            - generic [ref=e194]:
              - generic [ref=e196]:
                - img [ref=e198]
                - heading "Trusted Community" [level=3] [ref=e201]
              - paragraph [ref=e203]: A serious community built on clear, professional trade coordination.
            - generic [ref=e204]:
              - generic [ref=e206]:
                - img [ref=e208]
                - heading "Transparent 1% Service Fee" [level=3] [ref=e211]
              - paragraph [ref=e213]: A simple, transparent 1% fee for each facilitated marketplace transaction.
            - generic [ref=e214]:
              - generic [ref=e216]:
                - img [ref=e218]
                - heading "Professional Coordination" [level=3] [ref=e224]
              - paragraph [ref=e226]: Alpha Traders coordinates each side through a clear transaction flow.
            - generic [ref=e227]:
              - generic [ref=e229]:
                - img [ref=e231]
                - heading "Fast Communication" [level=3] [ref=e234]
              - paragraph [ref=e236]: Direct and fast communication to keep transaction flow efficient.
            - generic [ref=e237]:
              - generic [ref=e239]:
                - img [ref=e241]
                - heading "Multiple USDT Networks" [level=3] [ref=e246]
              - paragraph [ref=e248]: Support for common USDT networks based on buyer and seller preferences.
            - generic [ref=e249]:
              - generic [ref=e251]:
                - img [ref=e253]
                - heading "Premium Customer Experience" [level=3] [ref=e256]
              - paragraph [ref=e258]: A premium, confidence-first experience with clear process visibility.
        - generic [ref=e259]:
          - generic [ref=e260]:
            - generic [ref=e261]:
              - heading "Become an Approved Seller" [level=3] [ref=e262]
              - paragraph [ref=e263]: Seller access is granted only after manual review and approval.
            - generic [ref=e264]:
              - generic [ref=e265]:
                - generic [ref=e266]:
                  - generic [ref=e267]: Application
                  - generic [ref=e268]: ↓
                  - generic [ref=e269]: Review
                  - generic [ref=e270]: ↓
                  - generic [ref=e271]: Approval
                - paragraph [ref=e272]: "Current Status: Approved"
              - generic [ref=e273]:
                - textbox "Full Name" [ref=e274]: test123
                - textbox "Email" [ref=e275]: test123@guest.local
                - textbox "WhatsApp Number" [ref=e276]: "0000000000"
                - combobox [ref=e277]:
                  - option "TRC20" [selected]
                  - option "ERC20"
                  - option "BEP20"
                  - option "SOL"
                - textbox "Expected Monthly Trading Volume" [ref=e278]
                - textbox "Additional Notes" [ref=e279]
                - button "Apply for Approval" [ref=e280]
          - generic [ref=e281]:
            - generic [ref=e282]:
              - heading "Find an Approved Seller" [level=3] [ref=e283]
              - paragraph [ref=e284]: Tell us how much USDT you need and Alpha Traders will help connect you with an available Approved Seller.
            - generic [ref=e286]:
              - spinbutton [ref=e287]
              - combobox [ref=e288]:
                - option "TRC20" [selected]
                - option "ERC20"
                - option "BEP20"
                - option "SOL"
              - textbox "WhatsApp Number" [ref=e289]
              - textbox "Additional Notes" [ref=e290]
              - button "Find Available Sellers" [ref=e291]
        - generic [ref=e292]:
          - generic [ref=e293]:
            - generic [ref=e295]:
              - paragraph [ref=e296]:
                - img [ref=e297]
                - text: Profile Views
              - heading "268" [level=3] [ref=e302]
            - generic [ref=e304]:
              - paragraph [ref=e305]:
                - img [ref=e306]
                - text: Listing Views
              - heading "1,484" [level=3] [ref=e309]
            - generic [ref=e311]:
              - paragraph [ref=e312]:
                - img [ref=e313]
                - text: Trade Requests
              - heading "2" [level=3] [ref=e315]
            - generic [ref=e317]:
              - paragraph [ref=e318]:
                - img [ref=e319]
                - text: Completed Trades
              - heading "2" [level=3] [ref=e325]
            - generic [ref=e327]:
              - paragraph [ref=e328]:
                - img [ref=e329]
                - text: Success Rate
              - heading "100.0%" [level=3] [ref=e332]
            - generic [ref=e334]:
              - paragraph [ref=e335]:
                - img [ref=e336]
                - text: Monthly Growth
              - heading "-0.8%" [level=3] [ref=e339]
            - generic [ref=e341]:
              - paragraph [ref=e342]:
                - img [ref=e343]
                - text: Estimated Commission Paid
              - heading "₪37.00" [level=3] [ref=e346]
            - generic [ref=e348]:
              - paragraph [ref=e349]:
                - img [ref=e350]
                - text: Revenue Generated
              - heading "₪3700.00" [level=3] [ref=e353]
            - generic [ref=e355]:
              - paragraph [ref=e356]:
                - img [ref=e357]
                - text: Repeat Buyers
              - heading "0" [level=3] [ref=e362]
            - generic [ref=e364]:
              - paragraph [ref=e365]:
                - img [ref=e366]
                - text: Average Trade Size
              - heading "₪1850.00" [level=3] [ref=e372]
            - generic [ref=e374]:
              - paragraph [ref=e375]:
                - img [ref=e376]
                - text: Response Time
              - heading "5 min" [level=3] [ref=e379]
            - generic [ref=e381]:
              - paragraph [ref=e382]:
                - img [ref=e383]
                - text: Seller Level
              - heading "Bronze" [level=3] [ref=e385]
          - generic [ref=e387]:
            - generic [ref=e388]:
              - heading "Create Listing" [level=3] [ref=e389]
              - paragraph [ref=e390]: Create a live listing with a maximum of 2 open listings at the same time.
            - generic [ref=e391]:
              - generic [ref=e392]:
                - paragraph [ref=e393]:
                  - text: "Open listing slots:"
                  - generic [ref=e394]: 1/2
                - paragraph [ref=e395]: "Trades in progress: 0 • Pending commissions: 2"
                - paragraph [ref=e396]: You have commission payments pending. Clear them before creating a new listing.
              - generic [ref=e397]:
                - textbox "Available Amount" [ref=e398]
                - textbox "Price" [ref=e399]
                - textbox "Currency (e.g. ILS)" [ref=e400]: ILS
                - combobox [ref=e401]:
                  - option "TRC20" [selected]
                  - option "ERC20"
                  - option "BEP20"
                  - option "SOL"
                - textbox "Payment Methods (comma separated)" [ref=e402]: Bank transfer
                - textbox "Minimum Trade" [ref=e403]: "0"
                - textbox "Maximum Trade" [ref=e404]
                - combobox [ref=e405]:
                  - option "Expires in 1 hour"
                  - option "Expires in 6 hours"
                  - option "Expires in 12 hours"
                  - option "Expires in 24 hours" [selected]
                - textbox "Response Time (e.g. 5 min)" [ref=e406]: 5 min
                - textbox "Photo URLs (comma separated)" [ref=e407]
                - textbox "Optional Notes" [ref=e408]
                - textbox "Seller Description" [ref=e409]
                - button "Create Live Listing" [ref=e411]
          - generic [ref=e412]:
            - generic [ref=e413]:
              - heading "My Listings" [level=3] [ref=e414]
              - paragraph [ref=e415]: Manage all of your approved seller listings.
            - generic [ref=e416]:
              - generic [ref=e417]:
                - generic [ref=e418]:
                  - paragraph [ref=e419]: "Status: Completed"
                  - paragraph [ref=e420]: "Available Amount: 0"
                  - paragraph [ref=e421]: "Original Amount: 1000"
                  - paragraph [ref=e422]: "Price: 3.70"
                  - paragraph [ref=e423]: "Network: TRC20"
                  - paragraph [ref=e424]: "Views: 693"
                  - paragraph [ref=e425]: "Purchase Requests: 2"
                  - paragraph [ref=e426]: "Created Date: 20/07/2026"
                - generic [ref=e427]:
                  - button "Edit" [disabled]:
                    - img
                    - text: Edit
                  - button "Close Listing" [disabled]:
                    - img
                    - text: Close Listing
                  - button "Duplicate Listing" [ref=e428]:
                    - img [ref=e429]
                    - text: Duplicate Listing
              - generic [ref=e432]:
                - generic [ref=e433]:
                  - paragraph [ref=e434]: "Status: Active"
                  - paragraph [ref=e435]: "Available Amount: 500"
                  - paragraph [ref=e436]: "Original Amount: 500"
                  - paragraph [ref=e437]: "Price: 3.65"
                  - paragraph [ref=e438]: "Network: TRC20"
                  - paragraph [ref=e439]: "Views: 791"
                  - paragraph [ref=e440]: "Purchase Requests: 0"
                  - paragraph [ref=e441]: "Created Date: 20/07/2026"
                - generic [ref=e442]:
                  - button "Edit" [ref=e443]:
                    - img [ref=e444]
                    - text: Edit
                  - button "Pause" [ref=e446]:
                    - img [ref=e447]
                    - text: Pause
                  - button "Close Listing" [ref=e449]:
                    - img [ref=e450]
                    - text: Close Listing
                  - button "Duplicate Listing" [ref=e453]:
                    - img [ref=e454]
                    - text: Duplicate Listing
          - generic [ref=e457]:
            - generic [ref=e458]:
              - heading "Purchase Requests" [level=3] [ref=e459]
              - paragraph [ref=e460]: Manage incoming buyer purchase requests.
            - generic [ref=e461]:
              - generic [ref=e462]:
                - textbox "Search by trade ID, buyer, listing..." [ref=e463]
                - combobox [ref=e464]:
                  - 'option "Status: All" [selected]'
                  - option "Pending"
                  - option "Accepted"
                  - option "Payment Sent"
                  - option "USDT Sent"
                  - option "Review Open"
                  - option "Declined"
                  - option "Cancelled"
              - generic [ref=e465]:
                - generic [ref=e466]:
                  - paragraph [ref=e467]: "Trade ID: trade-f73a4388-e465-4cfe-9491-3ff1f04ea7fe"
                  - paragraph [ref=e468]: "Buyer Name: Lifecycle Buyer"
                  - paragraph [ref=e469]: "WhatsApp: +972500000000"
                  - paragraph [ref=e470]: "USDT Amount: 300"
                  - paragraph [ref=e471]:
                    - text: "Fiat Amount:"
                    - generic [ref=e472]: 1110.00 ILS
                  - paragraph [ref=e473]: "Network: TRC20"
                  - paragraph [ref=e474]: "Payment Method: Bank transfer"
                  - paragraph [ref=e475]: "Listing: listing-f376f1a5-3903-48af-a0cb-6658f0cfa9a0"
                  - paragraph [ref=e476]: "Submitted: 20/07/2026, 15:26:53"
                  - paragraph [ref=e477]: "Status: Review Open"
                  - paragraph [ref=e478]: "Completed: 20/07/2026, 15:27:07"
                  - paragraph [ref=e479]: "Review Unlocked: 20/07/2026, 15:27:07"
                - generic [ref=e480]:
                  - button "Accept" [disabled]
                  - button "Decline" [disabled]
                  - button "Mark USDT Sent" [disabled]
                  - button "Message Buyer" [ref=e481]:
                    - img [ref=e482]
                    - text: Message Buyer
                - generic [ref=e484]:
                  - paragraph [ref=e485]: Live Trade Status
                  - paragraph [ref=e486]: "Next action: parties can leave/track the trade review."
                  - generic [ref=e487]:
                    - generic [ref=e488]:
                      - generic [ref=e491]: Request submitted
                      - generic [ref=e492]: 15:26
                    - generic [ref=e493]:
                      - generic [ref=e496]: Seller accepted
                      - generic [ref=e497]: 15:26
                    - generic [ref=e498]:
                      - generic [ref=e501]: Buyer payment sent
                      - generic [ref=e502]: 15:27
                    - generic [ref=e503]:
                      - generic [ref=e506]: Seller USDT sent
                      - generic [ref=e507]: 15:27
                    - generic [ref=e508]:
                      - generic [ref=e511]: Buyer completed trade
                      - generic [ref=e512]: 15:27
                    - generic [ref=e513]:
                      - generic [ref=e516]: Review unlocked
                      - generic [ref=e517]: 15:27
                - generic [ref=e518]:
                  - generic [ref=e519]:
                    - paragraph [ref=e520]: Buyer Evidence
                    - link "buyer-proof.png" [ref=e521] [cursor=pointer]:
                      - /url: /api/alpha-exchange/purchase-requests/purchase-a3dd5a63-d7cd-4c11-83a8-1970a46e9c93/evidence/evidence-4a2bac1c-cd91-4414-8734-18142ad913c0
                  - generic [ref=e522]:
                    - paragraph [ref=e523]: Seller Evidence
                    - link "seller-proof.png" [ref=e524] [cursor=pointer]:
                      - /url: /api/alpha-exchange/purchase-requests/purchase-a3dd5a63-d7cd-4c11-83a8-1970a46e9c93/evidence/evidence-14e22695-e260-4251-a9b2-40d8ccad9b3b
                - generic [ref=e525]:
                  - generic [ref=e528]: 15:26 Buyer submitted request
                  - generic [ref=e531]: 15:26 Seller accepted request
                  - generic [ref=e534]: 15:27 Buyer uploaded payment evidence
                  - generic [ref=e537]: 15:27 Buyer marked payment sent
                  - generic [ref=e540]: 15:27 Seller uploaded USDT evidence
                  - generic [ref=e543]: 15:27 Seller marked USDT sent
                  - generic [ref=e546]: 15:27 Buyer confirmed trade completed
                  - generic [ref=e549]: 15:27 Trade locked
                  - generic [ref=e552]: 15:27 Review window unlocked
              - generic [ref=e553]:
                - generic [ref=e554]:
                  - paragraph [ref=e555]: "Trade ID: trade-7242378c-260b-4b32-a6da-968eb4fa6e41"
                  - paragraph [ref=e556]: "Buyer Name: Lifecycle Buyer"
                  - paragraph [ref=e557]: "WhatsApp: +972500000000"
                  - paragraph [ref=e558]: "USDT Amount: 700"
                  - paragraph [ref=e559]:
                    - text: "Fiat Amount:"
                    - generic [ref=e560]: 2590.00 ILS
                  - paragraph [ref=e561]: "Network: TRC20"
                  - paragraph [ref=e562]: "Payment Method: Bank transfer"
                  - paragraph [ref=e563]: "Listing: listing-f376f1a5-3903-48af-a0cb-6658f0cfa9a0"
                  - paragraph [ref=e564]: "Submitted: 20/07/2026, 15:27:07"
                  - paragraph [ref=e565]: "Status: Review Open"
                  - paragraph [ref=e566]: "Completed: 20/07/2026, 15:27:07"
                  - paragraph [ref=e567]: "Review Unlocked: 20/07/2026, 15:27:07"
                - generic [ref=e568]:
                  - button "Accept" [disabled]
                  - button "Decline" [disabled]
                  - button "Mark USDT Sent" [disabled]
                  - button "Message Buyer" [ref=e569]:
                    - img [ref=e570]
                    - text: Message Buyer
                - generic [ref=e572]:
                  - paragraph [ref=e573]: Live Trade Status
                  - paragraph [ref=e574]: "Next action: parties can leave/track the trade review."
                  - generic [ref=e575]:
                    - generic [ref=e576]:
                      - generic [ref=e579]: Request submitted
                      - generic [ref=e580]: 15:27
                    - generic [ref=e581]:
                      - generic [ref=e584]: Seller accepted
                      - generic [ref=e585]: 15:27
                    - generic [ref=e586]:
                      - generic [ref=e589]: Buyer payment sent
                      - generic [ref=e590]: 15:27
                    - generic [ref=e591]:
                      - generic [ref=e594]: Seller USDT sent
                      - generic [ref=e595]: 15:27
                    - generic [ref=e596]:
                      - generic [ref=e599]: Buyer completed trade
                      - generic [ref=e600]: 15:27
                    - generic [ref=e601]:
                      - generic [ref=e604]: Review unlocked
                      - generic [ref=e605]: 15:27
                - generic [ref=e606]:
                  - generic [ref=e607]:
                    - paragraph [ref=e608]: Buyer Evidence
                    - link "buyer-proof.png" [ref=e609] [cursor=pointer]:
                      - /url: /api/alpha-exchange/purchase-requests/purchase-8fc2d5c1-08cf-40b7-ab94-e4c5a13d108c/evidence/evidence-8c94f2fc-3102-4c9e-8356-9de66153eda8
                  - generic [ref=e610]:
                    - paragraph [ref=e611]: Seller Evidence
                    - link "seller-proof.png" [ref=e612] [cursor=pointer]:
                      - /url: /api/alpha-exchange/purchase-requests/purchase-8fc2d5c1-08cf-40b7-ab94-e4c5a13d108c/evidence/evidence-3fc872a3-6ec1-4280-9a46-bdd844e06327
                - generic [ref=e613]:
                  - generic [ref=e616]: 15:27 Buyer submitted request
                  - generic [ref=e619]: 15:27 Seller accepted request
                  - generic [ref=e622]: 15:27 Buyer uploaded payment evidence
                  - generic [ref=e625]: 15:27 Buyer marked payment sent
                  - generic [ref=e628]: 15:27 Seller uploaded USDT evidence
                  - generic [ref=e631]: 15:27 Seller marked USDT sent
                  - generic [ref=e634]: 15:27 Buyer confirmed trade completed
                  - generic [ref=e637]: 15:27 Trade locked
                  - generic [ref=e640]: 15:27 Review window unlocked
          - generic [ref=e641]:
            - generic [ref=e642]:
              - heading "Seller Profile" [level=3] [ref=e644]
              - generic [ref=e645]:
                - generic [ref=e646]:
                  - generic [ref=e647]: t
                  - generic [ref=e648]:
                    - paragraph [ref=e649]: test123
                    - generic [ref=e652]:
                      - img [ref=e653]
                      - generic [ref=e656]: Approved Seller
                - paragraph [ref=e657]: "Member Since: 19/07/2026"
                - paragraph [ref=e658]: "Languages: English"
                - paragraph [ref=e659]: "Preferred Networks: TRC20"
                - paragraph [ref=e660]: "Rating: 5.00"
                - paragraph [ref=e661]:
                  - text: "Success Rate:"
                  - generic [ref=e662]: 100.0%
                - paragraph [ref=e663]: "Completed Trades: 2"
                - paragraph [ref=e664]: "Total USDT Volume: 1,000"
                - paragraph [ref=e665]: "Current Listings: 1"
                - paragraph [ref=e666]: "Average Response Time: 5 min"
                - paragraph [ref=e667]: "Status: Online"
                - paragraph [ref=e668]: "Availability: available"
                - paragraph [ref=e669]: "Last Active: 6 min ago"
                - paragraph [ref=e670]: "Bio: Professional USDT seller on Alpha Exchange."
                - paragraph [ref=e671]: "Trading Experience: Professional trading experience"
                - paragraph [ref=e672]: "Working Hours: Sun-Thu, 09:00-21:00"
                - paragraph [ref=e673]: "Account Status: approved_seller"
                - generic [ref=e675]: 💎 Top Rated
            - generic [ref=e676]:
              - generic [ref=e677]:
                - heading "Private Beta Center" [level=3] [ref=e678]
                - paragraph [ref=e679]: Founding badges, beta announcements, and product feedback.
              - generic [ref=e680]:
                - generic [ref=e682]:
                  - paragraph [ref=e683]: Announcements
                  - paragraph [ref=e684]: No active announcements.
                - generic [ref=e685]:
                  - generic [ref=e686]:
                    - paragraph [ref=e687]: Submit Beta Feedback
                    - combobox [ref=e688]:
                      - option "Bug"
                      - option "Suggestion" [selected]
                      - option "Confusing UX"
                      - option "Feature Request"
                      - option "Performance"
                      - option "Other"
                    - textbox "Share your feedback..." [ref=e689]
                    - button "Submit Feedback" [ref=e690]
                  - generic [ref=e691]:
                    - paragraph [ref=e692]: My Feedback
                    - paragraph [ref=e693]: No feedback submitted yet.
            - generic [ref=e694]:
              - heading "Settings" [level=3] [ref=e696]
              - generic [ref=e697]:
                - generic [ref=e698]:
                  - textbox "Profile" [ref=e699]: test123
                  - textbox "WhatsApp" [ref=e700]: "0000000000"
                  - textbox "Languages (comma separated)" [ref=e701]: English
                  - combobox [ref=e702]:
                    - 'option "Preferred Network: TRC20" [selected]'
                    - 'option "Preferred Network: ERC20"'
                    - 'option "Preferred Network: BEP20"'
                    - 'option "Preferred Network: SOL"'
                  - textbox "Profile Photo URL" [ref=e703]
                  - textbox "Cover Banner URL" [ref=e704]
                  - textbox "Bio" [ref=e705]
                  - textbox "Trading Experience" [ref=e706]
                  - textbox "Working Hours" [ref=e707]
                  - textbox "Preferred Payment Methods (comma separated)" [ref=e708]: Bank transfer
                  - textbox "Country" [ref=e709]: Israel
                  - textbox "City (optional)" [ref=e710]
                  - combobox [ref=e711]:
                    - 'option "Status: Online" [selected]'
                    - 'option "Status: Offline"'
                  - combobox [ref=e712]:
                    - 'option "Availability: Available" [selected]'
                    - 'option "Availability: Away"'
                    - 'option "Availability: Vacation Mode"'
                  - button "Save Profile" [ref=e713]
                - generic [ref=e714]:
                  - textbox "Current Password" [ref=e715]
                  - textbox "New Password" [ref=e716]
                  - button "Update Password" [ref=e717]
                - generic [ref=e718]:
                  - paragraph [ref=e719]: Notification Preferences
                  - generic [ref=e720]:
                    - generic [ref=e721]: In-app
                    - checkbox "In-app" [checked] [ref=e722]
                  - generic [ref=e723]:
                    - generic [ref=e724]: Email (future-ready)
                    - checkbox "Email (future-ready)" [ref=e725]
                  - generic [ref=e726]:
                    - generic [ref=e727]: SMS (future-ready)
                    - checkbox "SMS (future-ready)" [ref=e728]
                  - button "Save Notification Preferences" [ref=e730]
          - generic [ref=e731]:
            - heading "Private Activity History" [level=3] [ref=e733]
            - paragraph [ref=e735]: No activity entries yet.
        - generic [ref=e736]:
          - generic [ref=e738]:
            - img [ref=e740]
            - paragraph [ref=e745]: 900+
            - paragraph [ref=e746]: Community Members
          - generic [ref=e748]:
            - img [ref=e750]
            - paragraph [ref=e754]: Growing
            - paragraph [ref=e755]: Trading Community
          - generic [ref=e757]:
            - img [ref=e759]
            - paragraph [ref=e762]: Professional
            - paragraph [ref=e763]: Support
          - generic [ref=e765]:
            - img [ref=e767]
            - paragraph [ref=e770]: Transparent
            - paragraph [ref=e771]: Process
        - generic [ref=e772]:
          - heading "FAQ" [level=2] [ref=e773]
          - generic [ref=e774]:
            - group [ref=e775]:
              - generic "How does Alpha Exchange work?" [ref=e776] [cursor=pointer]:
                - text: How does Alpha Exchange work?
                - img [ref=e777]
            - group [ref=e780]:
              - generic "How is the 1% service fee calculated?" [ref=e781] [cursor=pointer]:
                - text: How is the 1% service fee calculated?
                - img [ref=e782]
            - group [ref=e785]:
              - generic "Which USDT networks are supported?" [ref=e786] [cursor=pointer]:
                - text: Which USDT networks are supported?
                - img [ref=e787]
            - group [ref=e790]:
              - generic "How do I create a listing?" [ref=e791] [cursor=pointer]:
                - text: How do I create a listing?
                - img [ref=e792]
            - group [ref=e795]:
              - generic "How long does a transaction usually take?" [ref=e796] [cursor=pointer]:
                - text: How long does a transaction usually take?
                - img [ref=e797]
        - generic [ref=e802]:
          - heading "Ready to Exchange USDT?" [level=3] [ref=e803]
          - paragraph [ref=e804]: Join the Alpha Traders community and experience a professional marketplace connecting buyers and sellers through Alpha Exchange.
          - generic [ref=e805]:
            - link "Start Trading" [ref=e806] [cursor=pointer]:
              - /url: "#marketplace"
              - button "Start Trading" [ref=e807]
            - link "Contact on WhatsApp" [ref=e808] [cursor=pointer]:
              - /url: https://wa.me/972525967649
              - button "Contact on WhatsApp" [ref=e809]:
                - img [ref=e810]
                - text: Contact on WhatsApp
    - contentinfo [ref=e812]:
      - generic [ref=e813]:
        - generic [ref=e814]:
          - generic [ref=e815]:
            - img "Alpha Traders logo" [ref=e816]
            - heading "𝔸𝕝𝕡𝕙𝕒 𝕋𝕣𝕒𝕕𝕖𝕣𝕤" [level=3] [ref=e817]
          - paragraph [ref=e818]: Free premium Arabic trading education with structured, disciplined learning.
        - generic [ref=e819]:
          - link "Academy" [ref=e820] [cursor=pointer]:
            - /url: /en/academy
          - link "Lessons" [ref=e821] [cursor=pointer]:
            - /url: /en/lessons/trend-and-range-context
          - link "⇄ Alpha Exchange" [ref=e822] [cursor=pointer]:
            - /url: /en/usdt-exchange
        - generic [ref=e823]:
          - paragraph [ref=e824]: 2026 © All rights reserved to 𝔸𝕝𝕡𝕙𝕒 𝕋𝕣𝕒𝕕𝕖𝕣𝕤
          - paragraph [ref=e825]: Built for disciplined learning, not market noise.
          - 'link "WhatsApp: Available now" [ref=e827] [cursor=pointer]':
            - /url: https://wa.me/972525967649
            - img [ref=e828]
            - text: "WhatsApp: Available now"
          - 'link "Instagram: @mark.jozen" [ref=e831] [cursor=pointer]':
            - /url: https://www.instagram.com/mark.jozen/
            - img [ref=e832]
            - text: "Instagram: @mark.jozen"
          - 'link "TikTok: @Mark.Jozen" [ref=e836] [cursor=pointer]':
            - /url: https://www.tiktok.com/@mark.jozen
            - img [ref=e837]
            - text: "TikTok: @Mark.Jozen"
  - button "Open Next.js Dev Tools" [ref=e845] [cursor=pointer]:
    - img [ref=e846]
  - alert [ref=e849]
```

# Test source

```ts
  58  |   const users = Array.isArray(db.users) ? (db.users as Array<Record<string, unknown>>) : [];
  59  |   const seller = users.find((user) => String(user.email ?? "").toLowerCase() === SELLER_EMAIL);
  60  |   const owner = users.find((user) => String(user.email ?? "").toLowerCase() === OWNER_EMAIL);
  61  |   if (!seller || !owner) {
  62  |     throw new Error("Required test accounts are missing from the runtime database.");
  63  |   }
  64  | 
  65  |   const sellerId = String(seller.id);
  66  |   const ownerId = String(owner.id);
  67  |   const relatedUserIds = new Set([sellerId, ownerId]);
  68  |   const relatedListingIds = new Set(
  69  |     (Array.isArray(db.marketplaceListings) ? (db.marketplaceListings as Array<Record<string, unknown>>) : [])
  70  |       .filter((listing) => relatedUserIds.has(String(listing.sellerId ?? "")))
  71  |       .map((listing) => String(listing.id)),
  72  |   );
  73  |   const relatedRequestIds = new Set(
  74  |     (Array.isArray(db.purchaseRequests) ? (db.purchaseRequests as Array<Record<string, unknown>>) : [])
  75  |       .filter((request) => relatedUserIds.has(String(request.sellerId ?? "")) || relatedUserIds.has(String(request.buyerId ?? "")) || relatedListingIds.has(String(request.listingId ?? "")))
  76  |       .map((request) => String(request.id)),
  77  |   );
  78  | 
  79  |   db.marketplaceListings = (Array.isArray(db.marketplaceListings) ? (db.marketplaceListings as Array<Record<string, unknown>>) : []).filter(
  80  |     (listing) => !relatedUserIds.has(String(listing.sellerId ?? "")),
  81  |   );
  82  |   db.purchaseRequests = (Array.isArray(db.purchaseRequests) ? (db.purchaseRequests as Array<Record<string, unknown>>) : []).filter(
  83  |     (request) => !relatedRequestIds.has(String(request.id ?? "")),
  84  |   );
  85  |   db.commissionRecords = (Array.isArray(db.commissionRecords) ? (db.commissionRecords as Array<Record<string, unknown>>) : []).filter(
  86  |     (record) => !relatedRequestIds.has(String(record.purchaseRequestId ?? "")) && !relatedUserIds.has(String(record.sellerId ?? "")),
  87  |   );
  88  |   db.tradeEvidenceFiles = (Array.isArray(db.tradeEvidenceFiles) ? (db.tradeEvidenceFiles as Array<Record<string, unknown>>) : []).filter(
  89  |     (entry) => !relatedRequestIds.has(String(entry.purchaseRequestId ?? "")),
  90  |   );
  91  |   db.notifications = (Array.isArray(db.notifications) ? (db.notifications as Array<Record<string, unknown>>) : []).filter(
  92  |     (entry) => !relatedUserIds.has(String(entry.userId ?? "")),
  93  |   );
  94  |   db.activityLog = (Array.isArray(db.activityLog) ? (db.activityLog as Array<Record<string, unknown>>) : []).filter(
  95  |     (entry) => !relatedUserIds.has(String(entry.userId ?? "")),
  96  |   );
  97  |   db.auditLogs = (Array.isArray(db.auditLogs) ? (db.auditLogs as Array<Record<string, unknown>>) : []).filter(
  98  |     (entry) => !relatedRequestIds.has(String(entry.purchaseRequestId ?? "")) && !relatedListingIds.has(String(entry.listingId ?? "")),
  99  |   );
  100 |   db.users = users.map((user) => {
  101 |     if (String(user.id) !== sellerId) return user;
  102 |     return {
  103 |       ...user,
  104 |       availabilityStatus: "available",
  105 |       onlineStatus: "online",
  106 |       lastActiveAt: new Date().toISOString(),
  107 |     };
  108 |   });
  109 | 
  110 |   await writeRuntimeDb(db);
  111 |   await waitForPersistence();
  112 | }
  113 | 
  114 | async function uploadEvidence(request: APIRequestContext, requestId: string, side: "buyer" | "seller") {
  115 |   const response = await request.post(`/api/alpha-exchange/purchase-requests/${requestId}/evidence`, {
  116 |     data: {
  117 |       side,
  118 |       fileName: `${side}-proof.png`,
  119 |       mimeType: "image/png",
  120 |       sizeBytes: Buffer.from(TEST_EVIDENCE_BASE64, "base64").length,
  121 |       fileData: `data:image/png;base64,${TEST_EVIDENCE_BASE64}`,
  122 |     },
  123 |   });
  124 |   expect(response.ok()).toBeTruthy();
  125 | }
  126 | 
  127 | async function createRequest(request: APIRequestContext, listingId: string, usdtAmount: string) {
  128 |   const response = await request.post("/api/alpha-exchange/purchase-requests", {
  129 |     data: {
  130 |       listingId,
  131 |       usdtAmount,
  132 |       buyerName: "Lifecycle Buyer",
  133 |       buyerWhatsapp: "+972500000000",
  134 |       buyerNotes: `Buying ${usdtAmount} USDT`,
  135 |     },
  136 |   });
  137 |   expect(response.ok()).toBeTruthy();
  138 |   return (await response.json()) as { purchase: { id: string } };
  139 | }
  140 | 
  141 | async function createListing(request: APIRequestContext, input: { availableAmount: string; price: string; minimumTrade?: string; maximumTrade?: string }) {
  142 |   const response = await request.post("/api/alpha-exchange/listings", {
  143 |     data: {
  144 |       availableAmount: input.availableAmount,
  145 |       price: input.price,
  146 |       currency: "ILS",
  147 |       network: "TRC20",
  148 |       paymentMethods: ["Bank transfer"],
  149 |       minimumTrade: input.minimumTrade ?? "50",
  150 |       maximumTrade: input.maximumTrade ?? input.availableAmount,
  151 |       expirationHours: 24,
  152 |       notes: "",
  153 |       sellerDescription: "",
  154 |       responseTime: "5 min",
  155 |       photos: [],
  156 |     },
  157 |   });
> 158 |   expect(response.ok()).toBeTruthy();
      |                         ^ Error: expect(received).toBeTruthy()
  159 |   return (await response.json()) as { listing: { id: string; status: string; expiresAt?: string } };
  160 | }
  161 | 
  162 | async function getDbNotificationsForEmail(email: string) {
  163 |   const db = await readRuntimeDb();
  164 |   const users = Array.isArray(db.users) ? (db.users as Array<Record<string, unknown>>) : [];
  165 |   const user = users.find((entry) => String(entry.email ?? "").toLowerCase() === email.toLowerCase());
  166 |   if (!user) throw new Error(`Notification user ${email} not found.`);
  167 |   const userId = String(user.id);
  168 |   const notifications = Array.isArray(db.notifications) ? (db.notifications as Array<Record<string, unknown>>) : [];
  169 |   return notifications
  170 |     .filter((entry) => String(entry.userId ?? "") === userId)
  171 |     .map((entry) => ({
  172 |       title: String(entry.title ?? ""),
  173 |       message: String(entry.message ?? ""),
  174 |     }));
  175 | }
  176 | 
  177 | async function getAdminPrep(request: APIRequestContext) {
  178 |   const response = await request.get("/api/alpha-exchange/admin-prep");
  179 |   expect(response.ok()).toBeTruthy();
  180 |   return (await response.json()) as {
  181 |     listings: Array<{ id: string; status: string; expiresAt?: string; expiredAt?: string; lastRenewedAt?: string }>;
  182 |     purchaseRequests: Array<{ id: string; listingId: string; status: string; timedOutAt?: string; timeoutReason?: string }>;
  183 |     auditLogs: Array<{ action: string; listingId?: string; purchaseRequestId?: string; details?: string; reason?: string }>;
  184 |     notifications: Array<{ userId: string; title: string; message: string; relatedListingId?: string; relatedTradeId?: string }>;
  185 |   };
  186 | }
  187 | 
  188 | async function expectOkWithBody(response: Awaited<ReturnType<APIRequestContext["get"]>>, label: string) {
  189 |   if (!response.ok()) {
  190 |     throw new Error(`${label} failed with ${response.status()}: ${await response.text()}`);
  191 |   }
  192 | }
  193 | 
  194 | test.describe.configure({ mode: "serial" });
  195 | 
  196 | test("seller listing lifecycle is enforced end-to-end", async ({ browser }) => {
  197 |   test.setTimeout(60_000);
  198 |   await resetLifecycleFixtures();
  199 | 
  200 |   const seller = await createSession(browser, SELLER_EMAIL, SELLER_PASSWORD);
  201 |   await seller.page.goto("/en/usdt-exchange");
  202 |   const createListingForm = seller.page.locator("form").filter({ has: seller.page.getByRole("button", { name: "Create Live Listing" }) });
  203 | 
  204 |   await createListingForm.getByPlaceholder("Available Amount", { exact: true }).fill("1000");
  205 |   await createListingForm.getByPlaceholder("Price", { exact: true }).fill("3.70");
  206 |   await createListingForm.getByPlaceholder("Minimum Trade", { exact: true }).fill("100");
  207 |   await createListingForm.getByPlaceholder("Maximum Trade", { exact: true }).fill("1000");
  208 |   await seller.page.getByRole("button", { name: "Create Live Listing" }).click();
  209 |   await expect(seller.page.getByText("Listing is now live.")).toBeVisible({ timeout: 10_000 });
  210 | 
  211 |   await createListingForm.getByPlaceholder("Available Amount", { exact: true }).fill("500");
  212 |   await createListingForm.getByPlaceholder("Price", { exact: true }).fill("3.65");
  213 |   await createListingForm.getByPlaceholder("Minimum Trade", { exact: true }).fill("50");
  214 |   await createListingForm.getByPlaceholder("Maximum Trade", { exact: true }).fill("500");
  215 |   await seller.page.getByRole("button", { name: "Create Live Listing" }).click();
  216 |   await expect(seller.page.getByText("Listing is now live.")).toBeVisible({ timeout: 10_000 });
  217 | 
  218 |   await createListingForm.getByPlaceholder("Available Amount", { exact: true }).fill("250");
  219 |   await createListingForm.getByPlaceholder("Price", { exact: true }).fill("3.60");
  220 |   await createListingForm.getByPlaceholder("Minimum Trade", { exact: true }).fill("25");
  221 |   await createListingForm.getByPlaceholder("Maximum Trade", { exact: true }).fill("250");
  222 |   await seller.page.getByRole("button", { name: "Create Live Listing" }).click();
  223 |   await expect(seller.page.getByText("You already have 2 active listings. Close one before creating another.")).toBeVisible({ timeout: 10_000 });
  224 | 
  225 |   const sellerListingsResponse = await seller.page.request.get("/api/alpha-exchange/my-listings");
  226 |   const sellerListingsPayload = (await sellerListingsResponse.json()) as { listings: Array<{ id: string; status: string; availableAmount: string }> };
  227 |   const [primaryListing] = sellerListingsPayload.listings;
  228 |   expect(primaryListing.status).toBe("active");
  229 | 
  230 |   const buyer = await createSession(browser, OWNER_EMAIL, OWNER_PASSWORD);
  231 |   const firstRequest = await createRequest(buyer.page.request, primaryListing.id, "300");
  232 | 
  233 |   let response = await seller.page.request.patch(`/api/alpha-exchange/purchase-requests/${firstRequest.purchase.id}`, { data: { status: "accepted" } });
  234 |   expect(response.ok()).toBeTruthy();
  235 |   await seller.page.reload();
  236 |   await expect(seller.page.getByText("This listing is locked by an active trade. Editing, pausing, and closing are unavailable until the trade finishes.")).toBeVisible({ timeout: 10_000 });
  237 | 
  238 |   response = await seller.page.request.patch(`/api/alpha-exchange/listings/${primaryListing.id}`, {
  239 |     data: { price: "4.00" },
  240 |   });
  241 |   expect(response.status()).toBe(400);
  242 |   expect(await response.json()).toMatchObject({
  243 |     error: expect.stringMatching(/locked by an active trade/i),
  244 |   });
  245 | 
  246 |   await uploadEvidence(buyer.page.request, firstRequest.purchase.id, "buyer");
  247 |   response = await buyer.page.request.patch(`/api/alpha-exchange/purchase-requests/${firstRequest.purchase.id}`, { data: { status: "payment_sent" } });
  248 |   expect(response.ok()).toBeTruthy();
  249 | 
  250 |   await uploadEvidence(seller.page.request, firstRequest.purchase.id, "seller");
  251 |   response = await seller.page.request.patch(`/api/alpha-exchange/purchase-requests/${firstRequest.purchase.id}`, { data: { status: "usdt_sent" } });
  252 |   expect(response.ok()).toBeTruthy();
  253 | 
  254 |   response = await buyer.page.request.patch(`/api/alpha-exchange/purchase-requests/${firstRequest.purchase.id}`, { data: { status: "completed" } });
  255 |   expect(response.ok()).toBeTruthy();
  256 | 
  257 |   response = await seller.page.request.get("/api/alpha-exchange/my-listings");
  258 |   let payload = (await response.json()) as { listings: Array<{ id: string; status: string; availableAmount: string }> };
```